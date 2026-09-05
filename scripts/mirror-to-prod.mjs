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
 *   ★*.log … 手元の記録（見張りが走った記録・赤の控え）＝repoの中身ではない★
 *
 * ★★この門が 守る物・守らない物（2026-09-06 指示役）★★
 *   ★この門は「★見た★」を 強制しません★。
 *   ★`--check` を 走らせただけで、中身を 1行も 読まなくても 通ります★。
 *   ★この門が 作るのは 2つだけ★
 *     ① ★見る 機会★（差分と 余り物が 目の前に 出る）
 *     ② ★見た後で 変わっていない事★（指紋が 合う／30分 以内）
 *   ⇒★「門が 在るから 大丈夫」では ありません★。★読むのは 人の 仕事★です。
 *   （★守る範囲を 書かない機械は、置いた人も 読む人も「全部 守られた」と 思います★）
 *
 * 使い方:
 *   node scripts/mirror-to-prod.mjs --to ../timeally --check    … ★差分を数えるだけ（先にこれ）★
 *   node scripts/mirror-to-prod.mjs --to ../timeally            … 写す（★--check を通らないと 写しません★）
 *
 * ★写した後は 本番repo側で node tests/run.js を必ず1回走らせる★
 *   （env が prod になるので、帯の検査は「出ない」側を見る作りにしてある）
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★写さない物（理由つき）★ */
export const KEEP_THEIRS = {
  'js/supa-config.js': '★環境の分かれ目そのもの★。本番は本番倉庫＋env:prod。ここを写すと本番がテスト倉庫を向く',
};
const SKIP_DIR = new Set(['.git', 'node_modules', '.vercel']);
/* ★手元の記録（*.log）は 写さない★（2026-09-06 実測して分かった）
   ・`*.git に入らない物`＝★repo の中身ではない★（見張りが 走った記録・赤の控え）
   ・写すと ★本番repo に 手元の記録が 生える★
   ・さらに ★--check の 札そのもの（mirror-check.log）が 中身に 入って
     見た直後でも 指紋が 変わる★＝★写せなくなる★（実際に 1回 踏んだ） */
const skipFile = (name) => /\.log$/.test(name);

function walk(rel, out) {
  for (const f of fs.readdirSync(path.join(ROOT, rel || '.'))) {
    if (SKIP_DIR.has(f) || skipFile(f)) continue;
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

if (!fs.existsSync(DEST) && check) {
  console.log('★中止★ 写す先がありません: ' + DEST); process.exit(1);
}
/* ★写す先を 先に 作らない★＝★--check を通らずに 止める時に 空の入れ物だけ 作らない★
   （「写しません」と言いながら フォルダが出来ていると 次に見た人が 迷う） */

const files = walk('', []);
let copied = 0, same = 0, kept = 0, added = 0;
const diff = [];
const yubi = [];   /* ★何を写すかの指紋★（名前＋中身のSHA）＝「見た物」と「写す物」を突き合わせる為 */

for (const rel of files) {
  const src = path.join(ROOT, rel), dst = path.join(DEST, rel);
  if (KEEP_THEIRS[rel]) { kept++; continue; }
  const a = fs.readFileSync(src);
  const b = fs.existsSync(dst) ? fs.readFileSync(dst) : null;
  if (b && a.equals(b)) { same++; continue; }
  if (!b) added++;
  diff.push(rel);
  yubi.push(rel + ':' + crypto.createHash('sha256').update(a).digest('hex'));
}

/* 本番repo側にだけ在る余り物（消したファイルが残ると死にコードになる） */
const theirs = fs.existsSync(DEST) ? walkDest('', []) : [];
function walkDest(rel, out) {
  for (const f of fs.readdirSync(path.join(DEST, rel || '.'))) {
    if (SKIP_DIR.has(f) || skipFile(f)) continue;
    const r = rel ? path.posix.join(rel, f) : f;
    if (fs.statSync(path.join(DEST, r)).isDirectory()) walkDest(r, out);
    else out.push(r);
  }
  return out;
}
const extra = theirs.filter((r) => !files.includes(r) && !KEEP_THEIRS[r]);

/* ★★--check を通らないと 写せない★★（2026-09-06 指示役の宿題②）
   ★前科は 2件とも「見ずに 写した」★
     ・片方だけ直して 本番が6日 そのままだった
     ・テスト用の直書きが 付いてきて 本番倉庫を触った
   ⇒★人が 忘れる所を 機械に 持たせる★
   ★見た証拠＝指紋★（写す先＋写す物の 名前と中身のSHA＋余り物）／★30分で 切れる★
   ＝★見てから 直したら 別物★なので もう一度 見せる。 */
const FUDA = path.join(ROOT, 'mirror-check.log');
const NL = String.fromCharCode(10);
const TAB = String.fromCharCode(9);
const SIMON = crypto.createHash('sha256')
  .update([DEST, yubi.slice().sort().join(','), 'X:' + extra.slice().sort().join(',')].join(NL))
  .digest('hex');
const INOCHI = 30 * 60 * 1000;

function mitaKiroku() {
  try {
    const t = fs.readFileSync(FUDA, 'utf8').trim().split(NL);
    const [iso, simon, dest] = (t[t.length - 1] || '').split(TAB);
    return iso && simon ? { iso, simon, dest } : null;
  } catch { return null; }
}

if (check) {
  /* ★見た事を 残す★（次の「写す」が この指紋と 合う時だけ 通る） */
  fs.appendFileSync(FUDA, [new Date().toISOString(), SIMON, DEST].join(TAB) + NL, 'utf8');
} else {
  const mita = mitaKiroku();
  const tomeru = (riyuu) => {
    console.log(NL + '★写しません★ … ' + riyuu);
    console.log('  ★先に 見てください★ … node scripts/mirror-to-prod.mjs --to '
      + args[toIdx + 1] + ' ★--check★');
    console.log('  ★写せるのは その後 30分 以内・中身が 同じ間だけ★');
    process.exit(1);
  };
  if (!mita) tomeru('★--check を 1度も 走らせていません（見ずに 写さない）★');
  if (mita.simon !== SIMON) {
    console.log('  見た時 … ' + mita.iso + '（写す先 ' + (mita.dest || '?') + '）');
    tomeru('★--check で 見た物と 中身が 違います★（見た後に 直した／写す先が 別）');
  }
  const sugita = Date.now() - new Date(mita.iso).getTime();
  if (!(sugita >= 0 && sugita < INOCHI)) {
    tomeru('★--check が 古い★（' + Math.round(sugita / 60000) + '分前・30分で 切れます）');
  }
  console.log(NL + '[mirror] ★--check を 通りました★（見た時 ' + mita.iso
    + '／指紋 ' + SIMON.slice(0, 12) + '…）');
  fs.mkdirSync(DEST, { recursive: true });
  for (const rel of diff) {
    const dst = path.join(DEST, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, fs.readFileSync(path.join(ROOT, rel)));
    copied++;
  }
}

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
