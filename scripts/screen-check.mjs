/* screen-check.mjs — ★画面そのものを 本物のブラウザで測る★（Timeally）
 * =============================================================================
 * ★ソースを読んで数えない★。★描き終わった画面★を Chrome に渡して
 * getComputedStyle / getBoundingClientRect で ★見えている物だけ★を数える。
 *
 * 何を測るか（指示役 2026-08-16 の①〜⑥に対応）
 *   ② 会社の「丸め方」… ★既定のまま開いた時に見える設定の数★（before→after を数字で）
 *   ③ 従業員 …★1人あたりの高さ★／★1画面に入る人数★／★長いURLがそのまま出ている数★
 *   ⑤ 一覧 … ★見出しの言葉★／★空の時に文が出るか★
 *   ⑥ 戻る/行き来 … ★置き場所（px）が 全画面で同じか★／★タブの画面に戻るが無いか★
 *
 * ★測る道具が 本物と違う物を測っていないか★
 *   ・★doctype を必ず付ける★（付けないと Chrome が昔の解釈になり、行の高さが変わる。実際に踏んだ）
 *   ・★CSS は本物の css/timeally.css を file:// で読む★（写しを作らない）
 *   ・★JSは jsdom 側で走らせてから 描き終わった DOM を渡す★（Chrome では動かさない）
 *
 * 使い方: node scripts/screen-check.mjs
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
const CSS = path.join(ROOT, 'css/timeally.css').replace(/\\/g, '/');

function findChrome() {
  const c = [
    path.join(process.env['ProgramFiles'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
  ];
  for (const p of c) if (p && fs.existsSync(p)) return p;
  throw new Error('ブラウザが見つかりません');
}
const chrome = findChrome();
const outDir = path.join(os.tmpdir(), 'timeally-screen');
fs.mkdirSync(outDir, { recursive: true });

/** アプリを本当に動かして、★描き終わった画面★を返す
 *  after(w) … 描き終わってから押す物（タブを開く など）。押した後の姿を測る。 */
function render(file, seed, after) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const locals = [...html.matchAll(/<script src="((?!https?:)[^"]+)"/g)].map((m) => m[1].split('?')[0]);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
    url: 'https://timeally-test.vercel.app/' + file, pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  w.supabase = { createClient: () => createFake(seed) };
  w.open = () => { const s = new JSDOM('<!doctype html><html><body></body></html>').window; s.print = () => {}; s.focus = () => {}; return s; };
  w.URL.createObjectURL = () => 'blob:fake';
  w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
  const ctx = vm.createContext(w);
  for (const rel of locals) vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  for (const code of inline) vm.runInContext(code, ctx, { filename: file + '#inline' });
  return new Promise((res) => setTimeout(() => {
    if (after) after(w);
    setTimeout(() => {
      const doc = w.document;
      /* ★スクリプトは全部 外してから渡す★（Chrome では走らせない＝描き終わった姿を測る） */
      doc.querySelectorAll('script').forEach((s) => s.remove());
      doc.querySelectorAll('link[rel="stylesheet"]').forEach((l) => {
        if (/timeally\.css/.test(l.getAttribute('href') || '')) l.setAttribute('href', 'file:///' + CSS);
        else l.remove(); /* 外の字（Googleフォント）は測らない＝毎回同じ値にする */
      });
      res('<!doctype html>\n' + doc.documentElement.outerHTML);
    }, 250);
  }, 700));
}

/** Chrome に渡して ★見えている物★を数える。fnBody は return で物を返す
 *
 * ★窓の大きさで測ってはいけない★（2026-08-16 実測して分かった）
 *   Windows の Chrome は ★窓を 526px より狭くできない★。
 *   `--window-size=390,844` と書いても 中は ★526×744★ になっていた。
 *   ＝★測る道具が 本物と違う物を測っていた★（375も390も412も 全部おなじ526）。
 *   ⇒ ★枠(iframe)を きっかり その大きさで作り、その中に画面を入れて測る★。
 *     枠の中は ★390×844 ちょうど★になる（これも実測して確かめた）。
 *   答えは ★postMessage で外へ渡す★（--dump-dom は外側しか写さないため）。 */
