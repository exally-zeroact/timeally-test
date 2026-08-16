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

/* ── ④ 集計の表（★横に滑らせない★） ─────────────────────────── */
console.log('\n④ 集計の「日ごと」（★横スクロールを出さない★）');
const shukeiHtml = await render('shukei.html', { days: 31, ym: '2026-08', closeDay: 31, mix: true }, null);
const TABLE_PROBE = VISIBLE + `
  var W = document.documentElement.clientWidth;
  var t = document.getElementById("daily");
  var wrap = t.closest(".tc-tablewrap");
  var cols = [].slice.call(t.querySelectorAll("tbody tr")).map(function(tr){
    return [].slice.call(tr.children).filter(vis).length; })[0] || 0;
  /* ★2段目には「1列だけの仲間」が居ない★（1段目に縦2行で置いてある）。
     ＝2段目の数だけ見ると ★正しい表を「ずれている」と言ってしまう★（実際に出た）。
     ⇒ ★上の段から降りてくる分（rowspan=2）を足してから数える★。 */
  var down = [].slice.call(t.querySelectorAll("thead tr:first-child th[rowspan]")).filter(vis).length;
  var heads = [].slice.call(t.querySelectorAll("thead tr")).map(function(tr, i){
    var n = [].slice.call(tr.children).filter(vis).reduce(function(a,th){
      return a + (Number(th.getAttribute("colspan"))||1); }, 0);
    return i === 0 ? n : n + down; });
  var names = [].slice.call(t.querySelectorAll("thead tr:last-child th")).filter(vis)
    .map(function(th){return th.textContent.trim();});
  var hint = document.querySelector(".tc-scrollhint");
  return { w: W, 列: cols, 見出しの段: heads, 出ている列: names,
    はみ出し: Math.max(0, Math.round(wrap.scrollWidth - wrap.clientWidth)),
    印: hint && vis(hint) ? hint.textContent.trim().slice(0, 30) : "" };
`;
for (const wpx of [390, 412]) {
  const r4 = measure('shuukei-hyou', shukeiHtml, wpx, TABLE_PROBE);
  console.log('    幅' + wpx + ' … 出ている列 ★' + r4.列 + '列★ ' + JSON.stringify(r4.出ている列)
    + ' ／ 横のはみ出し ★' + r4.はみ出し + 'px★');
  say(r4.はみ出し === 0, '幅' + wpx + 'で ★横に滑らせない★（実測 はみ出し ' + r4.はみ出し + 'px）');
  say(r4.見出しの段.every((n) => n === r4.列),
    '幅' + wpx + 'で ★2段の見出しと列の数が合っている★（実測 見出し ' + r4.見出しの段.join('/') + ' 列 ' + r4.列 + '）');
  say(!!r4.印, '幅' + wpx + 'で ★出していない列がある事を言っている★');
}
/* 広い画面では ★17列 全部★ 出る（隠しっぱなしにしない） */
const rWide = measure('shuukei-hyou-hiroi', shukeiHtml, 1100, TABLE_PROBE);
console.log('    幅1100 … 出ている列 ★' + rWide.列 + '列★ ／ 印: ' + (rWide.印 || '（出さない＝正）'));
say(rWide.列 === 17, '広い画面では ★17列 全部 出る★（実測 ' + rWide.列 + '列）');
say(!rWide.印, '広い画面では 「出していない列がある」と言わない');

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
