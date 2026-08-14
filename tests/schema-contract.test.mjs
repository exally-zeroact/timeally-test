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
  S('③ 表を6つ目に増やしたら赤', () => {
    const more = SQL + '\ncreate table if not exists timeally.tc_extra (id uuid);';
    const found = (more.match(/create table if not exists timeally\.(tc_[a-z_]+)/g) || []).length;
    ok(found === 6, '作り物が増えていない');
    ok((SQL.match(/create table if not exists timeally\.(tc_[a-z_]+)/g) || []).length === 5, '★本物の表の数が5でない★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[設計図とコードの契約]');

T('★表は5つだけ（増やさない）', () => {
  const found = (SQL.match(/create table if not exists timeally\.(tc_[a-z_]+)/g) || [])
    .map((s) => s.split('.')[1]);
  ok(found.length === 5, '表の数が ' + found.length + '（' + found.join(', ') + '）');
  TABLES.forEach((t) => ok(found.indexOf(t) >= 0, t + ' が無い'));
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
  TABLES.forEach((t) => (columnsOf(SQL, t) || []).forEach((c) => all.add(c)));
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

T('★暗証番号は平文で持たない・8文字以上・5回で15分ロック（サーバ側で強制）', () => {
  ok(/crypt\(p_pw, gen_salt\('bf'\)\)/.test(SQL), 'bcrypt で保存していない');
  ok(!/pw\s+text\s*,?\s*--.*平文/.test(SQL), '平文の列がある');
  ok(/length\(coalesce\(p_pw,''\)\) < 8/.test(SQL), '★8文字未満をサーバが弾いていない★');
  ok(/fail_count\+1 >= 5/.test(SQL) && /interval '15 minutes'/.test(SQL), '5回で15分ロックが無い');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
