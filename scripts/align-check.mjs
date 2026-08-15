/* align-check.mjs — ★揃えを「描き終わった物」から数える★（Timeally）
 * =============================================================================
 * ★ソースの grep ではない★（司さん/指示役 2026-08-15）。
 * ★本物のブラウザで getComputedStyle を読む★＝実際に どちらに寄っているかを数える。
 *
 * ★決まり（全アプリ共通）★
 *   ★数字（金額・時間・件数）＝右★（桁が縦に揃う）／★言葉＝左★／★日付＝右★
 *   ★1文字の列（曜日）＝中央★／★見出しは中身と同じ揃え★
 *   ★中央を使ってよいのは「1文字の列」だけ★
 *   ※★何列かにまたがる見出し(.grp)は この決まりの外★（どれか1列の中身ではない）
 *
 * 見る所: ★紙（A4横）★ と ★画面（375 / 390 / 412）★ の両方
 *
 * 使い方: node scripts/align-check.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const { createFake } = require_(path.join(ROOT, 'tests/fake-supa.js'));

/** ★列ごとに どちらへ寄せるか（合格の線）★ … 名前で決める。ここが唯一の正 */
const WANT = {
  日付: 'right', 曜日: 'center', 出勤: 'right', 退勤: 'right',
  休憩: 'right', 中抜け: 'right', 実労働: 'right',
  所定内: 'right', 所定超: 'right', 法定外残業: 'right',
  深夜: 'right', 休日: 'right', 遅刻: 'right', 早退: 'right',
  有給: 'right', 欠勤: 'right', 備考: 'left',
};

