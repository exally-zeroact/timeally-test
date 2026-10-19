/* schema-contract.test.mjs — ★設計図(SQL)と コードのズレを見張る★（Timeally）
 * =============================================================================
 * 倉庫まわりで何か壊れた時に疑う順（2026-08-09 ダイコメで実際に踏んだ順）:
 *   ① ★窓(view)に列が無い★ → ② upsert（窓に一意制約が無い） → ③ 窓のRLS → ④ rpcの公開schema
 * ★アプリは窓ごしにしか部屋を見られない★ので、窓に無い列を読んだ瞬間 ★丸ごと落ちる★
 * （一部ではなく全部。文法チェックも大量のテストも緑のまま通った）。
 *
 * ここで見る物:
 *   ・表は5つだけ（★増やさない★）
 *   ・全部の表に RLS がある
 *   ・全部の窓に ★security_invoker=true が with と alter の両方★
 *     （`create or replace view` は security_invoker を落とすため）
 *   ・コードが読む列が ★全部 部屋の表にある★（窓は select * なので表＝窓）
 *   ・従業員向けRPCが ★search_path に extensions を持っている★
 *     （crypt / gen_salt / gen_random_bytes は extensions にある。public だけだと解決できない）
 *
 * 使い方: node tests/schema-contract.test.mjs
 *         node tests/schema-contract.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');

export const TABLES = ['tc_companies', 'tc_pub', 'tc_punch', 'tc_fix', 'tc_shift'];
/* ★帳面（追記だけ）の棚★ … 直す/消す を渡さないので、上の5本とは検査の線が違う。
   2026-08-15 に tc_close を1本だけ足した。理由＝確定/解除の「いつ・誰が・なぜ」を
   残さないと、★どの数字を給与へ渡したのか 後で誰も言えない★（労基法109条と同じ考え方）。 */
export const LOG_TABLES = ['tc_close'];

/** 部屋の表の列を読む */
export function columnsOf(sql, table) {
  const re = new RegExp('create table if not exists timeally\\.' + table + '\\s*\\(([\\s\\S]*?)\\n\\);', 'i');
  const m = re.exec(sql);
  if (!m) return null;
  return m[1].split('\n').map((l) => l.trim())
    .filter((l) => l && !l.startsWith('--') && !/^(unique|primary key|check|constraint)\b/i.test(l))
    .map((l) => (l.match(/^([a-z_][a-z0-9_]*)/i) || [])[1])
    .filter(Boolean);
}

/** コードが 窓ごしに読み書きしている列（.eq('x' / row の key など）を拾う */
export function usedColumns(js) {
  const out = new Set();
  let m;
  const eq = /\.(eq|neq|gt|gte|lt|lte|is|not|order|in)\(\s*'([a-z_][a-z0-9_]*)'/g;
  while ((m = eq.exec(js))) out.add(m[2]);
  const onConflict = /onConflict:\s*'([^']+)'/g;
  while ((m = onConflict.exec(js))) String(m[1]).split(',').forEach((c) => out.add(c.trim()));
  return [...out];
}

let pass = 0, fail = 0;
/* ═══ 番号の 門（2026-10-20 番号が null でも 通った 穴の 直し） ═══════════════════════════════
 * ★黒名簿（穴の 形を 1つずつ 探す）を やめて 白名簿（見直した 中身を 指紋で 固める）にした★
 *   taiketsu が 2回で 黙って 緑の 書き換えを 4通り → 6通り 作った（or→and・return を 消す・飾りの if・
 *   not(= crypt) 等）＝悪い 書き方は 何通りでも 書ける。良い 中身は 1つ。
 * ⇒ 番号を 照らす 3関数（tc_verify・tc_pin_set・tc_ok）は ★コメントと 空白を 揃えた 中身の 指紋★ を 持つ。
 *   1字でも 変われば 赤＝★目で 見直して（taiketsu を 通して）から★ 指紋を 付け替える。
 *   付け替える 時は 下の PW_PIN の 横に「いつ・何を・誰が 見たか」を 書く。 */