const HEIGHT = 844;
function measure(name, html, width, fnBody) {
  const page = path.join(outDir, name + '-' + width + '.html');
  fs.writeFileSync(page, html.replace('</body>',
    '<script>window.addEventListener("load",function(){var r;'
    + 'try{r=JSON.stringify((function(){' + fnBody + '})());}catch(e){r=JSON.stringify({error:String(e)});}'
    + 'parent.postMessage(r,"*");});</scr' + 'ipt></body>'), 'utf8');
  const host = path.join(outDir, name + '-' + width + '.host.html');
  fs.writeFileSync(host,
    '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}iframe{border:0;display:block}</style>'
    + '</head><body><iframe width="' + width + '" height="' + HEIGHT + '" src="'
    + path.basename(page) + '"></iframe>'
    + '<script>window.addEventListener("message",function(e){document.title=e.data;});</scr' + 'ipt></body></html>', 'utf8');
  /* ★--hide-scrollbars を必ず付ける★
     ＝パソコンの Chrome は 縦の滑り棒に 15px 取る。付けないと
     ★390を頼んで 375を測る★（本物のスマホの棒は 幅0。実際に踏んだ）。 */
  const out = execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1200,1000',
    '--virtual-time-budget=4000', '--dump-dom', 'file:///' + host.replace(/\\/g, '/')],
  { encoding: 'latin1', maxBuffer: 40 * 1024 * 1024, timeout: 60000 });
  const m = /<title>([^<]*)<\/title>/.exec(out);
  if (!m || !m[1]) throw new Error(name + ' … 枠の中から答えが返りません（測れていません）');
  const j = JSON.parse(Buffer.from(m[1], 'latin1').toString('utf8').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  if (j.error) throw new Error(name + ' を測れません: ' + j.error);
  /* ★測った幅が 頼んだ幅と違ったら 止める★（違う物を測って緑と言わない） */
  if (j.w && j.w !== width) throw new Error(name + ' … 頼んだ幅 ' + width + ' で測れていません（実測 ' + j.w + '）');
  return j;
}

/* ★見えている物だけ数える共通の言い方★（Chrome の中で走る文字列にして使い回す） */
const VISIBLE = `
  function vis(e){
    if(!e) return false;
    if(e.closest("[hidden]")) return false;
    var r=e.getBoundingClientRect();
    if(r.width<=0||r.height<=0) return false;
    var cs=getComputedStyle(e);
    return cs.display!=="none"&&cs.visibility!=="hidden";
  }
`;

let ng = 0;
const say = (ok, line) => { if (!ok) ng++; console.log('  ' + (ok ? '✓' : '✗') + ' ' + line); };

console.log('\n★画面を 本物のブラウザで測ります★（描き終わった物だけ・ソースは読みません）\n');

