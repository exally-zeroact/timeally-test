/* palette.test.mjs — ★色は文字列で探さない。値に直して数える★（Timeally）
 * =============================================================================
 * なぜ:
 *   同じ色が ★6通りの書き方★で隠れる（#fff / #FFF / #ffffff / rgb() / rgba() / hsl()）。
 *   「#1A4A2E で grep」だけの見張りは ★-i を付け忘れて40件 見落とした★前科がある。
 *   ⇒ ★全部 RGBの数値に直してから数える★。場所も当てない（配信物を全部めくる）。
 *
 * 承認済みの色（2026-08-14・変更禁止）＋ 足してよい2色 だけを許す。
 * ★全アプリ禁止の濃い緑★ は、値に直した上で名指しで赤にする。
 *
 * 使い方: node tests/palette.test.mjs
 *         node tests/palette.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★承認済みの8色★ */
export const APPROVED = {
  '#FFC72C': '主＝面（帯・ボタン）',
  '#F0B400': '縁・押した時',
  '#8F6200': '濃＝文字/数字（白地5.33）',
  '#FFE08A': '明＝選択中',
  '#FFFBF0': '淡背景',
  '#F0E0B8': '淡境界',
  '#78705C': '補助文字',
  '#2B2418': '黄の上の文字',
};
/* ★足してよい2色（理由つき）★ */
export const EXTRA = {
  '#FFFFFF': '白（面の下地）',
  '#B3261E': '注意・警告の赤（白文字で6.5）。★注意の橙は使わない＝主色の黄と混ざるため★',
};
/* ★全アプリ禁止★（値で持つ。文字で書かない＝他の見張りと喧嘩しない） */
const BANNED = [[0x1a, 0x4a, 0x2e]];

const FILES = ['css', 'js', 'lib'];
const SKIP_FILE = new Set(['xlsx.full.min.js', 'qr.js']);   // 借り物（うちの色ではない）

/** 文字列の中の色を ★全部★ 拾って [r,g,b] に直す */
export function colorsOf(text) {
  const out = [];
  let m;
  const hex = /#([0-9a-fA-F]{3,8})\b/g;
  while ((m = hex.exec(text))) {
    const h = m[1];
    if (h.length === 3) out.push([p(h[0] + h[0]), p(h[1] + h[1]), p(h[2] + h[2])]);
    else if (h.length === 6 || h.length === 8) out.push([p(h.slice(0, 2)), p(h.slice(2, 4)), p(h.slice(4, 6))]);
  }
  const rgb = /rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g;
  while ((m = rgb.exec(text))) out.push([+m[1], +m[2], +m[3]]);
  const hsl = /hsla?\(\s*([\d.]+)[\s,]+([\d.]+)%[\s,]+([\d.]+)%/g;
  while ((m = hsl.exec(text))) out.push(hslToRgb(+m[1], +m[2] / 100, +m[3] / 100));
  return out;
}
function p(s) { return parseInt(s, 16); }
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), mm = l - c / 2;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor((h % 360) / 60)];
  return t.map((v) => Math.round((v + mm) * 255));
}
const key = (c) => '#' + c.map((v) => ('0' + v.toString(16)).slice(-2)).join('').toUpperCase();

/** 透ける黒・白（影・被せ物）は許す。それ以外は許可リストに無ければ違反。 */
export function findBad(text) {
  const allow = new Set(Object.keys(APPROVED).concat(Object.keys(EXTRA)));
  const bad = [];
  for (const c of colorsOf(text)) {
    const k = key(c);
    if (allow.has(k)) continue;
    if (k === '#000000') continue;                    // 影（rgba(0,0,0,.18) など）
    bad.push(k);
  }
  return [...new Set(bad)];
}
export function findBanned(text) {
  return colorsOf(text).filter((c) => BANNED.some((b) => b[0] === c[0] && b[1] === c[1] && b[2] === c[2]));
}