/** コメント（-- と /* *\/）を 落とし、空白を 1つに 揃える（説明文の 直しや 字下げでは 赤に しない） */
export const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim();
const fnHead = (schema, name) => new RegExp('create\\s+(?:or\\s+replace\\s+)?function\\s+' + schema + '\\.' + name + '\\s*\\(', 'gi');
/** 同じ 名前の 関数が 何本 在るか（or replace 無し・括弧の 前の 空白も 数える） */
export function fnCount(sql, name, schema = 'public') { return (norm(sql).match(fnHead(schema, name)) || []).length; }
/** ある 位置から 関数1本（create から 閉じの $$ の 後の ; まで）。t は norm 済みの 文 */
const cutFn = (t, at) => {
  const a = t.indexOf('$$', at), b = a < 0 ? -1 : t.indexOf('$$', a + 2), e = b < 0 ? -1 : t.indexOf(';', b);
  return e < 0 ? null : t.slice(at, e + 1);
};
/** 関数1本 まるごと（頭の definer / search_path も 含む）。★コメントを 落とした 文の 上で 切る★
 *  （生の 文で 探すと /* 正しい 写し *\/ を コメントに 置かれた 時に 写しの 方を 読む＝taiketsu 2026-10-20 D1） */
export function fnFull(sql, name, schema = 'public') {
  const t = norm(sql), m = fnHead(schema, name).exec(t);
  return m ? cutFn(t, m.index) : null;
}
/** ★crypt( を 使う 関数の 名前 全部 と、関数の 外に 在る crypt( の 数★（中身で 選ぶ＝名前で 選ばない） */
/* crypt の 呼び方は 空白（crypt (）・引用符（"crypt"(）・スキーマ名つきでも 同じ 呼び出し＝全部 数える（taiketsu 4回目 S1〜S4） */
const CRYPT_CALL = () => /"?\bcrypt"?\s*\(/gi;
export function cryptUsers(sql) {
  const t = norm(sql), names = [];
  let inside = 0;
  for (const m of t.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(\w+)\.(\w+)\s*\(/gi)) {
    const f = cutFn(t, m.index) || '';
    const k = (f.match(CRYPT_CALL()) || []).length;
    if (k) { names.push(m[1] + '.' + m[2]); inside += k; }
  }
  return { names: names.sort(), outside: (t.match(CRYPT_CALL()) || []).length - inside };
}
const sha16 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
export const PW_FNS = [['public', 'tc_verify'], ['public', 'tc_pin_set'], ['timeally', 'tc_ok']];
/* ★見直した 中身の 指紋★（norm した fnFull の sha256 頭16字）
 *   2026-10-20 Timeally 席：tc_verify と tc_pin_set に null・空の 断りを 入れた 形。taiketsu 2回（指摘は 試験の 側だけ）。
 *   tc_ok は 中身を 変えていない（976251c の 形）＝★番号の 総当たりに ロックが 効かない 件は 別の 1件★ */
export const PW_PIN = {
  'public.tc_verify': '58f214fe1201635c',
  'public.tc_pin_set': '17eeb840467bc43f',
  'timeally.tc_ok': '840d23ae9c7d8dc3',
};
/** ★番号の 門の 赤の 理由（空なら 良い）★ */
export function pwGateDiff(sql) {
  const bad = [];
  for (const [s, n] of PW_FNS) {
    const k = fnCount(sql, n, s);
    if (k !== 1) { bad.push(s + '.' + n + ' が ' + k + ' 本（1本 でない）'); continue; }
    const got = sha16(norm(fnFull(sql, n, s)));
    if (got !== PW_PIN[s + '.' + n]) bad.push(s + '.' + n + ' の 中身が 見直した 形と 違う（今 ' + got + '）＝目で 見直して 指紋を 付け替える');
  }
  /* ★番号を 照らす（crypt を 使う）関数は この 3本だけ★＝4本目を 足した 日に 何も 見ていない、を 作らない。
     比べの 書き方を 黒名簿で 探すのは やめた（左右の 入れ替え・coalesce 等 何通りでも 書ける＝taiketsu D3・D4） */
  const want = PW_FNS.map(([s, n]) => s + '.' + n).sort().join(',');
  const cu = cryptUsers(sql);
  if (cu.names.join(',') !== want) bad.push('crypt を 使う 関数が 見直した 3本と 違う（今 ' + cu.names.join(',') + '）');
  if (cu.outside !== 0) bad.push('関数の 外に crypt( が ' + cu.outside + ' 個');
  return bad;
}
/** 当てる 1本は ★begin; ＋ 2関数（設計図と 同じ）＋ commit; だけ★（alter・grant・commit 抜けを 入れさせない） */
export function applyShapeDiff(apply, sql) {
  const want = 'begin; ' + norm(fnFull(sql, 'tc_pin_set')) + ' ' + norm(fnFull(sql, 'tc_verify')) + ' commit;';
  return norm(apply) === want ? [] : ['当てる 1本が「begin; ＋ 設計図の tc_pin_set ＋ tc_verify ＋ commit;」と 違う'];
}

const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

if (process.argv.includes('--self-test')) {
  console.log('\n[schema-contract --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  S('① 列を読み落とす作り物は 列を1つも見つけない（本物は見つける）', () => {
    ok(columnsOf('create table if not exists timeally.tc_x (\n  id uuid\n);', 'tc_x').join() === 'id', '読めていない');
    ok(columnsOf(SQL, 'tc_punch').length >= 8, '★本物の列を読めていない＝この検査が空振り★');
  });
  S('② 窓の alter を外したら赤（create or replace が security_invoker を落とすため）', () => {
    const broken = SQL.replace(/alter view public\.tc_punch set \(security_invoker = true\);/, '');
    ok(!/alter view public\.tc_punch set \(security_invoker = true\)/.test(broken), '作り物が壊れていない');
    ok(/alter view public\.tc_punch set \(security_invoker = true\)/.test(SQL), '★本物に alter が無い★');
  });
  S('③ 表を1つ増やしたら赤（今は 5＋帳面1＝6本）', () => {
    const more = SQL + '\ncreate table if not exists timeally.tc_extra (id uuid);';
    const found = (more.match(/create table if not exists timeally\.(tc_[a-z_]+)/g) || []).length;
    ok(found === 7, '作り物が増えていない');
    ok((SQL.match(/create table if not exists timeally\.(tc_[a-z_]+)/g) || []).length === 6, '★本物の表の数が6でない★');
  });
  S('④ 帳面に「直す」決まりを足したら赤（追記だけが崩れる）', () => {
    const more = SQL + '\ncreate policy own_tc_close_edit on timeally.tc_close for update using (true);';
    ok(/create policy [a-z_]+ on timeally\.tc_close for (all|update|delete)/.test(more), '作り物が壊れていない');
    ok(!/create policy [a-z_]+ on timeally\.tc_close for (all|update|delete)/.test(SQL),
      '★本物の帳面に 直す/消す の決まりがある★');
  });
  /* ★番号の 門（白名簿）★＝taiketsu（2026-10-20・2回）が 手で 作って 緑に なった 形を 全部 赤に できるか */
  const APPLY0 = fs.readFileSync(path.join(ROOT, 'supabase/apply-2026-10-20-pw-null.sql'), 'utf8');
  const NEW_IF = /if p_pw is null or p_pw = '' or v_pub\.pw_hash is null\s+or v_pub\.pw_hash is distinct from crypt\(p_pw, v_pub\.pw_hash\) then/;
  const mk = (base, from, to) => { const s = base.replace(from, to); ok(s !== base, '作り物が 作れていない＝空振り: ' + String(from).slice(0, 50)); return s; };
  const red = (s, re, m) => { const b = pwGateDiff(s); ok(b.length > 0 && (!re || b.some((x) => re.test(x))), (m || '緑のまま') + ' ' + b.join(' / ')); };
  S('⑤ 本物は 緑（番号の 門・当てる 1本の 形）', () => {
    eq(pwGateDiff(SQL).join(' / '), '', '★本物が 赤★');
    eq(applyShapeDiff(APPLY0, SQL).join(' / '), '', '★本物の 当てる 1本が 赤★');
  });
  S('⑥ 2026-10-20 前の 形（<> crypt・桁の if に null の 断り無し）は 赤', () => {
    red(mk(SQL, NEW_IF, 'if v_pub.pw_hash is null or v_pub.pw_hash <> crypt(p_pw, v_pub.pw_hash) then'), /tc_verify/);
    red(mk(SQL, "if p_pin is null or p_pin !~ '^[0-9]{4,6}$'", "if p_pin !~ '^[0-9]{4,6}$'"), /tc_pin_set/);
  });
  S('⑦ taiketsu 1回目の 4通り（return しない 断り＋!=・<> extensions.crypt・引数違い・tc_ok を not(!=)）は 赤', () => {
    const pre = "if p_pw is null or p_pw = '' then v_dev := null; end if;\n  ";
    red(mk(SQL, NEW_IF, pre + 'if v_pub.pw_hash is null or v_pub.pw_hash != crypt(p_pw, v_pub.pw_hash) then'));
    red(mk(SQL, NEW_IF, pre + 'if v_pub.pw_hash is null or v_pub.pw_hash <> extensions.crypt(p_pw, v_pub.pw_hash) then'));
    red(SQL + '\ncreate or replace function public.tc_verify(p_token uuid, p_pw text, p_x int)\nreturns jsonb language plpgsql as $$ begin return null; end $$;\n', /2 本/);
    red(mk(SQL, /or \(p_pw is not null and v_pub\.pw_hash is not null and v_pub\.pw_hash = crypt\(p_pw, v_pub\.pw_hash\)\)/,
      'or not (v_pub.pw_hash != crypt(p_pw, v_pub.pw_hash))'), /tc_ok/);
  });
  S('⑧ taiketsu 2回目の 6通り（return を 消す・or→and・飾りの if＋not(= crypt)・tc_ok を 逆さ・端末を or・create function で 引数違い）は 赤', () => {
    red(mk(SQL, "    return jsonb_build_object('ok',false,'remaining',5 - v_pub.fail_count);\n", ''), /tc_verify/);
    red(mk(SQL, "if p_pw is null or p_pw = '' or v_pub.pw_hash is null\n     or v_pub.pw_hash is distinct from",
      "if (p_pw is null or p_pw = '') and v_pub.pw_hash is distinct from"), /tc_verify/);
    red(mk(SQL, NEW_IF, "if p_pw is null or p_pw = '' or v_pub.pw_hash is distinct from crypt(p_pw, v_pub.pw_hash) then null; end if;\n  if not (v_pub.pw_hash = crypt(p_pw, v_pub.pw_hash)) then"));
    red(mk(SQL, 'v_pub.pw_hash = crypt(p_pw, v_pub.pw_hash))', 'v_pub.pw_hash is distinct from crypt(p_pw, v_pub.pw_hash))'), /tc_ok/);
    /* ★tc_auth（449行）にも 同じ 字が 在る＝tc_ok の 行（select から）を 名指しして 壊す★ */
    red(mk(SQL, 'select (p_device is not null and p_device = any(v_pub.device_tokens))', 'select (p_device is not null or p_device = any(v_pub.device_tokens))'), /tc_ok/);
    red(SQL + '\ncreate function public.tc_verify (p_token uuid, p_pw text, p_x int)\nreturns jsonb language plpgsql as $$ begin return null; end $$;\n', /2 本/);
  });
  S('⑪ taiketsu 3回目：コメントに 正しい 写しを 置き 本物の return を 消す（D1）・4本目に crypt の 照合（D3・D4）は 赤', () => {
    const real = fnFull(SQL, 'tc_verify');
    const body = SQL.slice(SQL.indexOf('create or replace function public.tc_verify('));
    const rawVerify = body.slice(0, body.indexOf('end $$;') + 'end $$;'.length);
    const broken = rawVerify.replace("    return jsonb_build_object('ok',false,'remaining',5 - v_pub.fail_count);\n", '');
    ok(broken !== rawVerify, '作り物が 作れていない＝空振り');
    red(SQL.split(rawVerify).join('/* ' + real + ' */\n' + broken), /tc_verify/);
    red(SQL + "\ncreate or replace function public.tc_x(p_pw text) returns boolean language plpgsql as $$ begin if crypt(p_pw,'x') <> 'y' then return false; end if; return true; end $$;\n", /3本と 違う/);
    red(SQL + "\ncreate or replace function public.tc_y(p_pw text) returns boolean language plpgsql as $$ begin if not coalesce(false, 'a' = crypt(p_pw,'a')) then return false; end if; return true; end $$;\n", /3本と 違う/);
    red(SQL + "\nselect crypt('a','b');\n", /関数の 外/);
    /* 4回目 S1〜S4：空白・引用符・スキーマ名つきの crypt も 4本目として 赤 */
    for (const call of ["crypt (p_pw,'x')", "extensions.crypt (p_pw,'x')", "\"crypt\"(p_pw,'x')", "extensions.\"crypt\"(p_pw,'x')"])
      red(SQL + "\ncreate or replace function public.tc_z(p_pw text) returns int language plpgsql as $$ begin if " + call + " <> 'y' then return 0; end if; return 1; end $$;\n", /3本と 違う/);
  });
  S('⑨ 正しい 書き換え（説明文・字下げ・/* */ の 区切り・改行）では 赤に しない', () => {
    const s = mk(SQL, NEW_IF, "-- 説明を 足した\n  /* 古い形: pw_hash <> crypt(x) */\n  if p_pw is null   or p_pw = ''\n\tor v_pub.pw_hash is null or v_pub.pw_hash is distinct from crypt(p_pw, v_pub.pw_hash) then");
    eq(pwGateDiff(s).join(' / '), '', '正しい 書き換えで 赤');
  });
  S('⑩ 当てる 1本：頭を invoker・関数の 外に alter / grant・commit 抜け は 赤', () => {
    const r = (s) => ok(applyShapeDiff(s, SQL).length === 1, '緑のまま');
    r(mk(APPLY0, /(create or replace function public\.tc_verify[\s\S]*?)security definer set search_path=public, extensions, timeally/, '$1security invoker'));
    r(mk(APPLY0, /\ncommit;/, '\nalter function public.tc_verify(uuid,text) security invoker;\ncommit;'));
    r(mk(APPLY0, /\ncommit;/, '\ngrant execute on function public.tc_verify(uuid,text) to public;\ncommit;'));
    r(mk(APPLY0, /\ncommit;\n?$/, '\n'));
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[設計図とコードの契約]');

T('★表は5つ＋帳面1つだけ（増やさない）', () => {
  const found = (SQL.match(/create table if not exists timeally\.(tc_[a-z_]+)/g) || [])
    .map((s) => s.split('.')[1]);
  const want = TABLES.concat(LOG_TABLES);
  eq(found.length, want.length, '表の数が ' + found.length + '（' + found.join(', ') + '）');
  want.forEach((t) => ok(found.indexOf(t) >= 0, t + ' が無い'));
  found.forEach((t) => ok(want.indexOf(t) >= 0, '★見覚えのない表 ' + t + ' が増えている★'));
});

T('★★同じ人を2行 作らせない（給与CSVが壊れる型を倉庫で止める）★★', () => {
  /* ★employee_id と emp_no は別物★
       employee_id … 機械が作る鍵（打刻・予定・締めが これで人を指す）→ ★空も重なりも許さない★
       emp_no      … 人が打つ従業員番号（給与CSVに載る）→ ★空は許す・重なりは許さない★
     「空を許す」の根拠は tests/vendor/kintai-csv.js を実際に読んだ結果（氏名が必須・番号は運ぶだけ）。 */
  ok(/alter table timeally\.tc_pub add\s+constraint tc_pub_uniq_employee_id\s+unique \(account_id, employee_id\)/.test(SQL),
    '★(account_id, employee_id) の一意が無い★');
  ok(/constraint tc_pub_employee_id_not_blank\s+check \(length\(btrim\(employee_id\)\) > 0\)/.test(SQL),
    '★空の鍵を止めていない★');
  ok(/create unique index if not exists tc_pub_uniq_emp_no[\s\S]{0,200}?on timeally\.tc_pub \(account_id, emp_no\)/.test(SQL),
    '★従業員番号(emp_no)の一意が無い★');
  ok(/tc_pub_uniq_emp_no[\s\S]{0,200}?where emp_no is not null and btrim\(emp_no\) <> ''/.test(SQL),
    '★emp_no の一意に「空は除く」が無い（番号を使わない会社が1人しか作れなくなる）★');
  /* ★付け外しできる形で書く★（2回当てても落ちない） */
  ok(/drop constraint if exists tc_pub_uniq_employee_id/.test(SQL), '2回当てると落ちる書き方');
});

T('★★帳面(tc_close)は 追記だけ＝直す/消す の決まりを作らない★★', () => {
  LOG_TABLES.forEach((t) => {
    ok(new RegExp('alter table timeally\\.' + t + ' enable row level security').test(SQL), t + ' に RLS が無い');
    ok(new RegExp('create policy own_' + t + '_read on timeally\\.' + t + ' for select').test(SQL), t + ' の読む決まりが無い');
    ok(new RegExp('create policy own_' + t + '_add on timeally\\.' + t + ' for insert').test(SQL), t + ' の足す決まりが無い');
    /* ★for all / for update / for delete があったら赤★（1行でも書き換えられたら跡が消える） */
    ok(!new RegExp('create policy [a-z_]+ on timeally\\.' + t + ' for (all|update|delete)').test(SQL),
      '★' + t + ' に 直す/消す の決まりがある（追記だけが崩れる）★');
    ok(!new RegExp('grant[^;]*(update|delete)[^;]*on (public|timeally)\\.' + t).test(SQL),
      '★' + t + ' に update/delete の権限を渡している★');
    ok(new RegExp('grant select, insert\\s+on public\\.' + t + ' to authenticated').test(SQL), t + ' の窓に権限が無い');
    ok(new RegExp('grant select, insert\\s+on timeally\\.' + t + '\\s+to authenticated').test(SQL), t + ' の実の棚に権限が無い');
    ok(new RegExp('create or replace view public\\.' + t + ' with \\(security_invoker = true\\)').test(SQL), t + ' の窓に with が無い');
    ok(new RegExp('alter view public\\.' + t + ' set \\(security_invoker = true\\)').test(SQL), t + ' の窓に alter が無い');
  });
  /* ★解除の理由は倉庫でも要る★（画面のチェックだけだと 直に叩けば空で入る） */
  ok(/check \(action <> 'reopen' or length\(btrim\(reason\)\) >= 2\)/.test(SQL),
    '★解除の理由を倉庫で強制していない★');
});

T('★全部の表に RLS がある（本人の行だけ）', () => {
  TABLES.forEach((t) => {
    /* ★空白の数で判定しない★（読みやすさで桁を揃えると1文字違いで空振りする） */
    ok(new RegExp('alter table\\s+timeally\\.' + t + '\\s+enable row level security').test(SQL), t + ' に RLS が無い');
    ok(new RegExp('create policy own_' + t + ' on timeally\\.' + t).test(SQL), t + ' に方針が無い');
    ok(new RegExp('create policy own_' + t + '[\\s\\S]{0,200}?with check \\(account_id = auth\\.uid\\(\\)\\)').test(SQL),
      t + ' の with check が無い（他人の行を書ける）');
  });
});

T('★全部の窓に security_invoker=true が「with」と「alter」の両方ある（命綱）', () => {
  TABLES.forEach((t) => {
    ok(new RegExp('create or replace view public\\.' + t + ' with \\(security_invoker = true\\)').test(SQL),
      t + ' の窓に with が無い');
    ok(new RegExp('alter view public\\.' + t + ' set \\(security_invoker = true\\)').test(SQL),
      t + ' の窓に alter が無い（create or replace が落とすので必ず要る）');
    ok(new RegExp('grant select, insert, update, delete on public\\.' + t + ' to authenticated').test(SQL),
      t + ' の窓に権限が無い');
  });
  console.log('     実測: 窓 ' + TABLES.length + '枚すべてに with＋alter＋権限');
});

T('★実の棚にも権限がある（窓だけ渡しても security_invoker では開かない）', () => {
  /* 2026-08-14 実UIを押して踏んだ: 窓に grant しただけでは
     "permission denied for table tc_companies"。窓は★呼んだ人の権利で開く★ので
     実の棚(timeally.*)の権限が要る（行の絞り込みは RLS がやる）。 */
  ok(/grant usage on schema timeally to authenticated/.test(SQL), '部屋への usage が無い');
  TABLES.forEach((t) => {
    ok(new RegExp('grant select, insert, update, delete on timeally\\.' + t + '\\s+to authenticated').test(SQL),
      '★' + t + ' の実の棚に権限が無い（窓ごしでも開けない）★');
  });
});

T('★コードが読む列が 全部 表にある（窓に無い列を読むと丸ごと落ちる）', () => {
  const js = fs.readFileSync(path.join(ROOT, 'js/tc-db.js'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'js/owner-app.js'), 'utf8');
  const all = new Set();
  TABLES.concat(LOG_TABLES).forEach((t) => (columnsOf(SQL, t) || []).forEach((c) => all.add(c)));
  const used = usedColumns(js);
  const missing = used.filter((c) => !all.has(c) && c !== 'ascending');
  ok(missing.length === 0, '表に無い列を読んでいる: ' + missing.join(', '));
  console.log('     実測: コードが名指しする列 ' + used.length + '個 / 表にある列 ' + all.size + '個 / 無い物 0個');
});

T('★upsert の onConflict が 実在する一意制約と合っている', () => {
  const js = fs.readFileSync(path.join(ROOT, 'js/tc-db.js'), 'utf8');
  if (/onConflict:\s*'account_id'/.test(js)) {
    ok(/tc_companies[\s\S]*?account_id\s+uuid primary key/.test(SQL), 'tc_companies の主キーが account_id でない');
  }
  if (/onConflict:\s*'account_id,employee_id,d'/.test(js)) {
    ok(/unique \(account_id, employee_id, d\)/.test(SQL), 'tc_shift に (account_id, employee_id, d) の一意制約が無い');
  }
});

/* ★関数の数を固定する（指示役 2026-08-15）★
   security definer の関数は ★決まり(RLS)を素通りできる★ので、
   ★1本 増えたら必ず気づく★形にしておく。
   実測（本番倉庫 2026-08-15）:
     public   … 7本 すべて definer=true（従業員(anon)に開いている入口）
     timeally … tc_ok 1本だけ definer=false
   ★tc_ok は RLS から呼ぶ物ではない★。
   ★RPC 3本（tc_punch_add / tc_my_punches / tc_fix_request）の中から呼ぶ★
   「端末記憶 or 暗証番号が合っているか」を ★1か所で確かめる★ための補助。
   部屋(timeally)の中なので PostgREST からは呼べない・anon にも渡していない。 */
/* 2026-08-15 tc_set_password → ★tc_pin_set★ に作り直した（初回コードを無くし、暗証番号1つに） */
/* 2026-08-18 ★tc_punch_undo★ を1本 足した（7→8本）
   ＝★打った直後60秒だけ 自分で取り消せる★（★消す道ではない★＝voided_at の印を立てるだけ・行は残る）。
   ★門は倉庫の側★（自分の物・その場の打刻・60秒以内・まだ取り消していない・締めていない）。
   足した理由: 司さん「ミスがあったからの対処やなく、ミスのないような対処をさせろ」 */
/* 2026-08-18（夜）★tc_punch_ok★ を1本 足した（8→9本）
   ＝機械が「長すぎ/短すぎ/退勤が先」に気づいて聞いた事に ★合っていると答える★口。
   ★印を1つ足すだけ＝打刻は1文字も動かない★（二度と聞かない為）。 */
/* 2026-08-18（夜2）★tc_punch_edit★ を1本 足した（9→10本）
   ＝★自分で直せる（お願い 不要）★の道。★締めた月は倉庫が断る★／
     ★元の行は消さず voided_at の印＋新しい時刻を1本★／★tc_fix に承認済で跡を残す★。 */
/* 2026-08-22 ★tc_punch_edit_owner★ を1本 足した（10→11本）
   ＝司さん「社長の画面からも 個人の出勤や退勤を修正できるようにした方がいい」。
     ★門も跡も 従業員の口と同じ★（締めた月は断る／元は消さず印／tc_fix に owner で残す）。
     ★違いは2つだけ★ … 誰か（auth.uid の会社の人だけ）／★種類(kind)も直せる★
     （「08:00 が 出勤か退勤か 決まっていません」を 本人が答えられない時に 会社が決める）。 */
export const PUBLIC_RPCS = ['tc_auth', 'tc_fix_request', 'tc_my_punches', 'tc_pin_set',
  'tc_pub_info', 'tc_punch_add', 'tc_punch_edit', 'tc_punch_edit_owner', 'tc_punch_ok',
  'tc_punch_undo', 'tc_verify'];
/* 部屋の中の補助（★definer にしない★＝決まりを素通りできない）
   tc_ok        … 端末記憶 or 暗証番号（RPC 3本から呼ぶ）
   tc_period_ym … その日が どの締めに入るか（2026-08-15）
   tc_state     … 受付中/締め待ち/確定（2026-08-15・★画面と同じ線を倉庫でも引く★） */
export const INNER_FUNCS = ['tc_ok', 'tc_period_ym', 'tc_state'];

T('★★関数は14本（public 11本＝全部 definer / 部屋の中 3本＝1つも definer でない）★★', () => {
  const pub = (SQL.match(/create or replace function public\.(tc_[a-z_]+)/g) || [])
    .map((s) => s.split('.')[1]).sort();
  const inner = (SQL.match(/create or replace function timeally\.(tc_[a-z_]+)/g) || [])
    .map((s) => s.split('.')[1]).sort();
  eq(pub.join(','), PUBLIC_RPCS.join(','), '★public の関数が増減している★: ' + pub.join(','));
  eq(inner.join(','), INNER_FUNCS.slice().sort().join(','), '★部屋の中の関数が増減している★: ' + inner.join(','));
  eq(pub.length + inner.length, 14, '関数の合計が14本でない');

  /* ★definer かどうかを1本ずつ見る★（definer は決まりを素通りできる） */
  const bodies = SQL.split('create or replace function ').slice(1);
  bodies.forEach(function (b) {
    const name = (b.match(/^(public|timeally)\.(tc_[a-z_]+)/) || [])[0] || '?';
    const isDefiner = /security definer/.test(b.split('$$')[0]);
    if (name.indexOf('public.') === 0) ok(isDefiner, name + ' が definer でない（anonから呼べない）');
    else ok(!isDefiner, '★' + name + ' が definer になっている（決まりを素通りできてしまう）★');
  });

  /* ★tc_ok は RLS ではなく RPC の中から呼ばれている★（呼び元を数える） */
  /* 2026-08-18 ★tc_punch_undo と tc_punch_ok★ が増えて 5本になった
     （打刻を入れる／取り消す／合っていると答える／読む／直しを出す） */
  /* ★数えるのは「呼んでいる所」だけ★（2026-08-23）
     ＝grant / revoke の行にも 関数名が出るので、そのまま数えると ★呼び元が増えたと嘘をつく★
       （実際 revoke を1行 足した時に 6→7 になって赤くなった＝★見張りは働いた★）。 */
  const calls = SQL.split(String.fromCharCode(10))
    .filter((l) => !/^[ 	]*(grant|revoke)[ 	]/i.test(l))
    .join(' ').split('timeally.tc_ok(').length - 2;   // 定義の1回を引く
  eq(calls, 6, 'tc_ok の呼び元が ' + calls + '箇所（6本のRPCのはず）');
  ok(!/create policy[\s\S]{0,300}tc_ok/.test(SQL), '★tc_ok を決まり(RLS)から呼んでいる★');
  console.log('     実測: public ' + pub.length + '本(全部definer) / 部屋の中 ' + inner.length
    + '本(definerでない) / tc_ok の呼び元 ' + calls + 'か所（RPCの中）');
});

T('★従業員向けRPCの search_path に extensions がある（crypt が解決できないと落ちる）', () => {
  const fns = SQL.match(/create or replace function public\.tc_[a-z_]+[\s\S]*?as \$\$/g) || [];
  ok(fns.length >= 7, 'RPCが少なすぎる: ' + fns.length);
  const bad = fns.filter((f) => !/set search_path=[^\n]*extensions/.test(f));
  ok(bad.length === 0, 'extensions が無いRPCが ' + bad.length + '本');
});

T('★打刻の原本を消す道が無い（出勤簿は法定三帳簿・5年 当分の間3年）', () => {
  ok(/voided_at/.test(SQL), '取り消しの印(voided_at)が無い＝消すしかなくなる');
  const emp = fs.readFileSync(path.join(ROOT, 'js/emp-app.js'), 'utf8');
  const own = fs.readFileSync(path.join(ROOT, 'js/tc-db.js'), 'utf8');
  ok(!/\.delete\(\)/.test(emp), '従業員の画面に delete がある');
  ok(!/from\('tc_punch'\)[\s\S]{0,80}\.delete\(\)/.test(own), '打刻を消す道がある');
  const rpcs = SQL.match(/create or replace function public\.tc_[a-z_]+[\s\S]*?\$\$[\s\S]*?\$\$/g) || [];
  ok(!rpcs.some((f) => /\bdelete\s+from\b/i.test(f)), '★従業員が呼べるRPCに delete がある★');
});

T('★暗証番号は平文で持たない・数字4〜6桁・5回で15分ロック（サーバ側で強制）', () => {
  ok(/crypt\(p_pin, gen_salt\('bf'\)\)/.test(SQL), 'bcrypt で保存していない');
  ok(!/pw\s+text\s*,?\s*--.*平文/.test(SQL), '平文の列がある');
  ok(/p_pin !~ '\^\[0-9\]\{4,6\}\$'/.test(SQL), '★桁をサーバが弾いていない★');
  ok(/fail_count\+1 >= 5/.test(SQL) && /interval '15 minutes'/.test(SQL), '5回で15分ロックが無い');
  /* ★「最初のあいことば」の口が生き残っていないか★（古い形は落とす） */
  ok(/drop function if exists public\.tc_set_password\(uuid,text,text\)/.test(SQL),
    '★古い tc_set_password を落としていない（初回コードの口が生き続ける）★');
  ok(!/p_init/.test(SQL), '★まだ初回コードを受け取る所がある★');
});

/* ★2026-10-20 番号が null でも 通った★（tc_verify・tc_pin_set）＝リンクを 持てば 番号なしで 端末の鍵が 出た
   ⇒ 番号を 照らす 3関数は 見直した 中身の 指紋（PW_PIN）で 固める（白名簿）。変われば 赤＝見直してから 付け替える */
T('★★番号を 照らす 3関数が 見直した 中身の まま（1本ずつ・<> crypt 無し）★★', () => {
  const bad = pwGateDiff(SQL);
  ok(bad.length === 0, bad.join(' / '));
});
/* 倉庫に 当てる 1本（supabase/apply-2026-10-20-pw-null.sql）＝begin; ＋ 設計図の 2関数（頭を 含めて）＋ commit; だけ */
T('★当てる 1本が「begin; ＋ 設計図の 2関数 ＋ commit;」だけ', () => {
  const APPLY = fs.readFileSync(path.join(ROOT, 'supabase/apply-2026-10-20-pw-null.sql'), 'utf8');
  const bad = applyShapeDiff(APPLY, SQL);
  ok(bad.length === 0, bad.join(' / '));
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