/* ── ② 会社の「丸め方」 ─────────────────────────────────────── */
console.log('② 会社の設定（丸め方）');
const companyHtml = await render('index.html', {}, (w) => { w.document.getElementById('tab-company').click(); });
const custHtml = await render('index.html', {}, (w) => {
  w.document.getElementById('tab-company').click();
  const sel = w.document.getElementById('c-round');
  sel.value = 'custom';
  sel.onchange();
});
const ROUND_PROBE = VISIBLE + `
  var box = document.getElementById("pane-company");
  var h3 = [].slice.call(box.querySelectorAll("h3")).filter(function(h){return /丸め/.test(h.textContent);})[0];
  var after = [], seen = false;
  [].slice.call(box.children).forEach(function(el){
    if(el===h3){seen=true;return;}
    if(seen) after.push(el);
  });
  var controls = [], notes = [];
  after.forEach(function(el){
    [].slice.call(el.querySelectorAll("select,input")).concat(/select|input/i.test(el.tagName)?[el]:[])
      .forEach(function(c){ if(vis(c)) controls.push(c.id||c.tagName); });
    [].slice.call(el.querySelectorAll(".tc-note,.tc-alert")).concat(/tc-note|tc-alert/.test(el.className)?[el]:[])
      .forEach(function(n){ if(!vis(n)) return;
        /* ★行数は「字が乗っている高さ」で数える★＝箱の上下の余白を混ぜない
           （混ぜると 2行の文が 3行に見えて ★直したのに赤のまま★になる。実際に踏んだ） */
        var cs = getComputedStyle(n);
        var lh = parseFloat(cs.lineHeight) || 20;
        var inner = n.getBoundingClientRect().height
          - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
          - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
        notes.push({id:n.id, h:Math.round(n.getBoundingClientRect().height),
          lines: Math.round(inner/lh), chars:(n.innerText||n.textContent).trim().length}); });
  });
  var lh = 0;
  if(notes.length){ var el0=document.getElementById(notes[0].id); lh = parseFloat(getComputedStyle(el0).lineHeight)||20; }
  return { w: document.documentElement.clientWidth, controls: controls, notes: notes, lineH: Math.round(lh) };
`;
/* ★本当の「赤い長文」を測る★＝法律から外れた丸め（日ごと15分 切り捨て）を選んだ時。
   ここが ★指示役の言う「赤い長文」★。既定では出ないので ★作らないと素通りする★。 */
const warnHtml = await render('index.html', {}, (w) => {
  const d0 = w.document;
  d0.getElementById('tab-company').click();
  const sel = d0.getElementById('c-round');
  sel.value = 'custom'; sel.onchange();
  d0.getElementById('c-runit').value = '15';
  d0.getElementById('c-rdir').value = 'floor';
  d0.getElementById('c-rscope').value = 'day';
  d0.getElementById('c-rdir').onchange();
});
const r2a = measure('kaisha-kitei', companyHtml, 390, ROUND_PROBE);
const r2b = measure('kaisha-jibun', custHtml, 390, ROUND_PROBE);
const lines = (n) => n.lines;
console.log('    既定（1分単位のまま）で見える設定 … ★' + r2a.controls.length + '個★ ' + JSON.stringify(r2a.controls));
console.log('    「自分で決める」で見える設定   … ★' + r2b.controls.length + '個★ ' + JSON.stringify(r2b.controls));
r2a.notes.forEach((n) => console.log('    説明文 ' + n.id + ' … ' + n.chars + '字 / 箱' + n.h + 'px ＝ ★' + lines(n) + '行★'));
say(r2a.controls.length === 1, '既定のまま開いた時に見える設定は ★「決め方」の1つだけ★（実測 ' + r2a.controls.length + '個）');
say(r2b.controls.length === 4, '「自分で決める」を選ぶと 単位・向き・かける先が出る（実測 ' + r2b.controls.length + '個）');
say(r2a.notes.every((n) => lines(n) <= 2), '既定で出る説明文は ★2行まで★（実測 ' + r2a.notes.map(lines).join('/') + '行）');
const r2c = measure('kaisha-akai', warnHtml, 390, ROUND_PROBE);
const warnNote = r2c.notes.filter((n) => n.id === 'round-warn')[0];
console.log('    ★赤い箱★（法律から外れた丸めを選んだ時） … '
  + (warnNote ? warnNote.chars + '字 / ★' + warnNote.lines + '行★' : '（出ていない＝作れていません）'));
say(!!warnNote, '法律から外れた丸めを選ぶと ★赤い箱が出る★（出ないなら この検査は空振り）');
say(warnNote && warnNote.lines <= 3, '赤い箱の頭は ★3行まで★（続きは「くわしく」で開く・実測 '
  + (warnNote ? warnNote.lines : '-') + '行）');

