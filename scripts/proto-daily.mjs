/* proto-daily.mjs — ★「日ごと」をスマホでどう見せるか、案を実物で比べる★（Timeally）
 * =============================================================================
 * ★これは 調べる道具★です。アプリ本体は1文字も変えません（司さん 2026-08-17
 * 「省いて見えるようにしろ、って意味やない。ちゃんと調べてから作れ」）。
 *
 * ★同じ数字から 3通りに描いて 実物で測る★
 *   数字は ★本物のアプリを動かして★取り出す（lib/tc-calc.js が数えた物）。
 *   ＝案ごとに数字を作り直さない（作り直すと 比べても意味がない）。
 *
 * 案（司さん/指示役の見立て＋外の調べ）
 *   A ★1日1カード★     … 日付を見出しにして 中は「名前 値」を2列
 *   B ★1行＋押すと開く★ … 閉じている時は 日・曜日・実労働／開くと その日の全部
 *                         ＝★給与アプリの一覧と同じ形★（うちに在る物を持ってくる）
 *   C ★1日を2行★       … 1行目＝打刻／2行目＝内訳（表のまま 折り返す）
 *   D ★今までの表＋日付を貼り付け★（参考）… 17列そのまま・日付と曜日だけ動かない
 *
 * 測る物（指示役 2026-08-17 の指定どおり）
 *   ・幅375/390/412 で ★横に動く量★（0pxが合格）
 *   ・★1画面に入る日数★
 *   ・★実労働が 何タップで見えるか★
 *   ・★1文字ずつ縦に割れた字の数★
 *   ・★31日ぶんの高さ★
 *   ・★白黒でも読めるか★（字と地の明るさの差を数で出す）
 *
 * 使い方: node scripts/proto-daily.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { needBrowser } from './_browser.mjs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const { createFake } = require_(path.join(ROOT, 'tests/fake-supa.js'));
const CSS = path.join(ROOT, 'css/timeally.css').replace(/\\/g, '/');
const outDir = path.join(os.tmpdir(), 'timeally-proto');
fs.mkdirSync(outDir, { recursive: true });

/* ★ブラウザの探し方は 1か所★（2026-09-02 指示役の裁定B）＝scripts/_browser.mjs
   ＝前は この4本に 同じ物を 4回 書いていて ★Windows の道しか 無かった★（ubuntu では 載らない）。 */
const chrome = needBrowser('日ごとの見本を 描いて測る');

/** ★本物のアプリを動かして 数えた値をそのまま取り出す★（案ごとに数え直さない） */
function realDays() {
  const file = 'shukei.html';
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const locals = [...html.matchAll(/<script src="((?!https?:)[^"]+)"/g)].map((m) => m[1].split('?')[0]);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
    url: 'https://example.test/' + file, pretendToBeVisual: true, virtualConsole: new VirtualConsole(),
  });
  const w = dom.window;
  w.supabase = { createClient: () => createFake({ days: 31, ym: '2026-08', closeDay: 31, mix: true }) };
  w.open = () => { const s = new JSDOM('<!doctype html><html><body></body></html>').window; s.print = () => {}; s.focus = () => {}; return s; };
  w.URL.createObjectURL = () => 'blob:fake';
  const ctx = vm.createContext(w);
  for (const rel of locals) vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  for (const code of inline) vm.runInContext(code, ctx, { filename: file + '#inline' });
  return new Promise((res) => setTimeout(() => {
    /* ★画面が描いた表のマスを そのまま読む★（＝人が見るのと同じ字） */
    const rows = [...w.document.querySelectorAll('#daily tbody tr')].map((tr) => ({
      rest: /rest/.test(tr.className),
      v: [...tr.querySelectorAll('td')].map((td) => td.textContent),
    }));
    res(rows);
  }, 900));
}

