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
export const PUBLIC_RPCS = ['tc_auth', 'tc_fix_request', 'tc_my_punches', 'tc_pin_set',
  'tc_pub_info', 'tc_punch_add', 'tc_punch_ok', 'tc_punch_undo', 'tc_verify'];
/* 部屋の中の補助（★definer にしない★＝決まりを素通りできない）
   tc_ok        … 端末記憶 or 暗証番号（RPC 3本から呼ぶ）
   tc_period_ym … その日が どの締めに入るか（2026-08-15）
   tc_state     … 受付中/締め待ち/確定（2026-08-15・★画面と同じ線を倉庫でも引く★） */
export const INNER_FUNCS = ['tc_ok', 'tc_period_ym', 'tc_state'];

T('★★関数は12本（public 9本＝全部 definer / 部屋の中 3本＝1つも definer でない）★★', () => {
  const pub = (SQL.match(/create or replace function public\.(tc_[a-z_]+)/g) || [])
    .map((s) => s.split('.')[1]).sort();
  const inner = (SQL.match(/create or replace function timeally\.(tc_[a-z_]+)/g) || [])
    .map((s) => s.split('.')[1]).sort();
  eq(pub.join(','), PUBLIC_RPCS.join(','), '★public の関数が増減している★: ' + pub.join(','));
  eq(inner.join(','), INNER_FUNCS.slice().sort().join(','), '★部屋の中の関数が増減している★: ' + inner.join(','));
  eq(pub.length + inner.length, 12, '関数の合計が12本でない');

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
  const calls = (SQL.match(/timeally\.tc_ok\(/g) || []).length - 1;   // 定義の1回を引く
  eq(calls, 5, 'tc_ok の呼び元が ' + calls + '箇所（5本のRPCのはず）');
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