/* ── ③ 従業員（20人） ───────────────────────────────────────── */
console.log('\n③ 従業員（20人 入れて測る）');
const peopleHtml = await render('index.html', { people: 20, pinMix: true }, (w) => { w.document.getElementById('tab-people').click(); });
const PEOPLE_PROBE = VISIBLE + `
  var box = document.getElementById("people");
  var rows = [].slice.call(box.children).filter(vis);
  var hs = rows.map(function(e){return Math.round(e.getBoundingClientRect().height);});
  var urls = [].slice.call(box.querySelectorAll("*")).filter(function(e){
    return vis(e) && e.children.length===0 && /punch\\.html\\?t=/.test(e.textContent);
  }).length;
  var btns = [].slice.call(box.querySelectorAll("button,a")).filter(vis).length;
  var top = box.getBoundingClientRect().top;
  var fit = rows.filter(function(e){return e.getBoundingClientRect().bottom <= innerHeight;}).length;
  var wide = [].slice.call(document.querySelectorAll("#pane-people *")).filter(function(e){
    return vis(e) && e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5;
  }).length;
  return { w: document.documentElement.clientWidth, rows: rows.length, h1: hs[0]||0, hs: hs.slice(0,3),
           urls: urls, btns: btns, fit: fit, top: Math.round(top), wide: wide,
           all: Math.round(box.getBoundingClientRect().height) };
`;
const r3 = measure('juugyouin-20', peopleHtml, 390, PEOPLE_PROBE);
console.log('    20人ぶんの高さ … ★' + r3.all + 'px★（1人 ★' + r3.h1 + 'px★）');
console.log('    1画面（390×844）に見えている人数 … ★' + r3.fit + '人★');
console.log('    長いURLがそのまま出ている数 … ★' + r3.urls + '個★ ／ 押す物 … ' + r3.btns + '個');
say(r3.wide === 0, '横にはみ出している物は 0個（実測 ' + r3.wide + '）');
say(r3.h1 <= 60, '1人あたりの高さは ★60px以下★（実測 ' + r3.h1 + 'px）');
say(r3.urls === 0, '長いURLをそのまま出さない（実測 ' + r3.urls + '個）');
say(r3.fit >= 8, '1画面に ★8人以上★ 見える（実測 ' + r3.fit + '人）');

/* ── ④ 集計の「日ごと」＝★カレンダー（締め期間）★ ───────────── */
console.log('\n④ 集計の「日ごと」（★狭い画面＝カレンダー／広い画面＝17列★）');