const HEAD = ['日付', '曜日', '出勤', '退勤', '休憩', '中抜け', '実労働', '所定内', '所定超',
  '法定外残業', '深夜', '休日', '遅刻', '早退', '有給', '欠勤', '備考'];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const val = (r, k) => r.v[HEAD.indexOf(k)] || '';

/* ── 案A ★1日1カード★ ─────────────────────────────────────── */
function planA(rows) {
  return '<div class="pA">' + rows.map((r) => {
    const pairs = [['出勤', val(r, '出勤')], ['退勤', val(r, '退勤')], ['休憩', val(r, '休憩')],
      ['実労働', val(r, '実労働')], ['残業', val(r, '法定外残業')], ['深夜', val(r, '深夜')]]
      .filter((p) => p[1]);
    return '<div class="pA-card' + (r.rest ? ' rest' : '') + '">'
      + '<div class="pA-h"><b>' + esc(val(r, '日付')) + '</b><span class="dw">'
      + esc(val(r, '曜日')) + '</span>'
      + (val(r, '実労働') ? '<span class="pA-net">' + esc(val(r, '実労働')) + '</span>' : '')
      + '</div>'
      + (pairs.length
        ? '<div class="pA-g">' + pairs.map((p) =>
          '<div class="kv"><span class="k">' + p[0] + '</span><span class="v">' + esc(p[1]) + '</span></div>').join('') + '</div>'
        : '<div class="pA-none">打刻なし</div>')
      + '</div>';
  }).join('') + '</div>';
}

/* ── 案B ★1行＋押すと開く★（給与アプリと同じ形） ───────────── */
function planB(rows) {
  return '<div class="pB">' + rows.map((r, i) => {
    const all = HEAD.slice(2).map((k) => [k, val(r, k)]).filter((p) => p[1]);
    return '<div class="pB-row' + (r.rest ? ' rest' : '') + '">'
      + '<button class="pB-h" type="button" onclick="this.parentNode.classList.toggle(\'open\')">'
      + '<span class="d">' + esc(val(r, '日付')) + '</span>'
      + '<span class="dw">' + esc(val(r, '曜日')) + '</span>'
      + '<span class="t">' + esc(val(r, '出勤')) + (val(r, '退勤') ? '〜' + esc(val(r, '退勤')) : '') + '</span>'
      + '<span class="net">' + esc(val(r, '実労働')) + '</span>'
      + '<span class="cv">›</span></button>'
      + '<div class="pB-b">' + (all.length
        ? '<div class="det2">' + all.map((p) =>
          '<div class="dl"><span class="k">' + p[0] + '</span><span class="v">' + esc(p[1]) + '</span></div>').join('') + '</div>'
        : '<div class="pA-none">打刻なし</div>') + '</div>'
      + '</div>';
  }).join('') + '</div>';
}

/* ── 案C ★1日を2行★（表のまま 折り返す） ───────────────────── */
function planC(rows) {
  const head = '<thead><tr><th class="c">日</th><th>出勤</th><th>退勤</th><th>休憩</th><th>実労働</th></tr>'
    + '<tr class="sub"><th class="c"></th><th>所定内</th><th>残業</th><th>深夜</th><th>休日</th></tr></thead>';
  return '<table class="tc pC">' + head + '<tbody>' + rows.map((r) => {
    const cls = r.rest ? ' class="rest"' : '';
    return '<tr' + cls + ' class="r1' + (r.rest ? ' rest' : '') + '">'
      + '<td class="c" rowspan="2">' + esc(val(r, '日付')) + '<br><span class="dw">' + esc(val(r, '曜日')) + '</span></td>'
      + ['出勤', '退勤', '休憩', '実労働'].map((k) => '<td class="num">' + esc(val(r, k)) + '</td>').join('')
      + '</tr>'
      + '<tr class="r2' + (r.rest ? ' rest' : '') + '">'
      + ['所定内', '法定外残業', '深夜', '休日'].map((k) => '<td class="num sub">' + esc(val(r, k)) + '</td>').join('')
      + '</tr>';
  }).join('') + '</tbody></table>';
}

