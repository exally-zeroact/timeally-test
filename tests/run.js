/* run.js — 全部まとめて走らせる（Timeally）
 * =============================================================================
 * ★これは「手元で1発」用★。CIは ci.yml に1本ずつ並べる
 *   （赤くなった時に どれで落ちたか一目で分かるように）。
 *   ★tests/ci-coverage.test.mjs が「ここに在るのに CI に並んでいない物」を赤にする★
 *   （新しい tests/ は CI に登録するまで1本も走らない＝前科）。
 */
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const files = fs.readdirSync(__dirname)
  .filter((f) => /\.(test\.mjs)$/.test(f) || f === 'ui-sweep.mjs')
  .sort();

let ng = 0, total = 0;
for (const f of files) {
  const rel = 'tests/' + f;
  for (const args of [[rel], [rel, '--self-test']]) {
    /* --self-test を持たない検査は、そのまま本体が走るだけ（二重に走っても害はない） */
    if (args[1] && !fs.readFileSync(path.join(__dirname, f), 'utf8').includes('--self-test')) continue;
    total++;
    const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) { ng++; console.log('★赤★ ' + args.join(' ')); }
  }
}
/* 門番と印も同じ列に並べる（走らせない見張りは無いのと同じ） */
for (const cmd of [['scripts/sql-guard.mjs', '--self-test'], ['scripts/sql-guard.mjs', 'supabase/schema.sql'],
  ['scripts/stamp-build.mjs', '--check']]) {
  total++;
  const r = spawnSync(process.execPath, cmd, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) { ng++; console.log('★赤★ ' + cmd.join(' ')); }
}

console.log('\n════════════════════════════════════════');
console.log(ng ? `★${ng} / ${total} が赤★` : `全部 緑（${total}本）`);
process.exit(ng ? 1 : 0);