const CAL_PROBE = VISIBLE + `
  var W = document.documentElement.clientWidth;
  var cal = document.getElementById("cal");
  var cells = [].slice.call(cal.querySelectorAll(".cal-c")).filter(vis);
  var days = cells.filter(function(e){ return !/out/.test(e.className); });
  var last = days[days.length-1];
  var texts = days.map(function(e){ return (e.innerText||"").replace(/\s+/g," ").trim(); });
  /* ★月が出ているマスの数★（またぐ時だけ・期間の頭と月替わりの2つ） */
  var withMonth = texts.filter(function(t){ return t.indexOf("/")>=0; }).length;
  /* ★網の2段★ … 実際に描かれた背景を 灰色の明るさに直して数える */
  function lum(c){
    var nums=String(c||"").replace(/[^0-9.,]/g," ").split(/[ ,]+/).filter(function(x){return x!=="";}).map(Number);
    if(nums.length<3) return null;
    var g=nums.slice(0,3).map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
    return 0.2126*g[0]+0.7152*g[1]+0.0722*g[2];
  }
  var kinds = {};
  days.forEach(function(e){
    var k = /rest-h/.test(e.className) ? "法定休日" : /rest-w/.test(e.className) ? "土日" : "平日";
    kinds[k] = kinds[k] || { n:0, lum:null };
    kinds[k].n++;
    /* ★選ばれているマス（黄）は 網の明るさに混ぜない★
       ＝混ぜると ★平日の地が 0.76★になり「網の差」が小さく出る（実際に出た） */
    if (e.getAttribute("aria-selected") === "true") return;
    if (kinds[k].lum === null) kinds[k].lum = Math.round(lum(getComputedStyle(e).backgroundColor)*1000)/1000;
  });
  var tableWrap = document.getElementById("daily-wrap");
  var table = document.getElementById("daily");
  var tblCols = vis(tableWrap)
    ? ([].slice.call(table.querySelectorAll("tbody tr"))[0]||{children:[]}).children.length : 0;
  /* ★押した日の中身★（1日目を押して数える） */
  var box = document.getElementById("cal-day");
  var opened = null;
  if (days.length && !box.hidden) {
    opened = {
      見出し: (box.querySelector(".day-h")||{}).textContent || "",
      仲間: [].slice.call(box.querySelectorAll(".day-g")).map(function(e){return e.textContent;}),
      行: [].slice.call(box.querySelectorAll(".day-l")).map(function(e){
        return (e.querySelector(".k").textContent) + "=" + (e.querySelector(".v").textContent); }),
      空の仲間: 0,
      黄のマス: [].slice.call(cal.querySelectorAll(".cal-c[aria-selected='true']")).length
    };
    /* ★中身が空の仲間（見出しだけ）が出ていないか★ */
    [].slice.call(box.querySelectorAll(".day-g")).forEach(function(g){
      var nx = g.nextElementSibling;
      if (!nx || !/day-l/.test(nx.className)) opened.空の仲間++;
    });
    /* ★★列を省いていないか★★
       ＝★表のその日の行に出ている値★が ★1つ残らず 開いた中身にも在る★かを数える。
       仲間を1つ落とすだけで ここが赤になる（★「省くな」を見張りにする★）。 */
    var COLS = ["日付","曜日","出勤","退勤","休憩","中抜け","実労働","所定内","所定超",
      "法定外残業","深夜","休日","遅刻","早退","有給","欠勤","備考"];
    var sel = cal.querySelector(".cal-c[aria-selected='true']");
    var di = sel ? Number(sel.getAttribute("data-day")) : -1;
    var tr = document.querySelectorAll("#daily tbody tr")[di];
    opened.表に在るのに出ていない = [];
    if (tr) COLS.forEach(function(k, j){
      if (j < 2) return;
      var t = ((tr.children[j]||{}).textContent || "").trim();
      if (t === "") return;
      if (opened.行.indexOf(k + "=" + t) < 0) opened.表に在るのに出ていない.push(k + "=" + t);
    });
  }
  return { w: W, 対象: (document.getElementById("period")||{}).textContent || "",
    マスの数: days.length, 空きマス: cells.length - days.length,
    最後のマス: last ? (last.innerText||"").replace(/\s+/g," ").trim() : "",
    締めの印: last ? /shime/.test(last.className) : false,
    月が出ているマス: withMonth,
    網: kinds,
    はみ出し: Math.max(0, document.documentElement.scrollWidth - W),
    カレンダーの高さ: Math.round(cal.getBoundingClientRect().height),
    表の列: tblCols, カレンダーが見えている: vis(cal),
    押した中身: opened };
`;

/* ★実物で測る4通り★
   ・末日締め／締め日20（月をまたぐ）／★2月の締め日30（末日に寄る）★／
     ★法定休日を決めていない会社（濃い網が0件のはず）★
   ★押すのは jsdom 側★（Chrome へ渡す時にスクリプトを外すので、あちらでは押せない。
     ここを間違えて ★「押しても0行」＝道具のせいの赤★を出した。2026-08-17） */
const openDay = (i) => (w) => {
  const b = w.document.querySelectorAll('#cal [data-day]')[i];
  if (b) b.click();
};
/** ★月を戻してから 日を押す★
 *  月を戻すたびに ★倉庫から読み直して 描き直す★ので、待たずに押すと
 *  ★押した後に 描き直されて 中身が消える★（実際に3回 赤が出た）。
 *  ⇒ ★狙いの期間が画面に出るまで見張ってから押す★（時間で当てない）。 */
