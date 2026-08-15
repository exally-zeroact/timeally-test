/* dead-check.mjs — ★誰からも呼ばれない物を数える★（Timeally）
 * =============================================================================
 * ★数えるだけで誰も呼ばない物を残さない★（指示役 2026-08-15）。
 * ★src= だけで判定しない★＝ require / import / 文字列参照 / HTMLのid まで数える
 * （前科: 「死にファイル判定に src= だけ使うな」）。
 *
 * 見る物:
 *   ① lib/ と js/ の中の関数（★定義以外での出現が0なら死に★）
 *   ② css/timeally.css の class と id（★どこからも当たらない物★）
 *   ③ HTML の id（★JSが1度も掴まない物★）
 *
 * 使い方: node scripts/dead-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const R = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ls = (d, re) => fs.readdirSync(path.join(ROOT, d)).filter((f) => re.test(f)).map((f) => d + '/' + f);

const CODE = ls('lib', /\.js$/).filter((f) => !/xlsx|qr\.js/.test(f)).concat(ls('js', /\.js$/));
const HTML = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f));
const OTHER = ls('tests', /\.(mjs|js)$/).concat(ls('scripts', /\.mjs$/));

/** 全部の中身（自分の定義行も含む。定義の数は別に数えて引く） */
const HAY = CODE.concat(HTML, OTHER).map(R).join('\n');
const HTML_SRC = HTML.map(R).join('\n');
const CSS = R('css/timeally.css');
const JS_SRC = CODE.map(R).join('\n');

const count = (hay, re) => (hay.match(re) || []).length;
let ng = 0;

/* ── ① 関数 ─────────────────────────────────────────────────── */
const deadFn = [];
CODE.forEach((f) => {
  const src = R(f);
  [...src.matchAll(/^\s*function ([a-zA-Z_][\w]*)/gm)].forEach((m) => {
    const n = m[1];
    const uses = count(HAY, new RegExp('\\b' + n + '\\b', 'g'));
    const defs = count(HAY, new RegExp('function\\s+' + n + '\\b', 'g'));
    if (uses - defs <= 0) deadFn.push(f + ' : ' + n + '()');
  });
});

/* ── ② CSS の class / id ─────────────────────────────────────── */
const deadCss = [];
[...CSS.matchAll(/^\.([a-z][\w-]*)/gm)].forEach((m) => {
  const c = m[1];
  /* HTML の class= と JS の文字列（'tc-xxx' / classList / className）を両方 見る */
  const used = new RegExp('[\'"\\s]' + c + '[\'"\\s]|class="[^"]*\\b' + c + '\\b').test(HTML_SRC + JS_SRC);
  if (!used) deadCss.push('css/timeally.css : .' + c);
});

/* ── ③ HTML の id ───────────────────────────────────────────── */
const deadId = [];
[...HTML_SRC.matchAll(/\sid="([\w-]+)"/g)].forEach((m) => {
  const id = m[1];
  if (deadId.some((x) => x.endsWith(id))) return;
  /* JS が掴んでいるか（getElementById / querySelector / data属性 / CSS） */
  const hay2 = JS_SRC + CSS + OTHER.map(R).join('\n');
  let used = new RegExp('[\'"#]' + id + '[\'"\\s\\.,)]').test(hay2);
  /* ★組み立てて掴む物も 使っている★（例: q(f.id + '-hint')）
     ＝★文字で丸ごと探すと 使っているのに「死に」と出る★（2026-08-15 実際に出た）。
     頭（c-daily など）と 尻尾（-hint など）が両方 在れば 使っていると数える。 */
  if (!used) {
    const i = id.lastIndexOf('-');
    if (i > 0) {
      const head = id.slice(0, i), tail = id.slice(i);
      used = new RegExp('[\'"]' + head + '[\'"]').test(hay2) && new RegExp("['\"]\\" + tail + "['\"]").test(hay2);
    }
  }
  if (!used) deadId.push('html : #' + id);
});

const show = (title, arr) => {
  console.log('■ ' + title + ': ' + arr.length + '件');
  arr.forEach((x) => console.log('   ' + x));
  if (arr.length) ng += arr.length;
};
console.log('\n[死にコードの棚卸し]（★src= だけで判定しない★）');
show('誰からも呼ばれない関数', deadFn);
show('どこからも当たらない CSS', deadCss);
show('JSが1度も掴まない id', deadId);
console.log('\n見た物: コード ' + CODE.length + '本 / 画面 ' + HTML.length + '枚 / 検査と道具 ' + OTHER.length + '本');
console.log(ng ? '★' + ng + '件 残っています★' : '★誰からも呼ばれない物は 0件★');
process.exit(ng ? 1 : 0);
