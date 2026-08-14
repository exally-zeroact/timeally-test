/* mirror-to-prod.mjs — ★テスト線の中身を そのまま本番repoへ写す★（Timeally）
 * =============================================================================
 * なぜ道具にするのか:
 *   ★片方だけ直すと必ず腐る★（前科: staging だけ直して本番が6日そのままだった／
 *   テスト用の直書きがスナップショットに付いてきて 本番倉庫を触った）。
 *   手で写すのをやめて、★写さない物を1か所に書いた道具★に任せる。
 *
 * ★写さない物★
 *   js/supa-config.js … ★環境の分かれ目そのもの★。ここだけは本番repo側の物を残す
 *   .git / node_modules … repoの中身ではない
 *
 * 使い方:
 *   node scripts/mirror-to-prod.mjs --to ../timeally            … 写す
 *   node scripts/mirror-to-prod.mjs --to ../timeally --check    … ★差分を数えるだけ★
 *
 * ★写した後は 本番repo側で node tests/run.js を必ず1回走らせる★
 *   （env が prod になるので、帯の検査は「出ない」側を見る作りにしてある）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★写さない物（理由つき）★ */
export const KEEP_THEIRS = {
  'js/supa-config.js': '★環境の分かれ目そのもの★。本番は本番倉庫＋env:prod。ここを写すと本番がテスト倉庫を向く',
};
const SKIP_DIR = new Set(['.git', 'node_modules', '.vercel']);

function walk(rel, out) {
  for (const f of fs.readdirSync(path.join(ROOT, rel || '.'))) {
    if (SKIP_DIR.has(f)) continue;
    const r = rel ? path.posix.join(rel, f) : f;
    if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r, out);
    else out.push(r);
  }
  return out;
}

const args = process.argv.slice(2);
const toIdx = args.indexOf('--to');
if (toIdx < 0 || !args[toIdx + 1]) {
  console.log('使い方: node scripts/mirror-to-prod.mjs --to ../timeally [--check]');
  process.exit(2);
}
const DEST = path.resolve(ROOT, args[toIdx + 1]);
const check = args.includes('--check');

if (!fs.existsSync(DEST)) {
  if (check) { console.log('★中止★ 写す先がありません: ' + DEST); process.exit(1); }
  fs.mkdirSync(DEST, { recursive: true });
}

const files = walk('', []);
let copied = 0, same = 0, kept = 0, added = 0;
const diff = [];

for (const rel of files) {
  const src = path.join(ROOT, rel), dst = path.join(DEST, rel);
  if (KEEP_THEIRS[rel]) { kept++; continue; }
  const a = fs.readFileSync(src);
  const b = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
  if (b && a.equals(b)) { same++; continue; }
  if (!b) added++;
  diff.push(rel);
  if (!check) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, a);
    copied++;
  }
}

/* 本番repo側にだけ在る余り物（消したファイルが残ると死にコードになる） */
const theirs = fs.existsSync(DEST) ? walkDest('', []) : [];
function walkDest(rel, out) {
  for (const f of fs.readdirSync(path.join(DEST, rel || '.'))) {
    if (SKIP_DIR.has(f)) continue;
    const r = rel ? path.posix.join(rel, f) : f;
    if (fs.statSync(path.join(DEST, r)).isDirectory()) walkDest(r, out);
    else out.push(r);
  }
  return out;
}
const extra = theirs.filter((r) => !files.includes(r) && !KEEP_THEIRS[r]);

console.log(`\n[mirror] ${check ? '差分を数えるだけ' : '写した'}: ${DEST}`);
console.log(`  同じ: ${same}本 / ${check ? '違う' : '写した'}: ${check ? diff.length : copied}本（うち新規 ${added}本）`);
console.log(`  ★写さなかった物★: ${kept}本`);
for (const [f, why] of Object.entries(KEEP_THEIRS)) console.log(`    - ${f} … ${why}`);
if (diff.length) { console.log('  中身が違う物:'); diff.slice(0, 40).forEach((f) => console.log('    - ' + f)); }
if (extra.length) {
  console.log('  ★本番repoにだけ在る（消し忘れ）★:');
  extra.forEach((f) => console.log('    - ' + f));
}
if (check && (diff.length || extra.length)) process.exit(1);
if (!check) console.log('\n★次にやる事★ 写した先で node tests/run.js を1回走らせる（env が prod 側で緑になるか）');