function findChrome() {
  const c = [
    path.join(process.env['ProgramFiles'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  for (const p of c) if (p && fs.existsSync(p)) return p;
  throw new Error('紙を刷れるブラウザが見つかりません');
}
const chrome = findChrome();
const outDir = path.join(os.tmpdir(), 'timeally-align');
fs.mkdirSync(outDir, { recursive: true });

/** アプリ本体を動かして ①画面の表 ②紙ぜんぶ を取り出す */
function build() {
  const file = 'shukei.html';
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const locals = [...html.matchAll(/<script src="((?!https?:)[^"]+)"/g)].map((m) => m[1].split('?')[0]);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
    url: 'https://example.test/' + file, pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  w.supabase = { createClient: () => createFake({ days: 31, ym: '2026-08', closeDay: 31, mix: true, longName: true }) };
  const opened = [];
  w.open = () => {
    const sub = new JSDOM('<!doctype html><html><body></body></html>').window;
    opened.push(sub); sub.print = () => {}; sub.focus = () => {};
    return sub;
  };
  w.URL.createObjectURL = () => 'blob:fake';
  const ctx = vm.createContext(w);
  for (const rel of locals) vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  for (const code of inline) vm.runInContext(code, ctx, { filename: file + '#inline' });
  return new Promise((res) => setTimeout(() => {
    w.document.getElementById('b-print').click();
    setTimeout(() => res({
      screenTable: w.document.getElementById('daily').outerHTML,
      totalTable: w.document.getElementById('total').outerHTML,
      paper: '<!doctype html>\n' + opened[0].document.documentElement.outerHTML,
    }), 200);
  }, 700));
}

/** ★描き終わった物から 列ごとの揃えを数える★ */
function measure(htmlPath, width) {
  const probe = htmlPath.replace(/\.html$/, '.probe.html');
  const src = fs.readFileSync(htmlPath, 'utf8').replace('</body>',
    '<script>window.addEventListener("load",function(){'
    + 'var t=document.querySelector("table");var out={cols:[],head:[],foot:[],grp:0,x:{}};'
    + 'var heads=[].slice.call(t.querySelectorAll("thead tr:last-child th"));'
    + 'var solo=[].slice.call(t.querySelectorAll("thead th[rowspan]"));'
    + 'var all=heads.concat(solo);'
    + 'all.forEach(function(th){out.head.push({k:th.textContent.trim(),a:getComputedStyle(th).textAlign});});'
    + 'out.grp=t.querySelectorAll("thead th.grp").length;'
    + 'var body=t.querySelector("tbody tr");'
    + 'if(body)[].slice.call(body.querySelectorAll("td")).forEach(function(td,i){'
    + 'out.cols.push({i:i,a:getComputedStyle(td).textAlign});});'
    + 'var f=t.querySelector("tfoot tr");'
    + 'if(f)[].slice.call(f.querySelectorAll("td")).forEach(function(td,i){'
    + 'out.foot.push({i:i,a:getComputedStyle(td).textAlign,r:Math.round(td.getBoundingClientRect().right)});});'
    + 'if(body)[].slice.call(body.querySelectorAll("td")).forEach(function(td,i){'
    + 'out.x[i]=Math.round(td.getBoundingClientRect().right);});'
    + 'document.title=JSON.stringify(out);});</scr' + 'ipt></body>');
  fs.writeFileSync(probe, src, 'utf8');
  const out = execFileSync(chrome, ['--headless', '--disable-gpu', '--window-size=' + width + ',900',
    '--virtual-time-budget=3000', '--dump-dom', 'file:///' + probe.replace(/\\/g, '/')],
  { encoding: 'latin1', maxBuffer: 40 * 1024 * 1024, timeout: 60000 });
  fs.unlinkSync(probe);
  const m = /<title>([^<]*)<\/title>/.exec(out);
  return JSON.parse(Buffer.from(m[1], 'latin1').toString('utf8').replace(/&quot;/g, '"'));
}

const NAMES = Object.keys(WANT);
let ng = 0;
const { screenTable, paper } = await build();

/* ── ①紙 ─────────────────────────────────────────────────────── */
const paperPath = path.join(outDir, 'paper.html');
fs.writeFileSync(paperPath, paper, 'utf8');
check('紙（A4横）', measure(paperPath, 1047));

/* ── ②画面（375 / 390 / 412） ───────────────────────────────── */
const cssPath = path.join(ROOT, 'css/timeally.css').replace(/\\/g, '/');
const screenPath = path.join(outDir, 'screen.html');
fs.writeFileSync(screenPath,
  '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
  + '<link rel="stylesheet" href="file:///' + cssPath + '">'
  + '</head><body><div class="tc-wrap"><div class="tc-tablewrap">'
  + screenTable + '</div></div></body></html>', 'utf8');
[375, 390, 412].forEach((w) => check('画面 ' + w + 'px', measure(screenPath, w)));

function check(where, r) {
  const bad = [];
  /* 中身（1行目）の揃え */
  r.cols.forEach((c, i) => {
    const want = WANT[NAMES[i]];
    if (c.a !== want) bad.push(NAMES[i] + ' の中身が ' + c.a + '（' + want + ' のはず）');
  });
  /* 見出しの揃え（★中身と同じか★） */
  r.head.forEach((h) => {
    const want = WANT[h.k];
    if (!want) return;
    if (h.a !== want) bad.push(h.k + ' の見出しが ' + h.a + '（中身と同じ ' + want + ' のはず）');
  });
  /* ★中央は「1文字の列」だけ★ */
  r.cols.forEach((c, i) => {
    if (c.a === 'center' && WANT[NAMES[i]] !== 'center') bad.push(NAMES[i] + ' に中央を使っている');
  });
  /* ★合計行の桁が 上の行と縦に揃っているか★（右端のpxで見る） */
  const off = [];
  r.foot.forEach((f, i) => {
    const bodyRight = r.x[i + 4];      // 合計行は先頭4列をまとめているので4つずらす
    if (bodyRight != null && Math.abs(bodyRight - f.r) > 1) {
      off.push(NAMES[i + 4] + '（上 ' + bodyRight + 'px / 合計 ' + f.r + 'px）');
    }
  });
  if (off.length) bad.push('合計行の桁が縦に揃っていない: ' + off.join(' '));
  if (bad.length) { ng++; bad.forEach((b) => console.log('  ✗ ' + where + ' … ' + b)); }
  else {
    console.log('  ✓ ' + where + ' … 列 ' + r.cols.length + '個・見出し ' + r.head.length + '個 すべて決まりどおり'
      + '／中央は曜日だけ／またがる見出し ' + r.grp + '個は数えない'
      + '／★合計行の桁が 上の行と縦に一致★');
  }
}

console.log(ng ? '\n★' + ng + '件 赤★' : '\n揃えは全部 決まりどおりです');
process.exit(ng ? 1 : 0);
