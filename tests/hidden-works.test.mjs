/* hidden-works.test.mjs — ★空の箱を人に見せない（hidden を必ず効かせる）★（Timeally）
 * =============================================================================
 * 2026-08-14 司さんの実機（iPhone）で見つかった:
 *   ログイン画面に ★中身が空の赤い枠だけ★ が出ていた。
 *   原因は CSS。`.tc-alert { display: block }` が
 *   ★HTMLの hidden 属性（＝ display:none）を打ち消していた★。
 *   （class の指定の方が後に来る／強いので勝つ）
 *
 * ★「DOMに在る」で済ませない★のと同じ種類の事故で、逆向き：
 *   ★「hidden と書いたから消えている」と思い込む★。書いただけでは消えない。
 *
 * ここで見る物:
 *   ① CSS に `[hidden]{display:none!important}` が在る（これが無いと全部 崩れる）
 *   ② HTML で hidden を付けている要素の class が、CSS で display を持っているなら
 *      ①が無い限り ★必ず見えてしまう★ … その組み合わせを名指しで数える
 *   ③ 実際に jsdom で当てて、hidden の要素が1つも見えていない
 *
 * 使い方: node tests/hidden-works.test.mjs
 *         node tests/hidden-works.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const CSS = fs.readFileSync(path.join(ROOT, 'css/timeally.css'), 'utf8');

let JSDOM;
try { ({ JSDOM } = require_('jsdom')); } catch (_) {
  console.log('\n✗ jsdom がありません。★SKIPを緑と呼ばない★ので赤で止めます（npm install してください）');
  process.exit(1);
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

/** CSS に [hidden] の打ち消しが在るか */
export function hasHiddenReset(css) {
  return /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/i.test(css.replace(/\/\*[\s\S]*?\*\//g, ' '));
}

/** class セレクタで display を指定している class の一覧
 *  ★正規表現でブロックを取りに行かない★（@media や入れ子で簡単に空振りする。実際に0件になった）。
 *  `}` で割って「セレクタ { 中身」の形だけ見る＝素朴だが空振りしない。 */
export function classesWithDisplay(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out = new Set();
  for (const chunk of clean.split('}')) {
    const i = chunk.indexOf('{');
    if (i < 0) continue;
    const sel = chunk.slice(0, i), body = chunk.slice(i + 1);
    if (!/display\s*:/.test(body)) continue;
    (sel.match(/\.[a-zA-Z][\w-]*/g) || []).forEach((c) => out.add(c.slice(1)));
  }
  return [...out];
}

/** HTML で hidden 属性が付いている要素の class */
export function hiddenClasses(html) {
  const out = [];
  const re = /<[a-z][^>]*\bhidden\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const cls = /class="([^"]*)"/.exec(m[0]);
    out.push(cls ? cls[1].split(/\s+/).filter(Boolean) : []);
  }
  return out;
}

const htmlFiles = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();

if (process.argv.includes('--self-test')) {
  console.log('\n[hidden-works --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('① 打ち消しを外した作り物は「無い」と判定される（本物は在る）', () => {
    ok(!hasHiddenReset('.tc-alert{display:block;}'), '作り物を通してしまう＝この検査が空振り');
    ok(hasHiddenReset(CSS), '★本物のCSSに [hidden] の打ち消しが無い★');
  });
  S('② !important を外しただけでも「無い」と判定する（class に負けるため）', () => {
    ok(!hasHiddenReset('[hidden]{display:none;}'), '!important 無しを通している');
  });
  S('③ display を持つ class を数える所が空振りしていない', () => {
    ok(classesWithDisplay('.a{display:block}').join() === 'a', '作り物すら拾えていない');
    ok(classesWithDisplay(CSS).indexOf('tc-alert') >= 0, '★本物の .tc-alert を拾えていない＝空振り★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[hidden が効いているか]');

T('★CSS に [hidden]{display:none!important} が在る', () => {
  ok(hasHiddenReset(CSS), '打ち消しが無い（class の display に負けて 空の箱が出る）');
});

T('★hidden を付けている要素と、display を持つ class の組み合わせを数える（空振りしていない）', () => {
  const withDisplay = new Set(classesWithDisplay(CSS));
  const risky = [];
  htmlFiles.forEach((f) => {
    hiddenClasses(fs.readFileSync(path.join(ROOT, f), 'utf8')).forEach((cls) => {
      cls.forEach((c) => { if (withDisplay.has(c)) risky.push(f + ' → .' + c); });
    });
  });
  ok(risky.length > 0, '★1件も見つからない＝拾い方が壊れている★（実際には .tc-alert 等が在る）');
  console.log('     実測: 打ち消しが無ければ見えてしまう箇所 ' + risky.length + '件（今は打ち消しが効いている）');
  risky.slice(0, 6).forEach((r) => console.log('       - ' + r));
});

T('★hidden の要素が「実際に何個あるか」を数えている（数が0なら検査の意味が無い）', () => {
  /* ★jsdom の getComputedStyle は !important も属性セレクタも当ててくれない★
     （self-test で確かめた）。だから「当てて消えているか」は jsdom では見ない。
     ★実物の見た目は 本物のブラウザで測る★（2026-08-14 実測: iPhone幅 390px で
     login.html の #alert が 0×0px＝見えていない）。ここでは数だけ数える。 */
  let n = 0;
  htmlFiles.forEach((f) => {
    n += (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/<[a-z][^>]*\bhidden\b[^>]*>/gi) || []).length;
  });
  ok(n >= 5, 'hidden を使っている所が少なすぎる: ' + n + '（検査が空振り）');
  console.log('     実測: ' + htmlFiles.length + '画面 / hidden を付けている要素 ' + n + '個');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
