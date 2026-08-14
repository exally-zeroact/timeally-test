/* probe-unique.mjs — ★「同じ人を2行 作れない」を 倉庫で実際に試す★（Timeally）
 * =============================================================================
 * ★読むだけでは足りない★。決まりが在るかを見るのではなく、
 * ★本当に入れてみて 断られるか★ を測る（入った物は必ず巻き戻す）。
 *
 * ・全部 1つの取引の中でやり、★最後に必ず rollback★（1行も残さない）
 * ・env:'test' 以外では動かない
 *
 * 使い方: node scripts/probe-unique.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const strip = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
const src = strip(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
const env = (/env:\s*'([^']+)'/.exec(src) || [])[1];
const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(/url:\s*'([^']+)'/.exec(src)[1])[1];
if (env !== 'test') { console.log('★中止★ env が test ではありません（' + env + '）'); process.exit(1); }
let token;
for (const n of ['timeally-db-token.json', 'nomiya-db-url.json', 'nomiya-db-url-prod.json']) {
  const p = path.join(os.tmpdir(), n);
  if (fs.existsSync(p)) { const t = JSON.parse(fs.readFileSync(p, 'utf8')).token; if (t) { token = t; break; } }
}
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  return { ok: r.ok, body: t };
}

const ACC = '509d7eb5-92f4-4856-ae8c-ffd82a9c2dee';
let pass = 0, fail = 0;
const T = (n, got, want) => {
  const good = want(got);
  if (good) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + ' — 返り: ' + got.slice(0, 200)); }
};

console.log(`倉庫: ${ref.slice(0, 4)}…（env: ${env}）／★入れて試して 必ず巻き戻す★`);

/* ① 同じ employee_id を2行 … 断られるはず */
let r = await q(`begin;
  insert into timeally.tc_pub (account_id, employee_id, name, emp_no)
  values ('${ACC}', 'E1', 'ためし 一郎', 'ZZ1');
rollback;`);
T('同じ employee_id は入らない', r.body, (b) => /duplicate key|tc_pub_uniq_employee_id/.test(b));

/* ② 同じ emp_no を2行 … 断られるはず（田中花子が A01） */
r = await q(`begin;
  insert into timeally.tc_pub (account_id, employee_id, name, emp_no)
  values ('${ACC}', 'Etest1', 'ためし 二郎', 'A01');
rollback;`);
T('同じ従業員番号(emp_no)は入らない', r.body, (b) => /duplicate key|tc_pub_uniq_emp_no/.test(b));

/* ③ 空の employee_id … 断られるはず */
r = await q(`begin;
  insert into timeally.tc_pub (account_id, employee_id, name, emp_no)
  values ('${ACC}', '  ', 'ためし 三郎', 'ZZ3');
rollback;`);
T('空の鍵(employee_id)は入らない', r.body, (b) => /tc_pub_employee_id_not_blank|violates check/.test(b));

/* ④ 番号なしを2人 … ★通るはず★（番号を使っていない会社が在る） */
r = await q(`begin;
  insert into timeally.tc_pub (account_id, employee_id, name, emp_no)
  values ('${ACC}', 'Etest4a', 'ためし 四郎', null),
         ('${ACC}', 'Etest4b', 'ためし 五郎', null);
rollback;`);
T('★従業員番号が空なら2人でも通る（止めすぎていない）★', r.body, (b) => r.ok && !/duplicate|violates/.test(b));

/* ⑤ 番号が違えば通る */
r = await q(`begin;
  insert into timeally.tc_pub (account_id, employee_id, name, emp_no)
  values ('${ACC}', 'Etest5', 'ためし 六郎', 'ZZ9');
rollback;`);
T('番号が違えば通る', r.body, (b) => r.ok && !/duplicate|violates/.test(b));

/* ⑥ ★巻き戻せているか★（1行も増えていない事を最後に数える） */
const after = JSON.parse((await q(`select count(*)::int as n from timeally.tc_pub;`)).body)[0].n;
T('巻き戻せている（tc_pub は 4行のまま）', String(after), () => after === 4);
console.log('     実測: tc_pub ' + after + '行');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
