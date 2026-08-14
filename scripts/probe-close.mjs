/* probe-close.mjs — ★締めの線を「倉庫の中で」実測する★（Timeally）
 * =============================================================================
 * lib/tc-close.js（画面側）と timeally.tc_state / tc_period_ym（倉庫側）は
 * ★同じ線を2か所に書いている★。★同じ答えになる事を 実物で測る★のがこの道具。
 *   （片方だけ直すと「画面は締め切ったのに 打刻は通る」が起きる）
 *
 * ★倉庫に触るのは select だけ★（1行も足さない・消さない）。
 * 向き先は js/supa-config.js からしか読まない（env:'test' 以外は止まる）。
 *
 * 使い方: node scripts/probe-close.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from './apply-schema.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const CL = require_(path.join(ROOT, 'lib/tc-close.js'));

function readConfig() {
  const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
  const url = /url:\s*'([^']+)'/.exec(src);
  const env = /env:\s*'([^']+)'/.exec(src);
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url[1]);
  return { ref: ref[1], env: env ? env[1] : '' };
}
function readToken() {
  for (const n of ['timeally-db-token.json', 'nomiya-db-url.json', 'nomiya-db-url-prod.json']) {
    const p = path.join(os.tmpdir(), n);
    if (!fs.existsSync(p)) continue;
    try { const t = JSON.parse(fs.readFileSync(p, 'utf8')).token; if (t) return t; } catch (_) { /* 次へ */ }
  }
  throw new Error('鍵が見つかりません');
}
async function q(ref, token, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 400)}`);
  return JSON.parse(t);
}

/* ★測る所（等号・端・空・不明）★ … 締め日20/25/30/31 × 月末・月初・2月・閏年 */
const CASES = [];
[20, 25, 30, 31].forEach((cd) => {
  ['2026-08-20', '2026-08-21', '2026-01-31', '2026-02-01', '2026-02-28',
    '2024-02-29', '2026-03-01', '2026-12-31'].forEach((d) => CASES.push({ cd, d }));
});

const cfg = readConfig();
if (cfg.env !== 'test') { console.log('★中止★ env が test ではありません'); process.exit(1); }
const token = readToken();
console.log(`倉庫: ${cfg.ref.slice(0, 4)}…（env: ${cfg.env}）／ select のみ`);

/* ① 締めの区切り（その日は どの YYYY-MM に入るか）を 倉庫と画面で突き合わせる */
const vals = CASES.map((c) => `(${c.cd}, date '${c.d}')`).join(',');
const rows = (await q(cfg.ref, token,
  `select cd, d, timeally.tc_period_ym(cd, d) as ym from (values ${vals}) v(cd, d) order by cd, d;`)) || [];

let bad = 0;
rows.forEach((r) => {
  /* 画面側は「締めの最終日」から逆に見る＝同じ ym になるはず */
  const ymJs = (function (cd, d) {
    const day = Number(d.slice(8, 10));
    if (day <= Math.max(1, Math.min(31, cd))) return d.slice(0, 7);
    const y = Number(d.slice(0, 4)); const m = Number(d.slice(5, 7));
    return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0');
  })(r.cd, String(r.d).slice(0, 10));
  const p = CL.periodOf(ymJs, r.cd);
  const inside = String(r.d).slice(0, 10) >= p.from && String(r.d).slice(0, 10) <= p.to;
  const same = r.ym === ymJs;
  if (!same || !inside) { bad++; console.log(`  ✗ 締め日${r.cd} ${String(r.d).slice(0, 10)} 倉庫=${r.ym} 画面=${ymJs} 期間=${p.from}〜${p.to}`); }
});
console.log(`① 締めの区切り: ${rows.length}件 測って 食い違い ${bad}件`);

/* ② 状態（open/pending/closed）… 実データの会社で数える */
const st = (await q(cfg.ref, token, `
  select c.name, c.close_day,
         timeally.tc_period_ym(c.close_day, (now() at time zone 'Asia/Tokyo')::date) as now_ym,
         timeally.tc_state(c.account_id, (now() at time zone 'Asia/Tokyo')::date)     as now_state,
         (select count(*) from timeally.tc_close z where z.account_id=c.account_id)   as log_rows
    from timeally.tc_companies c order by c.name;`)) || [];
console.log('② 実データの会社:');
st.forEach((r) => console.log(`   ${r.name || '(名前なし)'} 締め日${r.close_day} → ${r.now_ym} は「${CL.LABEL[r.now_state]}」／記録 ${r.log_rows}行`));

/* ③ 帳面が本当に「追記だけ」か＝直す/消す の決まりが無いことを倉庫で数える */
const pol = (await q(cfg.ref, token, `
  select policyname, cmd from pg_policies
   where schemaname='timeally' and tablename='tc_close' order by policyname;`)) || [];
console.log('③ tc_close の決まり: ' + (pol.map((r) => `${r.policyname}=${r.cmd}`).join(' / ') || 'なし'));
const badPol = pol.filter((r) => ['ALL', 'UPDATE', 'DELETE'].indexOf(String(r.cmd).toUpperCase()) >= 0);
if (badPol.length) { bad += badPol.length; console.log('   ✗ ★直す/消す の決まりがある（追記だけが崩れる）★'); }
const grants = (await q(cfg.ref, token, `
  select privilege_type from information_schema.role_table_grants
   where table_schema in ('timeally','public') and table_name='tc_close' and grantee='authenticated'
   group by privilege_type order by privilege_type;`)) || [];
console.log('   渡している権限: ' + grants.map((r) => r.privilege_type).join(', '));

process.exit(bad ? 1 : 0);