const backMonths = (n, want, i) => (w) => {
  for (let k = 0; k < n; k++) w.document.getElementById('b-prev').click();
  let tries = 0;
  const tick = () => {
    const d = w.document;
    const t = (d.getElementById('period') || {}).textContent || '';
    /* ★「押せた」ではなく「開いたまま残った」まで見る★
       ＝期間の字は 表より先に変わるので、先に押すと ★後の描き直しで閉じられる★（実測） */
    if (t.indexOf(want) >= 0 && d.querySelectorAll('#cal [data-day]').length) {
      if (!d.getElementById('cal-day').hidden) return;      /* 開いたまま＝終わり */
      openDay(i)(w);
    }
    if (tries++ < 60) setTimeout(tick, 50);
  };
  tick();
};
const CASES = [
  ['末日締め・31日の月', { days: 31, ym: '2026-08', closeDay: 31, mix: true }, openDay(2), 0, true],
  ['締め日20（7/21〜8/20）', { days: 31, ym: '2026-08', closeDay: 20, mix: true }, openDay(2), 2, true],
  ['2月・締め日30（末日に寄る）', { days: 28, ym: '2026-02', closeDay: 30, mix: true }, backMonths(6, '2026-02-28', 2), 2, true],
  ['法定休日を決めていない会社', { days: 31, ym: '2026-08', closeDay: 31 }, openDay(2), 0, false],
];
let caseNo = 0;
for (const [name, seed, after, wantMonth, wantHoliday] of CASES) {
  caseNo++;
  const html = await render('shukei.html', seed, after);
  for (const wpx of [375, 390, 412]) {
    const r = measure('cal' + caseNo, html, wpx, CAL_PROBE);
    if (wpx === 390) {
      /* ★何日ぶんのはずか は 画面の「対象」から出す★（数字を手で書かない＝別の物を測らない） */
      const m = /(\d{4}-\d{2}-\d{2}) 〜 (\d{4}-\d{2}-\d{2})/.exec(r.対象 || '');
      const want = m
        ? Math.round((Date.parse(m[2] + 'T00:00:00Z') - Date.parse(m[1] + 'T00:00:00Z')) / 86400000) + 1 : -1;
      console.log('    ' + name + ' … ' + (r.対象 || '（対象なし）'));
      console.log('      マス ★' + r.マスの数 + '個★（頭の空き ' + r.空きマス + '）／最後のマス「'
        + r.最後のマス.split(String.fromCharCode(10)).join(' ') + '」／月が出ているマス ' + r.月が出ているマス
        + '／高さ ★' + r.カレンダーの高さ + 'px★');
      console.log('      網: ' + Object.keys(r.網).map((k) => k + ' ' + r.網[k].n + '日(明るさ' + r.網[k].lum + ')').join(' / '));
      say(r.締めの印, name + ' … ★締め日が いちばん最後のマス★');
      say(r.マスの数 === want, name + ' … ★マスの数＝対象期間の日数★（実測 ' + r.マスの数 + '／' + want + '）');
      say(r.月が出ているマス === wantMonth,
        name + ' … ★またぐ時だけ 月が出る★（実測 ' + r.月が出ているマス + '／' + wantMonth + '）');
      const hol = r.網['法定休日'];
      if (wantHoliday) {
        /* ★比べるのは 土日 と 法定休日★（平日と比べると ★2段を1段に戻しても気づけない★。
           実際に「1段に戻して赤にならない」を踏んだ。2026-08-17） */
        const w2 = r.網['土日'], sa = (w2 && hol) ? Math.round((w2.lum - hol.lum) * 100) / 100 : 0;
        say(!!hol && !!w2 && sa >= 0.15,
          name + ' … ★白黒にしても 土日と法定休日が別の濃さ★（差 ' + sa + '）');
      } else {
        say(!hol, '★法定休日を決めていない会社では 濃い網が0件★（実測 ' + (hol ? hol.n : 0) + '件）');
      }
      const o = r.押した中身;
      say(o && o.行.length > 0, name + ' … ★日を押すと その日の中身が出る★（実測 ' + (o ? o.行.length : 0) + '行）');
      say(o && o.空の仲間 === 0, name + ' … ★中身が空の仲間（見出しだけ）が0★（実測 ' + (o ? o.空の仲間 : '−') + '）');
      say(o && o.黄のマス === 1, name + ' … ★黄で塗るのは 押した1マスだけ★（実測 ' + (o ? o.黄のマス : '−') + '）');
      say(o && o.表に在るのに出ていない.length === 0,
        name + ' … ★列を省いていない（表に在る値が全部 出ている）★'
        + (o && o.表に在るのに出ていない.length ? '：出ていない ' + o.表に在るのに出ていない.join('・') : ''));
      if (o) console.log('      押した日: ' + o.見出し + ' ／ 仲間 ' + JSON.stringify(o.仲間)
        + ' ／ ' + o.行.length + '行');
    }
    say(r.はみ出し === 0, name + '・幅' + wpx + ' … ★横に動く量 0px★（実測 ' + r.はみ出し + 'px）');
    say(r.カレンダーが見えている && r.表の列 === 0,
      name + '・幅' + wpx + ' … ★狭い画面は カレンダーだけ（17列の表は出さない）★');
  }
}
/* ★広い画面（900px以上）は 今までどおり17列 全部★ */
const wideHtml = await render('shukei.html', { days: 31, ym: '2026-08', closeDay: 31, mix: true }, null);
const rWide = measure('cal-hiroi', wideHtml, 1100, CAL_PROBE);
console.log('    幅1100 … 表の列 ★' + rWide.表の列 + '列★／カレンダー ' + (rWide.カレンダーが見えている ? '出ている' : '出さない＝正'));
say(rWide.表の列 === 17, '広い画面では ★17列 全部 出る★（実測 ' + rWide.表の列 + '列）');
say(!rWide.カレンダーが見えている, '広い画面では カレンダーを出さない');