function shipped() {
  const out = [];
  for (const f of fs.readdirSync(ROOT)) if (/\.html$/i.test(f)) out.push(f);
  for (const dir of FILES) {
    const p2 = path.join(ROOT, dir);
    if (!fs.existsSync(p2)) continue;
    for (const f of fs.readdirSync(p2)) {
      if (SKIP_FILE.has(f)) continue;
      if (/\.(css|js)$/i.test(f)) out.push(path.posix.join(dir, f));
    }
  }
  return out.sort();
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

if (process.argv.includes('--self-test')) {
  console.log('\n[palette --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  S('①「文字で探す」やり方は 書き方を変えると見逃す（値に直す本物は見つける）', () => {
    const naive = (t) => /#FFC72C/.test(t);
    ok(!naive('color: rgb(255, 199, 44)'), '作り物が見つけてしまう＝この検査が空振り');
    ok(colorsOf('color: rgb(255, 199, 44)').length === 1, '★本物が rgb() を拾えていない★');
    ok(key(colorsOf('color: rgb(255, 199, 44)')[0]) === '#FFC72C', '★本物が値に直せていない★');
  });
  S('② 3桁の #fff も 8桁の #ffffffcc も同じ白として拾う', () => {
    ok(key(colorsOf('#fff')[0]) === '#FFFFFF');
    ok(key(colorsOf('#ffffffcc')[0]) === '#FFFFFF');
  });
  S('③ 承認外の色を混ぜたら赤になる', () => {
    ok(findBad('color:#123456').length === 1, '拾えていない');
    ok(findBad('color:#FFC72C').length === 0, '誤検知');
  });
  S('④ ★禁止の濃い緑★ は書き方を変えても捕まえる', () => {
    ok(findBanned('background: rgb(26, 74, 46)').length === 1, 'rgb()で書かれた禁止色を見逃す');
    ok(findBanned('background:#1a4a2e').length === 1, '小文字の禁止色を見逃す');
    ok(findBanned('background:#2E7D54').length === 0, '誤検知');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[配色] 承認済みの色だけを使っているか（値に直して数える）');

const files = shipped();
T('★配信物を実際にめくっている（空振りしていない）', () => {
  ok(files.length >= 10, '見たファイルが少なすぎる: ' + files.length);
  let total = 0;
  files.forEach((f) => { total += colorsOf(fs.readFileSync(path.join(ROOT, f), 'utf8')).length; });
  ok(total >= 20, '色を1つも拾えていない＝拾い方が壊れている: ' + total);
  console.log('     実測: ' + files.length + '本 / 色の出現 ' + total + '回');
});

T('★承認済みの色（＋白・赤）以外を使っていない', () => {
  const bad = [];
  files.forEach((f) => {
    findBad(fs.readFileSync(path.join(ROOT, f), 'utf8')).forEach((c) => bad.push(f + ' → ' + c));
  });
  ok(bad.length === 0, '承認外の色:\n   - ' + bad.join('\n   - '));
});

T('★全アプリ禁止の濃い緑を使っていない（0件）', () => {
  let n = 0;
  files.forEach((f) => { n += findBanned(fs.readFileSync(path.join(ROOT, f), 'utf8')).length; });
  ok(n === 0, '禁止色が ' + n + '件');
  console.log('     実測: 0件');
});

T('★黄を文字色に使っていない（白地1.6＝読めない）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/timeally.css'), 'utf8');
  const yellowAsText = /(^|[;{\s])color\s*:\s*#(FFC72C|F0B400|FFE08A)/i.test(css);
  ok(!yellowAsText, '★黄を color: に使っている★');
});

T('★黄の面の上は黒い文字（白文字を置いていない）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/timeally.css'), 'utf8');
  const blocks = css.split('}');
  const bad = blocks.filter((b) => /background\s*:\s*#(FFC72C|F0B400|FFE08A)/i.test(b) && /color\s*:\s*#(FFFFFF|FFF)\b/i.test(b));
  ok(bad.length === 0, '黄の面に白文字を置いている');
});

T('★注意の橙を使っていない（主色と混ざる）', () => {
  const bad = [];
  files.forEach((f) => {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    if (/#92500A|#FF9900|#FFA500/i.test(t)) bad.push(f);
  });
  ok(bad.length === 0, '橙を使っている: ' + bad.join(', '));
});

T('★入力欄は16px（小さいと iPhone が勝手に拡大してスクロールが壊れる）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/timeally.css'), 'utf8');
  const m = /input\[type='text'\][\s\S]*?\{([\s\S]*?)\}/.exec(css);
  ok(m, '入力欄の指定が読めない');
  ok(/font-size:\s*16px/.test(m[1]), '★入力欄が16px未満★');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
