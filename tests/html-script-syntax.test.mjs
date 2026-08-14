/* html-script-syntax.test.mjs — ★HTMLの中のJSが 構文として通るか★（Timeally）
 * =============================================================================
 * ★出どころ★: daikou-seikyu-test/tests/html-script-syntax.test.js（2026-08-12）
 *   指示役から回ってきた。あちらが実物で踏んだ事故:
 *     HTMLの <script> に ★エスケープ落ちの構文エラー★ を作り、
 *     ★アプリが1行も動かない★のに ★lint も試験も緑のまま★だった。
 *       ・lint は HTML の中の <script> を見ない
 *       ・試験は HTML を ★文字として読む★だけで実行しない
 *
 * ★Timeally で見る所を増やした★（うちの作りに合わせて）:
 *   ① HTML の <script>（src= の無い物）
 *   ② ★HTMLの中の onclick= / onchange= / oninput= の中身★
 *      … うちは日付欄で onclick="try{this.showPicker()}catch(e){}" を使う
 *   ③ ★JSが組み立てて画面に差し込む onclick★（lib/tc-ui.js の dateField）
 *      … これは HTML には無いので ①②では見えない。関数を呼んで中身を取り出して見る
 *
 * 実行はしない（構文だけ）＝速い。直した直後に必ず気づける。
 *
 * 使い方: node tests/html-script-syntax.test.mjs
 *         node tests/html-script-syntax.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));

/** <script>（src= の無い物）の中身を、HTMLでの開始行つきで返す */
export function inlineScripts(html) {
  const out = [];
  const RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = RE.exec(html))) {
    out.push({ code: m[1], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}

/** HTMLの中の onXxx="…" の中身を返す */
export function inlineHandlers(html) {
  const out = [];
  const RE = /\bon(click|change|input|submit|load)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = RE.exec(html))) {
    out.push({ code: m[2], line: html.slice(0, m.index).split('\n').length, attr: 'on' + m[1] });
  }
  return out;
}

/** 構文だけ見る（実行はしない）。通れば null、駄目なら理由。 */
export function syntaxError(code) {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
    return null;
  } catch (e) {
    return e.message;
  }
}

const HTML = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

if (process.argv.includes('--self-test')) {
  console.log('\n[html-script-syntax --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('① 通る物を弾かない・壊れた物を通さない', () => {
    ok(syntaxError('var a = 1;') === null, '通る物を弾いている');
    // 指示役が実際に作ってしまったのと同じ形（エスケープ落ちで引用符が閉じない）
    ok(syntaxError("var s = '\" onclick=\"f('' + x;") !== null, '壊れた物を通している');
    ok(syntaxError('function f( {') !== null, '壊れた物を通している');
  });
  S('② <script> を取り出せている（0本なら何も見ていない）', () => {
    const n = HTML.reduce((a, f) => a + inlineScripts(fs.readFileSync(path.join(ROOT, f), 'utf8')).length, 0);
    ok(n >= HTML.length, '取り出せた <script> が少なすぎる: ' + n);
  });
  S('③ onXxx= を取り出せている（0本なら何も見ていない）', () => {
    ok(inlineHandlers('<input onclick="a()" onchange="b()">').length === 2, '取り出せていない');
    ok(inlineHandlers('<input src="x.js">').length === 0, '誤検知');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[HTMLの中のJSが構文として通るか]');

T('★見ている画面が実在する（0枚なら何も見ていない）', () => {
  ok(HTML.length >= 5, '画面が少なすぎる: ' + HTML.length);
});

T('★<script> を実際に取り出せている（0本なら赤）', () => {
  let n = 0;
  const per = [];
  HTML.forEach((f) => {
    const c = inlineScripts(fs.readFileSync(path.join(ROOT, f), 'utf8')).length;
    n += c; per.push(f + ':' + c);
  });
  ok(n > 0, '★1本も取り出せていない＝この検査が空振り★');
  const zero = HTML.filter((f) => inlineScripts(fs.readFileSync(path.join(ROOT, f), 'utf8')).length === 0);
  ok(zero.length === 0, '<script> が1本も無い画面: ' + zero.join(', '));
  console.log('     実測: ' + n + '本（' + per.join(' / ') + '）');
});

T('★HTMLの中の <script> が全部 構文OK', () => {
  const bad = [];
  HTML.forEach((f) => {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    inlineScripts(html).forEach((s) => {
      const e = syntaxError(s.code);
      if (e) bad.push(f + ' の ' + s.line + '行目からの <script>: ' + e);
    });
  });
  ok(bad.length === 0, bad.join(' / '));
});

T('★HTMLの中の onclick= / onchange= も全部 構文OK', () => {
  const bad = [];
  let n = 0;
  HTML.forEach((f) => {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    inlineHandlers(html).forEach((s) => {
      n++;
      const e = syntaxError(s.code);
      if (e) bad.push(f + ' の ' + s.line + '行目の ' + s.attr + ': ' + e);
    });
  });
  ok(bad.length === 0, bad.join(' / '));
  console.log('     実測: ' + n + '個');
});

T('★JSが組み立てて差し込む onclick も構文OK（HTMLには出てこない＝上の検査では見えない）', () => {
  const U = require_(path.join(ROOT, 'js/tc-ui.js')) || global.TcUi;
  const Ui = global.TcUi || U;
  ok(Ui && typeof Ui.dateField === 'function', 'lib を読めていない');
  const cases = [
    Ui.dateField('2026-08-14', ''),
    Ui.dateField('', 'redraw()'),
    Ui.dateField(null, 'setEntryDate(1)'),
  ];
  const bad = [];
  let n = 0;
  cases.forEach((html, i) => {
    const hs = inlineHandlers(html);
    n += hs.length;
    hs.forEach((s) => { const e = syntaxError(s.code); if (e) bad.push('dateField#' + i + ' ' + s.attr + ': ' + e); });
  });
  ok(n >= 6, '組み立てた onXxx が少なすぎる: ' + n + '（取り出し方が壊れている）');
  ok(bad.length === 0, bad.join(' / '));
  console.log('     実測: ' + n + '個');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