/* ── ⑤ 一覧 ─────────────────────────────────────────────────── */
console.log('\n⑤ 一覧（何が分かる画面か）');
const listHtml = await render('index.html', {}, null);
const emptyHtml = await render("index.html", { noPunch: true, people: 2 }, null);
const LIST_PROBE = VISIBLE + `
  var pane = document.getElementById("pane-list");
  var head = [].slice.call(pane.querySelectorAll("h2")).filter(vis).map(function(h){return h.textContent.trim();});
  var lead = pane.querySelector(".tc-lead");
  var tabs = [].slice.call(document.querySelectorAll(".tc-tabs [role=tab]")).map(function(b){return b.textContent.trim();});
  var sum = document.getElementById("people-summary");
  return { heads: head, lead: lead && vis(lead) ? lead.textContent.trim() : "", tabs: tabs,
           sumText: sum ? sum.textContent.replace(/\\s+/g," ").trim().slice(0,60) : "" };
`;
const r5 = measure('ichiran', listHtml, 390, LIST_PROBE);
const r5e = measure('ichiran-kara', emptyHtml, 390, LIST_PROBE);
console.log('    タブの名前 … ' + JSON.stringify(r5.tabs));
console.log('    見出し … ' + JSON.stringify(r5.heads));
console.log('    頭の1行 … ' + (r5.lead || '（無し）'));
console.log('    打刻が無い時 … ' + (r5e.sumText || '（何も出ない）'));
say(!!r5.lead, '一覧の頭に ★何が分かるかの1行★ が出る');
say(/勤務|時間/.test(r5.tabs.join('')), 'タブの名前が ★何が分かるか★ になっている（' + r5.tabs.join('／') + '）');
say(/まだ|ありません/.test(r5e.sumText), '打刻が無い時に ★黙って空にしない★（実測「' + (r5e.sumText || '空') + '」）');

