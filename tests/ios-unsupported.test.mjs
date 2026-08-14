/* ios-unsupported.test.mjs — ★iPhone で動かない書き方を止める★（Timeally）
 * =============================================================================
 * 実際に踏んだ物だけを並べてある（思いつきの禁止事項は入れない）:
 *   ① ★octet-stream で落とす★  … iPhone が種類を見分けられず「Excelで開く」が出ない
 *   ② ★Blob を あちこちで作る★ … 渡し口を1つにしないと ①がまた生える
 *   ③ ★<input type="month">★   … iOS Safari が出さない（月の選択が沈黙する）
 *   ④ ★入力欄が16px未満★       … iPhone が勝手に拡大してスクロールが壊れる
 *   ⑤ ★後読み正規表現 (?<=…)★  … 古い iOS の WebKit が構文エラーで ★丸ごと落ちる★
 *   ⑥ ★生ファイルへの a に target="_blank" が無い★
 *        … ホーム画面から開いたアプリで、同じ窓にファイルが開いて ★戻れなくなる★
 *
 * 使い方: node tests/ios-unsupported.test.mjs
 *         node tests/ios-unsupported.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = new Set(['lib/xlsx.full.min.js', 'lib/qr.js', 'js/file-out.js']);

function ours() {
  const out = [];
  for (const f of fs.readdirSync(ROOT)) if (/\.html$/i.test(f)) out.push(f);
  for (const dir of ['js', 'lib', 'css']) {
    const p = path.join(ROOT, dir);
    if (!fs.existsSync(p)) continue;
    for (const f of fs.readdirSync(p)) {
      const rel = path.posix.join(dir, f);
      if (VENDOR.has(rel)) continue;
      if (/\.(js|css)$/i.test(f)) out.push(rel);
    }
  }
  return out.sort();
}
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/** ★CSSはコメントを落としてから見る★
 *  説明文に「`.tc-alert { display: block }` と書くと hidden が効かない」のような
 *  ★実物そっくりの例★を書いた瞬間、素朴な正規表現は ★説明文の方を先に拾う★（実際に踏んだ）。 */
const readCss = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, ' ');
function strip(src) {
  return src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

if (process.argv.includes('--self-test')) {
  console.log('\n[ios-unsupported --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  const has = (t, re) => re.test(strip(t));
  S('① octet-stream を混ぜたら捕まえる', () => ok(has("type:'application/octet-stream'", /octet-stream/)));
  S('② type="month" を混ぜたら捕まえる', () => ok(has('<input type="month">', /type=["']month["']/)));
  S('③ 後読み正規表現を混ぜたら捕まえる', () => ok(has('/(?<=a)b/', /\(\?<[=!]/)));
  S('④ 14px の入力欄を混ぜたら捕まえる', () => {
    const css = 'input{font-size:14px;}';
    const m = /input[^{]*\{([^}]*)\}/.exec(css);
    ok(m && /font-size:\s*1[0-5]px/.test(m[1]), '作り物を捕まえられない＝この検査が空振り');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[iPhoneで動かない書き方]');

const files = ours();
T('★うちのファイルを実際にめくっている（空振りしていない）', () => {
  ok(files.length >= 12, '見たファイルが少なすぎる: ' + files.length);
  console.log('     実測: ' + files.length + '本（借り物 ' + VENDOR.size + '本は除く）');
});

T('★octet-stream を書いていない（種類が分からないと iPhone で開けない）', () => {
  const bad = files.filter((f) => /octet-stream/.test(strip(read(f))));
  ok(bad.length === 0, bad.join(', '));
});

T('★Blob を作るのは渡し口(js/file-out.js)だけ', () => {
  const bad = files.filter((f) => /new Blob\s*\(/.test(strip(read(f))));
  ok(bad.length === 0, 'Blob を自分で作っている: ' + bad.join(', '));
});

T('★<input type="month"> を使っていない（iOS Safari が出さない）', () => {
  const bad = files.filter((f) => /type=["']month["']/.test(strip(read(f))));
  ok(bad.length === 0, bad.join(', '));
});

T('★後読み正規表現 (?<=…) を使っていない（古いiOSで丸ごと落ちる）', () => {
  const bad = files.filter((f) => /\(\?<[=!]/.test(strip(read(f))));
  ok(bad.length === 0, bad.join(', '));
});

T('★入力欄が16px以上（小さいと iPhone が拡大してスクロールが壊れる）', () => {
  const css = readCss('css/timeally.css');
  const blocks = css.split('}');
  const bad = blocks.filter((b) => /input|select|textarea/.test(b) && /font-size:\s*(\d+)px/.test(b)
    && Number(/font-size:\s*(\d+)px/.exec(b)[1]) < 16);
  ok(bad.length === 0, '16px未満の入力欄がある');
});

T('★ホーム画面アプリで戻れなくならない（渡し口が target="_blank" を付けている）', () => {
  ok(/a\.target = '_blank'/.test(read('js/file-out.js')), '渡し口に target="_blank" が無い');
});

T('★上に隙間/スクロール崩れを作らない（safe-area を見ている）', () => {
  const css = readCss('css/timeally.css');
  ok(/env\(safe-area-inset-top\)/.test(css), '上の safe-area を見ていない');
  ok(/env\(safe-area-inset-bottom\)/.test(css), '下の safe-area を見ていない');
});

T('★注意書きを flex/grid の箱に直接入れていない（1文字ずつ縦に割れる・前科3回）', () => {
  const css = readCss('css/timeally.css');
  ['tc-note', 'tc-alert', 'tc-toast'].forEach((cls) => {
    const m = new RegExp('\\.' + cls + '\\s*\\{([^}]*)\\}').exec(css);
    ok(m, '.' + cls + ' が無い');
    ok(!/display\s*:\s*(flex|grid)/.test(m[1]), '.' + cls + ' が flex/grid');
    ok(/white-space\s*:\s*normal/.test(m[1]), '.' + cls + ' が折り返せない');
    ok(/overflow-wrap\s*:\s*break-word/.test(m[1]), '.' + cls + ' が長い語ではみ出す');
    ok(!/word-break\s*:\s*break-all/.test(m[1]), '.' + cls + ' に break-all がある');
  });
});

T('★ボタンの文字が折り返さない（スマホ幅で2行に割れない）', () => {
  const css = readCss('css/timeally.css');
  const m = /\.tc-btn\s*\{([^}]*)\}/.exec(css);
  ok(m && /white-space\s*:\s*nowrap/.test(m[1]), 'ボタンが折り返す');
  ok(/min-height:\s*44px/.test(m[1]), '指で押せる大きさ(44px)が無い');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
