/* apply-schema.mjs — ★設計図を倉庫に当てる（門番を必ず通ってから）★（Timeally）
 * =============================================================================
 * ★向き先は js/supa-config.js からしか読まない★
 *   ＝ このrepoが指している倉庫以外には当たらない（refをここに書かない）。
 * ★env:'prod' のときは --yes-prod を付けないと止まる★
 *   本番倉庫に当てるのは ★司さんの一言があってから★（道具があっても勝手に当てない）。
 *
 * 鍵: Supabase Personal Access Token（アカウント全体を触れる強い鍵）
 *   %TEMP%\timeally-db-token.json → 無ければ nomiya-db-url.json / nomiya-db-url-prod.json
 *   ★中身をログや画面に出さない★
 *
 * 当てた後に ★棚と窓と関数を数えて APPLY RESULT: OK/NG を出す★
 *   （「当てたつもり」で終わらせない。数字が出なければ失敗と同じ）
 *
 * 使い方: npm run db:apply            … supabase/schema.sql を当てる
 *         node scripts/apply-schema.mjs --probe   … 当てずに数えるだけ
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { check } from './sql-guard.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** ★コメントを落としてから読む★
 *  supa-config.js の説明文には「本番は env:'prod'」と ★わざと書いてある★。
 *  素直に正規表現で探すと ★コメントの方を先に拾って「本番だ」と誤読する★（実際に踏んだ）。
 *  文字列で探さない・読む前に落とす。 */
export function stripJsComments(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
}

function readConfig() {
  const src = stripJsComments(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
  const url = /url:\s*'([^']+)'/.exec(src);
  const env = /env:\s*'([^']+)'/.exec(src);
  if (!url) throw new Error('js/supa-config.js から url を読めません');
  const ref = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url[1]);
  if (!ref) throw new Error('url の形が想定と違います');
  return { ref: ref[1], env: env ? env[1] : '' };
}

function readToken() {
  const names = ['timeally-db-token.json', 'nomiya-db-url.json', 'nomiya-db-url-prod.json'];
  for (const n of names) {
    const p = path.join(os.tmpdir(), n);
    if (!fs.existsSync(p)) continue;
    try {
      const t = JSON.parse(fs.readFileSync(p, 'utf8')).token;
      if (t) return { token: t, from: n };
    } catch (_) { /* 読めない物は次へ */ }
  }
  throw new Error('鍵が見つかりません（%TEMP%\\timeally-db-token.json など）。司さんに作り直しを頼んでください');
}

async function query(ref, token, sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 400)}`);
  try { return JSON.parse(text); } catch (_) { return text; }
}

const COUNT_SQL = `
select
 (select count(*) from information_schema.tables  where table_schema='timeally') as tables,
 (select count(*) from information_schema.views   where table_schema='public' and table_name like 'tc\\_%') as views,
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'tc\\_%') as funcs,
 (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='timeally' and c.relkind='r' and c.relrowsecurity) as rls_on,
 (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v' and c.relname like 'tc\\_%'
     and c.reloptions::text like '%security_invoker=true%') as invoker_true,
 -- ★anon が どこに付いているかを 毎回 数える★（2026-08-22 指示役②）
 --   ＝この倉庫は「新しく作る棚・窓・関数に anon を付ける」既定を持っている（Supabaseの標準）。
 --     ★書いていないのに 付く★ので、★当てた後に数えないと 次に足す人が また穴を開ける★。
 --   窓と棚は ★0★ が正しい（従業員は RPC しか使わない）。関数の anon は ★従業員用の10本だけ★。
 (select count(*) from information_schema.role_table_grants
   where grantee='anon' and table_schema='public' and table_name like 'tc\_%') as anon_view_grants,
 (select count(*) from information_schema.role_table_grants
   where grantee='anon' and table_schema='timeally') as anon_table_grants,
 -- ★数えるのは「anon= が書いてある本数」ではなく ★anon が 実際に呼べる本数★★
 --   （2026-08-22 指示役②）＝anon は 3つの道で呼べてしまう:
 --     ①anon に直接 grant ②★PUBLIC(=X) 経由★ ③★proacl が空＝Postgresの既定でPUBLICに渡る★
 --   ★「revoke … from anon」だけ書いて「from public」を忘れると
 --     「anon= は消えた・でも PUBLIC で呼べる」＝★嘘の緑★になる★（私が実際に踏みかけた所）
 --   ⇒ has_function_privilege で ★呼べるかどうか★を そのまま聞く（3つの道を全部 含む）
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname like 'tc\_%'
     and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_funcs;
`;

async function main() {
  const cfg = readConfig();
  const probe = process.argv.includes('--probe');
  const yesProd = process.argv.includes('--yes-prod');
  console.log(`倉庫: ${cfg.ref.slice(0, 4)}…（env: ${cfg.env || '不明'}）`);

  if (cfg.env !== 'test' && !yesProd) {
    console.log('★中止★ env が test ではありません。本番に当てるには --yes-prod が要ります（司さんの一言が先）');
    process.exit(1);
  }

  const files = probe ? [] : ['supabase/schema.sql'];
  for (const f of files) {
    const bad = check(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    if (bad.length) {
      console.log(`★中止★ 門番に落ちました（1文字も当てません）: ${f}`);
      bad.forEach((b) => console.log('   - ' + b));
      process.exit(1);
    }
  }

  const { token, from } = readToken();
  console.log(`鍵: ${from}（中身は出しません）`);

  const before = await query(cfg.ref, token, COUNT_SQL);
  console.log('当てる前:', JSON.stringify(before[0] || before));

  if (!probe) {
    for (const f of files) {
      const sql = fs.readFileSync(path.join(ROOT, f), 'utf8');
      await query(cfg.ref, token, sql);
      console.log(`当てました: ${f}`);
    }
  }

  const after = await query(cfg.ref, token, COUNT_SQL);
  const a = after[0] || {};
  console.log('当てた後:', JSON.stringify(a));

  /* ★anon が 窓・棚に1件でも付いていたら NG★（関数は 従業員用の10本まで） */
  const anonOk = Number(a.anon_view_grants) === 0 && Number(a.anon_table_grants) === 0
    && Number(a.anon_funcs) <= 10;
  const ok = Number(a.tables) >= 6 && Number(a.views) >= 6 && Number(a.funcs) >= 7
    && Number(a.rls_on) >= 6 && Number(a.invoker_true) >= 6 && anonOk;
  console.log(`\nAPPLY RESULT: ${ok ? 'OK' : 'NG'}`
    + `  棚=${a.tables} 窓=${a.views} 関数=${a.funcs} RLS=${a.rls_on} security_invoker=true の窓=${a.invoker_true}`);
  console.log(`  anon … 窓=${a.anon_view_grants}件 棚=${a.anon_table_grants}件 関数=${a.anon_funcs}本`
    + `（★窓と棚は0・関数は従業員用の10本まで★）${anonOk ? '' : ' ← ★ここが NG★'}`);
  process.exit(ok ? 0 : 1);
}

/* ★import しただけで倉庫に当たらないようにする門★（2026-08-15 実際に踏んだ）
   probe-close.mjs が stripJsComments を1つ借りただけで main() が走り、
   ★「見るだけ」のつもりが 設計図を当てていた★。sql-guard.mjs と同じ門を付ける。
   ＝直接 node で叩いた時だけ動く。借りる側では何も起きない。 */
const DIRECT = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (DIRECT) main().catch((e) => { console.error('★失敗★ ' + e.message); process.exit(1); });