/* ── ⑥ 戻る・行き来 ─────────────────────────────────────────── */
console.log('\n⑥ 戻る・行き来の置き場所');
const NAV_PROBE = VISIBLE + `
  var out = [];
  [].slice.call(document.querySelectorAll("a,button")).forEach(function(e){
    if(!vis(e)) return;
    /* ★お願いの承認（戻す）は 行き来ではない★＝数に入れると
       「戻るの位置がバラバラ」という ★嘘の赤★になる（2026-08-16 実際に出た） */
    if(e.closest("#fixes")) return;
    var t = e.textContent.trim();
    if(!/戻|へ$|→|←/.test(t)) return;
    var r = e.getBoundingClientRect();
    out.push({ t: t, x: Math.round(r.left), y: Math.round(r.top), right: Math.round(r.right),
               bar: !!e.closest(".tc-appbar"), tabs: !!e.closest(".tc-tabs") });
  });
  /* ★横に はみ出していないか★ … 画面ごとに 出た物で数える（表は箱の中で滑るのが正） */
  var W = document.documentElement.clientWidth;
  var over = [].slice.call(document.querySelectorAll("body *")).filter(function(e){
    return vis(e) && !e.closest(".tc-tablewrap") && e.getBoundingClientRect().right > W + 0.5;
  }).map(function(e){ return (e.id||e.className||e.tagName) + "=" + Math.round(e.getBoundingClientRect().right); });
  return { nav: out, hasTabs: !!document.querySelector(".tc-tabs [role=tab]"),
           w: W, scrollW: Math.round(document.documentElement.scrollWidth), over: over.slice(0, 5) };
`;
const navPages = [
  ['index.html', 'ichiran', {}],
  ['shukei.html', 'shuukei', {}],
  ['punch.html', 'punch', {}],
  ['kiroku.html', 'kiroku', {}],
  ['login.html', 'login', { noUser: true }],
];
const navs = [];
for (const [file, name, seed] of navPages) {
  const h = await render(file, seed, null);
  const r = measure('nav-' + name, h, 390, NAV_PROBE);
  navs.push({ file, r });
  console.log('    ' + file.padEnd(12) + ' … ' + (r.nav.length ? r.nav.map((n) => '「' + n.t + '」右端=' + n.right + (n.bar ? '(帯)' : '') + (n.tabs ? '(タブ列)' : '')).join(' / ') : '（行き来する物なし）')
    + '　横' + r.scrollW + 'px' + (r.over.length ? ' ★はみ出し ' + r.over.join(',') + '★' : ''));
}
say(navs.every((p) => p.r.over.length === 0),
  'どの画面も ★表の箱の外に はみ出していない★（実測 ' + navs.filter((p) => p.r.over.length).map((p) => p.file).join('/') + (navs.some((p) => p.r.over.length) ? '' : '0枚') + '）');
const inBar = navs.flatMap((p) => p.r.nav.filter((n) => n.bar).map((n) => ({ f: p.file, ...n })));
const xs = [...new Set(inBar.map((n) => n.right - n.x > 0 ? n.right : n.x))];
const tabPagesWithBack = navs.filter((p) => p.r.hasTabs && p.r.nav.some((n) => /戻/.test(n.t) && n.bar));
say(tabPagesWithBack.length === 0, 'タブで行き来する画面に 戻るを出していない（実測 ' + tabPagesWithBack.length + '枚）');
const rights = [...new Set(inBar.map((n) => n.right))];
say(inBar.length === 0 || rights.length === 1,
  '帯の中の行き来ボタンは ★全画面で同じ右端★（実測 ' + (rights.join('/') || '無し') + 'px・' + inBar.length + '個）');

console.log('\n' + (ng ? '★' + ng + '件 直っていません★' : '★全部 決まりどおり★') + '\n');
process.exit(ng ? 1 : 0);
