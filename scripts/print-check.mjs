/* print-check.mjs — ★実際にPDFにして 枚数を数える★（Timeally）
 * =============================================================================
 * ★高さの計算だけで「収まった」と言わない★（司さん/指示役 2026-08-15）。
 * ★アプリ本体が作る紙そのもの★を刷る:
 *   ・jsdom で shukei.html を本当に動かし、「印刷」を押して
 *     ★開いた窓のHTMLをそのまま★取り出す（作り物のHTMLを刷らない）
 *   ・それを Chrome に ★--headless --print-to-pdf★ で刷らせる
 *   ・PDF の中の ★/Type /Page★ を数えて 枚数を出す
 *
 * 使い方: node scripts/print-check.mjs           … 28/30/31日＋締め日20 を刷って数える
 *         node scripts/print-check.mjs --keep    … 作ったPDFを消さずに残す
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

/** ★紙を刷れるブラウザを探す★（無ければ ★止まる★。SKIPを緑と呼ばない） */
function findChrome() {
  const c = [
    path.join(process.env['ProgramFiles'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(process.env['ProgramFiles'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  for (const p of c) if (p && fs.existsSync(p)) return p;
  throw new Error('紙を刷れるブラウザが見つかりません（Chrome / Edge）');
}

/** アプリ本体を動かして ★印刷の窓のHTML★ を取り出す */
function paperHtmlOf(seed, back, btn) {
  const file = 'shukei.html';
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const locals = [...html.matchAll(/<script src="((?!https?:)[^"]+)"/g)].map((m) => m[1].split('?')[0]);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const vc = new VirtualConsole();
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
    url: 'https://example.test/' + file, pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window;
  w.supabase = { createClient: () => createFake(seed) };
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
  /* ★画面は今月から始まる★ので、狙いの月まで「前の月」を押してから刷る（実際の手順どおり） */
  return new Promise((res) => setTimeout(() => {
    for (let i = 0; i < (back || 0); i++) w.document.getElementById('b-prev').click();
    setTimeout(() => {
      w.document.getElementById(btn || 'b-print').click();
      setTimeout(() => {
        if (!opened.length) throw new Error('★印刷の窓が開かなかった★');
        /* ★doctype を必ず付ける★
           documentElement.outerHTML は ★doctype を落とす★。落ちたまま Chrome に渡すと
           ★互換モード★で開き、表が body の font-size を継がず ★1行28px★になる
           （本物の窓には doctype が在るので 1行は もっと低い）。
           ＝★測る道具が 本物と違う物を測っていた★。2026-08-15 に踏んだ。 */
        res('<!doctype html>\n' + opened[0].document.documentElement.outerHTML);
      }, 150);
    }, 250);
  }, 250));
}

/** ★どこで高さを使っているかを 実際のブラウザで測る★（計算で当てない）
    Chrome に紙のHTMLを開かせ、A4横の中身の大きさ（10mm余白）で各部の高さを出す。 */
function measureHeights(htmlPath) {
  const probe = htmlPath.replace(/\.html$/, '.probe.html');
  const src = fs.readFileSync(htmlPath, 'utf8').replace('</body>',
    '<script>window.addEventListener("load",function(){'
    + 'var g=function(s){var e=document.querySelector(s);return e?Math.round(e.getBoundingClientRect().height):0;};'
    + 'var t=document.querySelector("table");'
    + 'var rows=t?t.querySelectorAll("tbody tr"):[];'
    + 'document.title=JSON.stringify({body:Math.round(document.body.scrollHeight),'
    + 'h1:g("h1"),sub:g(".sub"),daily:g("table"),sum:g(".paper-sum"),foot:g(".paper-foot"),'
    + 'row:rows.length?Math.round(rows[0].getBoundingClientRect().height):0,rows:rows.length'
    + ',cell:(function(){if(!rows.length)return null;var td=rows[0].querySelector("td");if(!td)return null;'
    + 'var cs=getComputedStyle(td);return{fs:cs.fontSize,lh:cs.lineHeight,pad:cs.paddingTop+"/"+cs.paddingBottom,'
    + 'bd:cs.borderTopWidth,h:Math.round(td.getBoundingClientRect().height),txt:td.textContent.slice(0,12)};})()'
    + '});});</scr' + 'ipt></body>');
  fs.writeFileSync(probe, src, 'utf8');
  const out = execFileSync(chrome, ['--headless', '--disable-gpu', '--window-size=1047,717',
    '--virtual-time-budget=3000', '--dump-dom', 'file:///' + probe.replace(/\\/g, '/')],
  { encoding: 'latin1', timeout: 60000 });
  fs.unlinkSync(probe);
  const m = /<title>([^<]*)<\/title>/.exec(out);
  try { return JSON.parse(Buffer.from(m[1], 'latin1').toString('utf8').replace(/&quot;/g, '"')); }
  catch (e) { return null; }
}

/** PDF の枚数を数える（Chrome が作るPDFは /Type /Page が1枚に1つ） */
function pageCount(buf) {
  const s = buf.toString('latin1');
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

const chrome = findChrome();
const keep = process.argv.includes('--keep');
const outDir = path.join(os.tmpdir(), 'timeally-print');
fs.mkdirSync(outDir, { recursive: true });
console.log('刷るブラウザ: ' + path.basename(chrome));

/* ★測る所★ … 月の日数の端（28/30/31）と 締め日20（月をまたぐ31日） */
const CASES = [
  { name: '2026-02（28日・末日締め）', back: 6, seed: { days: 28, ym: '2026-02', closeDay: 31 } },
  { name: '2026-04（30日・末日締め）', back: 4, seed: { days: 30, ym: '2026-04', closeDay: 31 } },
  { name: '2026-08（31日・末日締め）', back: 0, seed: { days: 31, ym: '2026-08', closeDay: 31 } },
  { name: '2026-08（締め日20・7/21〜8/20）', back: 0, seed: { days: 31, ym: '2026-07', closeDay: 20 } },
];

let ng = 0;
for (const c of CASES) {
  const paper = await paperHtmlOf(c.seed, c.back);
  const htmlPath = path.join(outDir, c.name.replace(/[^0-9A-Za-z]/g, '_') + '.html');
  const pdfPath = htmlPath.replace(/\.html$/, '.pdf');
  fs.writeFileSync(htmlPath, paper, 'utf8');
  execFileSync(chrome, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
    '--print-to-pdf=' + pdfPath, '--print-to-pdf-no-header', 'file:///' + htmlPath.replace(/\\/g, '/')],
  { stdio: 'ignore', timeout: 60000 });
  const n = pageCount(fs.readFileSync(pdfPath));
  const rows = (paper.match(/<tr/g) || []).length;
  const okOne = n === 1;
  if (!okOne) ng++;
  const h = measureHeights(htmlPath);
  console.log(`  ${okOne ? '✓' : '✗'} ${c.name} … ★${n}枚★（表の行 ${rows}）`);
  if (h) {
    console.log(`      実測の高さ: 中身ぜんぶ ${h.body}px ／ 見出し ${h.h1}+${h.sub} ／ 日ごとの表 ${h.daily}`
      + ` ／ 月計 ${h.sum} ／ 出した日 ${h.foot} ／ 1行 ${h.row}px × ${h.rows}行`
      + `　（A4横で使えるのは ★717px★）`);
    if (h.cell) console.log('      1マスの中身: ' + JSON.stringify(h.cell));
  }
  console.log(`      ${pdfPath}`);
  if (!keep) { /* PDFは残す（渡す物を見てもらうため）。HTMLだけ消す */ fs.unlinkSync(htmlPath); }
}

/* ★全員ぶんを1回で刷る★＝人数ぶんの枚数になり、★1人が2枚に割れない★かを実物で数える */
const big = await paperHtmlOf({ days: 31, ym: '2026-08', closeDay: 31, people: 2 }, 0, 'b-printall');
const bigHtml = path.join(outDir, 'overflow.html');
const bigPdf = path.join(outDir, 'overflow.pdf');
fs.writeFileSync(bigHtml, big, 'utf8');
execFileSync(chrome, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
  '--print-to-pdf=' + bigPdf, 'file:///' + bigHtml.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 60000 });
const bigN = pageCount(fs.readFileSync(bigPdf));
const theads = (big.match(/<thead/g) || []).length;
const headerGroup = /table-header-group/.test(big);
const breaks = (big.match(/break-before:page/g) || []).length;
console.log(`  ${bigN === 2 ? '✓' : '✗'} 全員（2人）ぶんを1回で刷る … ★${bigN}枚★（1人1枚・割れていない）`);
console.log(`  ${theads === 2 && breaks === 1 ? '✓' : '✗'} 人の頭で改ページ（見出し ${theads}個 / 改ページ ${breaks}回）`);
console.log(`  ${headerGroup ? '✓' : '✗'} 2枚に割れた時は見出しを繰り返す作り（table-header-group）`);
if (bigN !== 2 || theads !== 2 || breaks !== 1 || !headerGroup) ng++;
console.log(`      ${bigPdf}`);
fs.unlinkSync(bigHtml);

console.log(ng ? `\n★${ng}件 赤★` : '\n全部 1枚に収まりました');
process.exit(ng ? 1 : 0);
