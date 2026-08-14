/* stamp-build.mjs — ★配信物の ?v=… を貼り直す（HTTPキャッシュ対策）★（Timeally）
 * =============================================================================
 * なぜ要るのか:
 *   GitHub Pages は ★HTTPキャッシュが効く★。js/css を直しても、客の端末は
 *   ★古いファイルを掴んだまま★になる（「直したのに出ない」の正体）。
 *   だから ★全部の script/link に ?v=<中身から作った印> を付ける★。
 *
 * ★印は「中身のハッシュ」から作る（日時ではない）★
 *   日時だと 何も変えていない日も全部が別物になって、キャッシュが毎回捨てられる。
 *   ★改行はLFに直してから数える★（Windowsで作ると CRLF になり、
 *     同じ中身なのに印が変わる＝CIと手元で食い違う。.gitattributes でも縛っている）
 *
 * 使い方: node scripts/stamp-build.mjs          … 貼り直す
 *         node scripts/stamp-build.mjs --check  … ★貼り忘れがあれば赤★（CIはこれ）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();

/* 印の材料＝配信される js/css。★HTMLは材料に入れない★（印を書き込むと自分が変わる） */
function assets() {
  const out = [];
  for (const dir of ['js', 'lib', 'css']) {
    const p = path.join(ROOT, dir);
    if (!fs.existsSync(p)) continue;
    for (const f of fs.readdirSync(p).sort()) {
      if (/\.(js|css)$/i.test(f)) out.push(path.posix.join(dir, f));
    }
  }
  return out;
}

export function stampOf() {
  const h = crypto.createHash('sha256');
  for (const rel of assets()) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
    h.update(rel + '\0' + text + '\0');
  }
  return h.digest('hex').slice(0, 8);
}

/* 貼る対象＝相対パスの src= / href=（外のCDN・フォントは触らない） */
const TARGET = /\b(src|href)="((?!https?:|\/\/|#|mailto:|data:)[^"]+?)(\?v=[0-9a-f]{7,8})?"/g;

export function restamp(html, stamp) {
  return html.replace(TARGET, (m, attr, url) => `${attr}="${url}?v=${stamp}"`);
}

const stamp = stampOf();
const check = process.argv.includes('--check');
let changed = 0;
const missing = [];

for (const f of HTML) {
  const p = path.join(ROOT, f);
  const before = fs.readFileSync(p, 'utf8');
  const after = restamp(before, stamp);
  if (before !== after) {
    changed++;
    missing.push(f);
    if (!check) fs.writeFileSync(p, after);
  }
}

console.log(`\n[stamp-build] 印: ${stamp}（材料 ${assets().length}本 / 画面 ${HTML.length}枚）`);
if (check) {
  if (changed) {
    console.log('✗ ★貼り忘れ★ 次の画面の ?v= が中身と合っていません:');
    missing.forEach((f) => console.log('   - ' + f));
    console.log('   直し方: node scripts/stamp-build.mjs して、その差分もコミットする');
    process.exit(1);
  }
  console.log('✓ 全部の画面の ?v= が中身と合っています');
} else {
  console.log(changed ? `✓ ${changed}枚を貼り直しました` : '✓ 貼り直す物はありませんでした');
}