/* ── 案D ★今までの表＋日付を貼り付け★（参考・17列そのまま） ─── */
function planD(rows) {
  const head = '<thead><tr>' + HEAD.map((k, i) =>
    '<th class="' + (i < 2 ? 'stick s' + i + ' c' : 'num') + '">' + k + '</th>').join('') + '</tr></thead>';
  return '<div class="pD-wrap"><table class="tc pD">' + head + '<tbody>' + rows.map((r) =>
    '<tr' + (r.rest ? ' class="rest"' : '') + '>' + HEAD.map((k, i) =>
      '<td class="' + (i < 2 ? 'stick s' + i + ' c' : 'num') + '">' + esc(val(r, k)) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table></div>';
}

/* ── 案E ★カレンダー＋月計★（freee人事労務の勤怠画面と同じ形） ── */
function planE(rows) {
  /* 2026-08-01 は土曜。頭の空きマスを作る */
  const firstDow = new Date(Date.UTC(2026, 7, 1)).getUTCDay();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push('<div class="pE-c empty"></div>');
  rows.forEach((r) => {
    const j = val(r, '実労働');
    cells.push('<div class="pE-c' + (r.rest ? ' rest' : '') + (j ? ' on' : '') + '">'
      + '<span class="d">' + esc(val(r, '日付')) + '</span>'
      + (j ? '<span class="h">' + esc(j) + '</span>' : '<span class="h none">－</span>')
      + '</div>');
  });
  const dow = ['日', '月', '火', '水', '木', '金', '土'];
  /* 月計（画面の下に出す＝freee と同じ） */
  const sum = (k) => rows.reduce((a, r) => {
    const m = /^(\d+):(\d\d)$/.exec(val(r, k)); return a + (m ? +m[1] * 60 + +m[2] : 0);
  }, 0);
  const hm = (m) => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  const tot = [['総勤務', sum('実労働')], ['所定内', sum('所定内')], ['時間外', sum('法定外残業')],
    ['休日', sum('休日')], ['深夜', sum('深夜')]];
  return '<div class="pE">'
    + '<div class="pE-g head">' + dow.map((d, i) =>
      '<div class="pE-h' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + d + '</div>').join('') + '</div>'
    + '<div class="pE-g">' + cells.join('') + '</div>'
    + '<div class="pE-sum">' + tot.map((t) =>
      '<div class="pE-s"><span class="k">' + t[0] + '</span><span class="v">' + hm(t[1]) + '</span></div>').join('') + '</div>'
    /* ★押した日★の中身（freee は日を押すと その日の詳しい所へ行く） */
    + '<div class="pE-day"><div class="pE-dh">3日（月）を押した時</div><div class="det2">'
    + HEAD.slice(2).map((k) => [k, val(rows[2], k)]).filter((x) => x[1]).map((x) =>
      '<div class="dl"><span class="k">' + x[0] + '</span><span class="v">' + esc(x[1]) + '</span></div>').join('')
    + '</div></div></div>';
}

const PROTO_CSS = `
.pA-card{background:#FFFFFF;border:1px solid #F0E0B8;border-radius:12px;padding:8px 10px;margin:0 0 8px;}
.pA-card.rest{background:#FFFBF0;}
.pA-h{display:flex;align-items:baseline;gap:8px;font-size:14px;}
.pA-h .dw{color:#78705C;font-size:12px;}
.pA-net{margin-left:auto;font-family:'DM Mono',ui-monospace,monospace;font-weight:700;}
.pA-g{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px;margin-top:6px;}
.pA-none{color:#78705C;font-size:12px;margin-top:4px;}
.kv,.dl{display:flex;justify-content:space-between;gap:8px;font-size:12px;
  border-bottom:1px dotted #F0E0B8;padding:2px 0;}
.kv .k,.dl .k{color:#78705C;white-space:nowrap;}
.kv .v,.dl .v{font-family:'DM Mono',ui-monospace,monospace;white-space:nowrap;}

.pB-row{border-bottom:1px solid #F0E0B8;}
.pB-row.rest{background:#FFFBF0;}
.pB-h{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:6px 4px;
  background:none;border:0;font:inherit;color:#2B2418;text-align:left;cursor:pointer;}
.pB-h .d{width:22px;text-align:right;font-family:'DM Mono',ui-monospace,monospace;}
.pB-h .dw{width:16px;color:#78705C;font-size:12px;}
.pB-h .t{flex:1 1 auto;font-family:'DM Mono',ui-monospace,monospace;font-size:13px;color:#78705C;}
.pB-h .net{font-family:'DM Mono',ui-monospace,monospace;font-weight:700;}
.pB-h .cv{color:#78705C;}
.pB-b{display:none;padding:0 6px 10px;}
.pB-row.open .pB-b{display:block;}
.pB-row.open .cv{transform:rotate(90deg);display:inline-block;}
.det2{display:grid;grid-template-columns:1fr 1fr;gap:0 14px;}

table.pC td.sub,table.pC th.sub,table.pC tr.sub th{color:#78705C;font-size:12px;}
table.pC tr.r1 td{border-bottom:0;}
table.pC tr.r2 td{border-top:0;}
table.pC .dw{color:#78705C;font-size:11px;}


.pE-g{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}
.pE-h{text-align:center;font-size:11px;color:#78705C;padding:2px 0;}
.pE-h.sun{color:#B3261E;} .pE-h.sat{color:#8F6200;}
.pE-c{min-height:46px;border:1px solid #F0E0B8;border-radius:6px;background:#FFFFFF;
  padding:2px 3px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;}
.pE-c.empty{border:0;background:none;}
.pE-c.rest{background:#FFFBF0;}
.pE-c .d{font-size:11px;color:#78705C;}
.pE-c .h{font-family:'DM Mono',ui-monospace,monospace;font-size:12px;font-weight:700;}
.pE-c .h.none{color:#78705C;font-weight:400;}
.pE-sum{display:flex;gap:8px;margin:10px 0;flex-wrap:wrap;}
.pE-s{flex:1 1 60px;border:1px solid #F0E0B8;border-radius:8px;background:#FFFFFF;padding:4px 6px;text-align:center;}
.pE-s .k{display:block;font-size:10px;color:#78705C;}
.pE-s .v{font-family:'DM Mono',ui-monospace,monospace;font-size:13px;font-weight:700;}
.pE-day{border:1px solid #F0E0B8;border-radius:10px;background:#FFFFFF;padding:8px 10px;}
.pE-dh{font-size:12px;color:#78705C;margin-bottom:4px;}
.pD-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}
table.pD td.stick,table.pD th.stick{position:sticky;background:#FFFFFF;z-index:1;}
table.pD .s0{left:0;} table.pD .s1{left:34px;}
`;

function page(title, body) {
  return '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<link rel="stylesheet" href="file:///' + CSS + '">'
    + '<style>' + PROTO_CSS + '</style><title>' + esc(title) + '</title></head>'
    + '<body><div class="tc-wrap"><h2>' + esc(title) + '</h2>' + body + '</div></body></html>';
}

/** ★枠(iframe)で きっかりの幅にして測る★（窓では 526pxより狭くできないため） */
function measure(name, width, fnBody) {
  const host = path.join(outDir, name + '-' + width + '.host.html');
  fs.writeFileSync(host,
    '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}iframe{border:0;display:block}</style>'
    + '</head><body><iframe width="' + width + '" height="844" src="' + name + '.html"></iframe>'
    + '<script>window.addEventListener("message",function(e){document.title=e.data;});</scr' + 'ipt></body></html>', 'utf8');
  const out = execFileSync(chrome, ['--headless', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1200,1000', '--virtual-time-budget=4000', '--dump-dom',
    'file:///' + host.replace(/\\/g, '/')],
  { encoding: 'latin1', maxBuffer: 40 * 1024 * 1024, timeout: 60000 });
  const m = /<title>([^<]*)<\/title>/.exec(out);
  if (!m || !m[1]) throw new Error(name + ' … 枠の中から答えが返りません');
  const j = JSON.parse(Buffer.from(m[1], 'latin1').toString('utf8').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  if (j.error) throw new Error(name + ': ' + j.error);
  if (j.w !== width) throw new Error(name + ' … 頼んだ幅 ' + width + ' で測れていません（実測 ' + j.w + '）');
  return j;
}

const PROBE = `
  function vis(e){var r=e.getBoundingClientRect();var cs=getComputedStyle(e);
    return r.width>0&&r.height>0&&cs.display!=="none"&&cs.visibility!=="hidden";}
  var W=document.documentElement.clientWidth;
  /* ★1日ぶんの箱★（案ごとに名前が違うので まとめて探す） */
  var units=[].slice.call(document.querySelectorAll(".pA-card,.pB-row,table.pC tbody tr.r1,table.pD tbody tr,.pE-c:not(.empty)"));
  var first=units[0]?units[0].getBoundingClientRect():null;
  var mieru=units.filter(function(e){return e.getBoundingClientRect().bottom<=innerHeight;}).length;
  /* ★横に動く量★（表の箱の中も 画面ぜんぶも 両方見る） */
  var over=Math.max(0, document.documentElement.scrollWidth - W);
  [].slice.call(document.querySelectorAll(".pD-wrap,.tc-tablewrap")).forEach(function(b){
    over=Math.max(over, b.scrollWidth-b.clientWidth); });
  /* ★1文字ずつ縦に割れた字★ … 短い字なのに 2行より高くなっている物 */
  var waretа=0, wareList=[];
  [].slice.call(document.querySelectorAll("td,th,.k,.v,.d,.dw,.t,.net")).forEach(function(e){
    if(!vis(e)) return;
    var txt=(e.innerText||"").trim();
    if(!txt||txt.length>6) return;
    /* ★わざと2行にした物は「割れ」ではない★（日付の下に曜日／縦につないだマス）
       ＝これを数えると ★正しい案を「割れている」と言ってしまう★（実際に出た） */
    if(e.getAttribute("rowspan")||e.querySelector("br")||txt.indexOf(String.fromCharCode(10))>=0) return;
    var lh=parseFloat(getComputedStyle(e).lineHeight)||18;
    if(e.getBoundingClientRect().height > lh*2.2){ waretа++; if(wareList.length<3) wareList.push(txt); }
  });
  /* ★実労働が いま見えているか★（見えていれば0タップ） */
  var jitsu=[].slice.call(document.querySelectorAll("td,.v,.net")).filter(function(e){
    return vis(e) && /^\\d+:\\d\\d$/.test((e.innerText||"").trim()); }).length;
  /* ★白黒でも読めるか★ … 色を ★灰色の明るさ★に直して、字と地の差（コントラスト比）を数える。
     ★白黒コピーで消えるのは「色の違いだけで分けた物」★なので、灰色に直してから測る。 */
  function lum(c){
    /* ★正規表現で色を切り出さない★（書き方が1つ違うだけで 黙って NaN になり
       ★「99:1」＝測れていない数字★が出た。実際に踏んだ）。数字だけ拾う。 */
    if(!c) return null;
    var nums=c.replace(/[^0-9.,]/g," ").split(/[ ,]+/).filter(function(x){return x!=="";}).map(Number);
    if(nums.length<3) return null;
    if(nums.length>3&&nums[3]===0) return null;
    var g=nums.slice(0,3).map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
    return 0.2126*g[0]+0.7152*g[1]+0.0722*g[2];
  }
  function bgOf(e){
    while(e&&e!==document.documentElement){var b=lum(getComputedStyle(e).backgroundColor);if(b!==null)return b;e=e.parentElement;}
    return 1;
  }
  var worst=99, worstTxt="";
  [].slice.call(document.querySelectorAll("td,th,.k,.v,.d,.dw,.t,.net,b")).forEach(function(e){
    if(!vis(e)) return;
    var txt=(e.innerText||"").trim(); if(!txt) return;
    var f=lum(getComputedStyle(e).color); if(f===null) return;
    var b=bgOf(e);
    var r=(Math.max(f,b)+0.05)/(Math.min(f,b)+0.05);
    if(r<worst){worst=Math.round(r*10)/10;worstTxt=txt.slice(0,8);}
  });
  return { w:W, 高さ:Math.round(document.body.scrollHeight),
    白黒の最低差:worst, 白黒で一番薄い字:worstTxt,
    一日の高さ:first?Math.round(first.height):0, 見える日数:mieru,
    横に動く量:Math.round(over), 割れた字:waretа, 割れた例:wareList,
    見えている時刻の数:jitsu };
`;

const rows = await realDays();
console.log('\n★同じ数字（本物のアプリが数えた31日ぶん）から 4通りに描いて 実物で測ります★');
console.log('  取り出した日数: ' + rows.length + '日（打刻がある日 '
  + rows.filter((r) => val(r, '出勤')).length + '日）\n');

const PLANS = [
  ['A', '案A 1日1カード', planA(rows), 0],
  ['B', '案B 1行＋押すと開く（給与アプリと同じ形）', planB(rows), 0],
  ['C', '案C 1日を2行（表のまま折り返す）', planC(rows), 0],
  ['D', '案D 今までの17列＋日付を貼り付け（参考）', planD(rows), 0],
  ['E', '案E カレンダー＋月計（freee人事労務と同じ形）', planE(rows), 0],
];
const table = [];
for (const [id, title, body] of PLANS) {
  const file = path.join(outDir, 'proto' + id + '.html');
  fs.writeFileSync(file, page(title, body).replace('</body>',
    '<script>window.addEventListener("load",function(){var r;'
    + 'try{r=JSON.stringify((function(){' + PROBE + '})());}catch(e){r=JSON.stringify({error:String(e)});}'
    + 'parent.postMessage(r,"*");});</scr' + 'ipt></body>'), 'utf8');
  const row = { id, title };
  for (const w of [375, 390, 412]) {
    const r = measure('proto' + id, w, PROBE);
    row['w' + w] = r;
  }
  table.push(row);
  const r = row.w390;
  console.log('  ' + title);
  console.log('    幅375/390/412 の ★横に動く量★ … '
    + [row.w375, row.w390, row.w412].map((x) => x.横に動く量 + 'px').join(' / '));
  console.log('    ★1画面に入る日数★ … ' + [row.w375, row.w390, row.w412].map((x) => x.見える日数 + '日').join(' / '));
  console.log('    1日の高さ ' + r.一日の高さ + 'px ／ ★31日ぶんの高さ ' + r.高さ + 'px★');
  console.log('    ★1文字ずつ縦に割れた字★ … ' + r.割れた字 + '個'
    + (r.割れた字 ? '（例: ' + r.割れた例.join('・') + '）' : ''));
  console.log('    いま見えている時刻の数 … ' + r.見えている時刻の数 + '個');
  console.log('    ★白黒にした時の 字と地の差★ … 一番 薄い所で ' + r.白黒の最低差
    + ':1（「' + r.白黒で一番薄い字 + '」）　※4.5:1 以上が読める線');
  console.log('    ' + file);
}
fs.writeFileSync(path.join(outDir, 'kekka.json'), JSON.stringify(table, null, 1), 'utf8');
console.log('\n★出した物★ ' + outDir + ' の protoA〜D.html（スクショはこれを開いて撮ります）');
