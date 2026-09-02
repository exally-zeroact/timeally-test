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
import { needBrowser } from './_browser.mjs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const { createFake } = require_(path.join(ROOT, 'tests/fake-supa.js'));

/** ★紙を刷れるブラウザを探す★（無ければ ★止まる★。SKIPを緑と呼ばない） */

/** 直前に動かした画面（中の値を見るために持っておく） */
let lastWin = null;

/** ★列ごとの恒等式★（日ごとの合計 ＝ 合計行に描いた文字 ＝ 月計）
    ★「実労働の合計」しか突き合わせないと、他の列の穴は出ても気づけない★（指示役 2026-08-15）。
    ★中の値・描いた文字・月計 の3つを突き合わせる★ので、
    数える所の穴も 描く所の穴も どちらも捕まる。 */
function checkColumns(w) {
  /* ★12列★（2026-08-15 指示役の指摘で 8列→12列）
     ★遅刻・早退・有給・欠勤は 誰も突き合わせていなかった★＝8列で潰したやり方が
     残り4列に効いていなかった。★有給・欠勤は 時間ではなく件数★で突き合わせる。 */
  const HEAD = ['休憩', '中抜け', '実労働', '所定内', '所定超', '法定外残業', '深夜', '休日',
    '遅刻', '早退', '有給', '欠勤'];
  const KEY = ['breakMin', 'awayMin', 'workMin', 'stdMin', 'overStdMin', 'otMin', 'nightMin', 'holidayMin',
    'lateMin', 'earlyMin', null, null];
  const MKEY = [null, null, 'workedMin', 'stdMin', 'overStdMin', 'otMin', 'nightMin', 'holidayMin',
    'lateMin', 'earlyMin', 'yukyu', 'kekkin'];
  const COUNT = { 有給: 'paid_leave', 欠勤: 'absent' };
  const hhmm = (m) => Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  const st = w.OwnerApp._st;
  const foot = [...w.document.querySelectorAll('#daily tfoot td')].map((c) => c.textContent);
  /* ★描いた文字を1行ずつ足す★（2026-08-15）
     ★中の値と合計行だけを比べても、1マスの表示が違う穴は捕まらない★
     （わざと1行の表示だけ変えて 赤にならない事を実測して分かった）。
     ＝指示役が手でやった「紙の数字を足す」を そのまま機械にやらせる。 */
  const toMin = (t) => {
    const m = /^(\d+):(\d\d)$/.exec(String(t).trim());
    return m ? +m[1] * 60 + +m[2] : (String(t).trim() === '' ? 0 : NaN);
  };
  const drawn = HEAD.map(() => 0);
  const drawnBad = [];
  [...w.document.querySelectorAll('#daily tbody tr')].forEach((tr) => {
    const td = [...tr.querySelectorAll('td')].map((c) => c.textContent);
    HEAD.forEach((label, i) => {
      const cell = td[i + 4];                       // 先頭4列（日付/曜日/出勤/退勤）は数えない
      if (COUNT[label]) { drawn[i] += cell.trim() === '' ? 0 : 1; return; }
      const v = toMin(cell);
      if (isNaN(v)) { drawnBad.push(label + '「' + cell + '」が時刻の形でない'); return; }
      drawn[i] += v;
    });
  });
  const bad = drawnBad;
  HEAD.forEach((label, i) => {
    if (COUNT[label]) {
      /* ★件数で数える★（日ごとの印の数 ＝ 合計行 ＝ 月計） */
      const n = st.sum.days.filter((x) => x.dayKind === COUNT[label]).length;
      const shown = foot[i] === '' ? 0 : Number(foot[i]);
      if (n !== shown) bad.push(label + '（中の値 ' + n + '件 ≠ 合計行「' + foot[i] + '」）');
      if (st.sum.month[MKEY[i]] !== n) bad.push(label + '（中の値 ' + n + '件 ≠ 月計 ' + st.sum.month[MKEY[i]] + '）');
      if (drawn[i] !== n) bad.push(label + '（★描いた印 ' + drawn[i] + '件 ≠ 中の値 ' + n + '件★）');
      return;
    }
    const sum = st.sum.days.reduce((a, x) => a + (x[KEY[i]] || 0), 0);
    /* 0の列は空欄で出す決まりなので、空欄は0として比べる */
    const shown = foot[i] === '' ? '0:00' : foot[i];
    if (hhmm(sum) !== shown) bad.push(label + '（中の値 ' + hhmm(sum) + ' ≠ 合計行「' + foot[i] + '」）');
    if (MKEY[i] != null && st.sum.month[MKEY[i]] !== sum) {
      bad.push(label + '（中の値 ' + hhmm(sum) + ' ≠ 月計 ' + hhmm(st.sum.month[MKEY[i]]) + '）');
    }
    /* ★描いた文字を足した物とも比べる★（1マスの表示違いはここでしか捕まらない） */
    if (drawn[i] !== sum) {
      bad.push(label + '（★描いた文字の合計 ' + hhmm(drawn[i]) + ' ≠ 中の値 ' + hhmm(sum) + '★）');
    }
  });
  /* ★働いた日に「休み」が立っていないか★（見本が雑でも通る＝本物でも通る） */
  const conflict = st.sum.days.filter((x) => x.workMin > 0 && (x.dayKind === 'absent' || x.dayKind === 'paid_leave'));
  return { bad: bad, conflict: conflict.map((x) => x.d + ' ' + x.dayKind) };
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
  /* ★画面は今月から始まる★ので、狙いの月まで「前の月」を押してから刷る（実際の手順どおり）
     ★2026-09-02 直した★＝前は ★押す回数(back)を直に書いて★いたので、
     ★今日が変わった日に 全部1つズレて★ 紙の中身が空になり、6件が一斉に赤になった。
     ⇒★回数ではなく「狙いの月のラベルになるまで」押す★（今日に寄りかからない）。 */
  const wantYm = seed && seed.ym ? seed.ym.replace('-', '年') + '月' : null;
  const labOf = () => ((w.document.getElementById('ymlabel') || {}).textContent || '').trim();
  return new Promise((res) => setTimeout(() => {
    if (wantYm) {
      for (let i = 0; i < 60 && labOf() !== wantYm; i++) {
        const b = w.document.getElementById(labOf() > wantYm ? 'b-prev' : 'b-next');
        if (!b) break;
        b.click();
      }
    } else {
      for (let i = 0; i < (back || 0); i++) w.document.getElementById('b-prev').click();
    }
    setTimeout(() => {
      w.document.getElementById(btn || 'b-print').click();
      setTimeout(() => {
        if (!opened.length) throw new Error('★印刷の窓が開かなかった★');
        lastWin = w;
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
    /* ★1文字ずつ縦に割れていないか／横にはみ出していないか を実物で数える★
       （DOMに在る≠読める。割れた字は ★背が高くなる★ので 高さで見つかる） */
    + ',tall:(function(){var n=0,base=1e9;'
    + 'document.querySelectorAll("td,th").forEach(function(c){var h=c.getBoundingClientRect().height;if(h>0&&h<base)base=h;});'
    /* ★rowspan の見出しは 2行ぶんの高さで正しい★ので数えない（数えると空振りする） */
    + 'document.querySelectorAll("td,th").forEach(function(c){'
    + 'if(c.rowSpan>1)return;if(c.getBoundingClientRect().height>base*1.6)n++;});'
    + 'return {n:n,base:Math.round(base)};})()'
    + ',over:(function(){var t=document.querySelector("table");if(!t)return 0;'
    + 'return Math.max(0,Math.round(t.scrollWidth-t.clientWidth));})()'
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

/** ★PDFの四辺の余白を 出た物から測る★（2026-08-15 司さんの質問）
    ★計算やCSSの字ではなく、刷り上がったPDFの中の 文字の位置★を読む。
    Chrome のPDFは 中身が Flate で圧縮されているので ほどいてから
    テキストを置く命令（Tm / Td / TJ・Tj）の x,y を拾い、紙の端からの距離を出す。
    @returns {{top:number,right:number,bottom:number,left:number,w:number,h:number}} ミリ */
function pdfMargins(buf) {
  const s = buf.toString('latin1');
  const mb = /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(s);
  if (!mb) return null;
  const W = +mb[3], H = +mb[4];                     // pt
  /* ★Chrome の紙は こう始まる★（実物を開いて確かめた 2026-08-15）:
       .24 0 0 -.24 0 594.96 cm     ← 縮尺と 上下ひっくり返し（原点が紙の左上になる）
       q
       237.5 118.75 3153.6 2244.2 re   ← ★中身を入れてよい四角＝余白そのもの★
       W* n
     ⇒ ★この四角を読めば 四辺の余白が そのまま出る★。
     （最初は文字の位置(Tm/Td)を拾おうとしたが、Td は前の行からの相対なので
       ★余白が常に0に見えた★。★出た物を読む時も 読み方を間違えれば嘘が出る★） */
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) continue;
    let txt = null;
    try { txt = zlib.inflateSync(Buffer.from(s.slice(start, end), 'latin1')).toString('latin1'); }
    catch (e) { continue; }
    const cm = /^\s*([-\d.]+)\s+0\s+0\s+([-\d.]+)\s+[-\d.]+\s+[-\d.]+\s+cm/.exec(txt);
    const clip = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+re\s*\r?\n?\s*W\*?\s+n/.exec(txt);
    if (!cm || !clip) continue;
    const k = Math.abs(+cm[1]);                       // 縮尺
    const x = +clip[1] * k, y = +clip[2] * k, w = +clip[3] * k, h = +clip[4] * k;
    const pt2mm = (v) => Math.round(v / 72 * 25.4 * 10) / 10;
    return {
      left: pt2mm(x), top: pt2mm(y),
      right: pt2mm(W - (x + w)), bottom: pt2mm(H - (y + h)),
      w: pt2mm(W), h: pt2mm(H),
    };
  }
  return null;
}

/** PDF の枚数を数える（Chrome が作るPDFは /Type /Page が1枚に1つ） */
function pageCount(buf) {
  const s = buf.toString('latin1');
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

/* ★ブラウザの探し方は 1か所★（2026-09-02 指示役の裁定B）＝scripts/_browser.mjs
   ＝前は この4本に 同じ物を 4回 書いていて ★Windows の道しか 無かった★（ubuntu では 載らない）。 */
const chrome = needBrowser('紙をPDFにして測る');
const keep = process.argv.includes('--keep');
const outDir = path.join(os.tmpdir(), 'timeally-print');
fs.mkdirSync(outDir, { recursive: true });
console.log('刷るブラウザ: ' + path.basename(chrome));

/* ★測る所★ … 月の日数の端（28/30/31）と 締め日20（月をまたぐ31日） */
/* ★9:00〜18:00 が31日 続くのは 一番 幅を食わないデータ★。
   ★それで1枚に入っても 実物では溢れる★ ので、mix:true で色んな日を混ぜて測る:
     日をまたぐ夜勤／法定休日に出た日／中抜け／打刻が片方だけ（備考が長い）／
     合計が3桁時間（310:30 級）／長い氏名・長い会社名 */
const HEAVY = { mix: true, longName: true };
const CASES = [
  { name: '31日・末日締め（色んな日を混ぜた＝一番 重い）', back: 0, seed: Object.assign({ days: 31, ym: '2026-08', closeDay: 31 }, HEAVY) },
  { name: '28日・2月', back: 6, seed: Object.assign({ days: 28, ym: '2026-02', closeDay: 31 }, HEAVY) },
  /* ★うるう年の2月は 30か月 戻る★（2026-08 → 2024-02。
     ★back を間違えると 今月を測って「試したつもり」になる★ ので、下で中身を数えて赤にする） */
  { name: '29日・うるう年の2月（2024-02）', back: 30, seed: Object.assign({ days: 29, ym: '2024-02', closeDay: 31 }, HEAVY) },
  { name: '30日の月（4月）', back: 4, seed: Object.assign({ days: 30, ym: '2026-04', closeDay: 31 }, HEAVY) },
  { name: '締め日20（7/21〜8/20＝月をまたぐ）', back: 0, crossMonth: true, seed: Object.assign({ days: 31, ym: '2026-07', closeDay: 20 }, HEAVY) },
  { name: '確定した月（頭の【 】が変わる）', back: 1, seed: Object.assign({ days: 31, ym: '2026-07', closeDay: 31, closedYm: '2026-07' }, HEAVY) },
  { name: 'ふつうの日だけ（9:00〜18:00×31日）', back: 0, seed: { days: 31, ym: '2026-08', closeDay: 31 } },
];

let ng = 0;
for (const c of CASES) {
  const paper = await paperHtmlOf(c.seed, c.back);
  const col = checkColumns(lastWin);
  if (col.bad.length) { ng++; console.log('  ✗ ' + c.name + ' … ★列が合っていない: ' + col.bad.join(' / ') + '★'); }
  if (col.conflict.length) { ng++; console.log('  ✗ ' + c.name + ' … ★働いた日に休みが立っている: ' + col.conflict.join(' / ') + '★'); }
  const htmlPath = path.join(outDir, c.name.replace(/[^0-9A-Za-z]/g, '_') + '.html');
  const pdfPath = htmlPath.replace(/\.html$/, '.pdf');
  fs.writeFileSync(htmlPath, paper, 'utf8');
  execFileSync(chrome, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
    '--print-to-pdf=' + pdfPath, '--print-to-pdf-no-header', 'file:///' + htmlPath.replace(/\\/g, '/')],
  { stdio: 'ignore', timeout: 60000 });
  const n = pageCount(fs.readFileSync(pdfPath));
  const mg = pdfMargins(fs.readFileSync(pdfPath));
  const rows = (paper.match(/<tr/g) || []).length;
  const okOne = n === 1;
  if (!okOne) ng++;
  const h = measureHeights(htmlPath);
  console.log(`  ${okOne ? '✓' : '✗'} ${c.name} … ★${n}枚★（表の行 ${rows}）`);
  if (h) {
    console.log(`      実測の高さ: 中身ぜんぶ ${h.body}px ／ 見出し ${h.h1}+${h.sub} ／ 日ごとの表 ${h.daily}`
      + ` ／ 月計 ${h.sum} ／ 出した日 ${h.foot} ／ 1行 ${h.row}px × ${h.rows}行`
      + `　（A4横で使えるのは ★717px★）`);
    /* ★縦に割れた字と 横のはみ出しは 0でなければ赤★ */
    if (h.tall && h.tall.n > 0) { ng++; console.log('      ★縦に割れているマスが ' + h.tall.n + '個★'); }
    if (h.over > 0) { ng++; console.log('      ★横に ' + h.over + 'px はみ出している★'); }
    console.log('      縦に割れたマス ' + (h.tall ? h.tall.n : '?') + '個 ／ 横のはみ出し ' + h.over + 'px'
      + ' ／ ★列ごとの突き合わせ 12本 一致★');
  }
  /* ★入れたつもりの物が 本当に紙に出ているか数える★（入っていなければ「試した」と言えない） */
  const has = {
    日またぎ: /日をまたぐ勤務/.test(paper),
    打刻漏れ: /打刻が片方だけ/.test(paper),
    深夜: /<td class="num[^"]*">[1-9]\d?:\d\d<\/td>/.test(paper),
    '3桁時間': /\d{3}:\d\d/.test(paper),
    /* ★日付の列は 揃えを直して class="num" になった★（2026-08-15）。
       ★見た目の class で探すと 揃えを変えた時に空振りする★ので、行の先頭のマスで見る。 */
    月をまたぐ日付: /<tr[^>]*><td[^>]*>\d+\/\d+<\/td>/.test(paper),
    網: /class="rest"/.test(paper),
    合計行: /<tfoot>/.test(paper),
    '2段見出し': /colspan="3"/.test(paper),
    /* ★class を「ぴったり一致」で探さない★（2026-08-16 実際に空振りした）
       ＝列に仲間の印（g-…）を足した瞬間に この見張りが黙った。
       ★class は増える物★として、含まれているかで見る。 */
    休日: /休日/.test(paper) && /<td class="num[^"]*">[1-9]\d?:\d\d<\/td>/.test(paper),
    有給欠勤: /<td class="num[^"]*">1<\/td>/.test(paper),
    遅刻早退: /遅刻/.test(paper),
  };
  /* ★入っているはずの物が入っていなければ赤★（＝「試したつもり」を潰す） */
  const want = (c.seed.mix ? ['日またぎ', '打刻漏れ', '深夜', '3桁時間', '有給欠勤'] : [])
    .concat(['網', '合計行', '2段見出し'])
    .concat(c.crossMonth ? ['月をまたぐ日付'] : []);
  const missing = want.filter((k) => !has[k]);
  if (missing.length) ng++;
  console.log('      入っている物: ' + Object.keys(has).filter((k) => has[k]).join('・')
    + (missing.length ? '　／★入っているはずが 無い: ' + missing.join('・') + '★' : ''));
  /* ★またがない月に 月を出していないか★ も見る（出したら余計な2文字） */
  if (!c.crossMonth && has['月をまたぐ日付']) { ng++; console.log('      ★またがない月なのに 日付に月が出ている★'); }
  if (mg) {
    /* ★四辺とも同じ★（綴じる=20mm／綴じない=10mm）。★出た物で測る★
       ★差は0.3mm以内★（PDFの丸めぶんだけ許す） */
    /* ★0.1mm 単位の整数で比べる★（20.1-19.8 は小数だと 0.30000000000000071 になり、
       ★0.3以内のはずが 落ちる★＝2026-08-15 に踏んだ） */
    const t = (x) => Math.round(x * 10);
    const v = [mg.top, mg.right, mg.bottom, mg.left].map(t);
    const same = Math.max.apply(null, v) - Math.min.apply(null, v) <= 3;
    const okM = same && v.every((x) => Math.abs(x - 200) <= 3);
    if (!okM) ng++;
    console.log('      ' + (okM ? '' : '★') + '余白の実測: 上' + mg.top + ' 右' + mg.right
      + ' 下' + mg.bottom + ' 左' + mg.left + 'mm （紙 ' + mg.w + '×' + mg.h + 'mm・'
      + (same ? '★四辺とも同じ★' : '★四辺がそろっていない★') + '）' + (okM ? '' : '★'));
  }
  console.log(`      ${pdfPath}`);
  if (!keep) { /* PDFは残す（渡す物を見てもらうため）。HTMLだけ消す */ fs.unlinkSync(htmlPath); }
}

/* ★全員ぶんを1回で刷る★＝人数ぶんの枚数になり、★1人が2枚に割れない★かを実物で数える */
for (const n of [1, 2, 10]) {
  const big = await paperHtmlOf({ days: 31, ym: '2026-08', closeDay: 31, people: n, mix: true, longName: true },
    0, 'b-printall');
  const bigHtml = path.join(outDir, 'zen' + n + '.html');
  const bigPdf = path.join(outDir, 'zenin-' + n + 'nin.pdf');
  fs.writeFileSync(bigHtml, big, 'utf8');
  execFileSync(chrome, ['--headless', '--disable-gpu', '--no-pdf-header-footer',
    '--print-to-pdf=' + bigPdf, 'file:///' + bigHtml.replace(/\\/g, '/')], { stdio: 'ignore', timeout: 90000 });
  const bigN = pageCount(fs.readFileSync(bigPdf));
  const theads = (big.match(/<thead/g) || []).length;
  const breaks = (big.match(/break-before:page/g) || []).length;
  const good = bigN === n && theads === n && breaks === n - 1;
  if (!good) ng++;
  console.log(`  ${good ? '✓' : '✗'} 全員（${n}人）ぶんを1回で刷る … ★${bigN}枚★`
    + `（1人1枚＝割れていない／見出し ${theads}個／改ページ ${breaks}回）`);
  console.log(`      ${bigPdf}`);
  if (!keep) fs.unlinkSync(bigHtml);
}
/* （「綴じ代をとらない」の検査は 2026-08-15 に外した＝★設定そのものを無くした★ので
    ★誰も呼ばない検査を残さない★。★四辺が20mmでそろっているか★は 上の1枚ずつで見ている） */

/* ★「紙のとおりに見る」と「刷った紙」が 同じ物か★（2026-08-16 司さん④）
   ★出た物どうしで比べる★＝同じ月・同じ人で 両方を作り、
   ★表の中の字を1つ残らず並べて 突き合わせる★（作り方が同じ事を言うだけにしない）。
   ※見せる方は ★.sheet で包む★＋★画面用のCSS★だけが違う（刷る時は外れる）。 */
{
  const seed = { days: 31, ym: '2026-08', closeDay: 31, mix: true };
  const printed = await paperHtmlOf(seed, 0, 'b-print');
  const shown = await paperHtmlOf(seed, 0, 'b-preview');
  const cells = (html) => {
    const d = new JSDOM(html).window.document;
    return [...d.querySelectorAll('th,td')].map((e) => e.textContent.trim()).join('|');
  };
  const a = cells(printed), b = cells(shown);
  const same = a === b && a.length > 0;
  if (!same) ng++;
  const sheet = /class="sheet"/.test(shown) && !/class="sheet"/.test(printed);
  if (!sheet) ng++;
  console.log(`  ${same ? '✓' : '✗'} ★「紙のとおりに見る」と「刷った紙」の中身が 1字も違わない★`
    + `（マス ${a.split('|').length}個 を突き合わせ）`);
  console.log(`  ${sheet ? '✓' : '✗'} 見せる時だけ 紙の形（.sheet）で包む／刷る時は包まない`);
  /* ★見せる方は 印刷ダイアログを開かない★（開くと「見るだけ」にならない） */
  const noPrint = !/window\.print\(\)/.test(shown);
  if (!noPrint) ng++;
  console.log(`  ${noPrint ? '✓' : '✗'} 見せるだけの時は 印刷ダイアログを開かない`);
}

const headerGroup = /table-header-group/.test(fs.readFileSync(path.join(ROOT, 'js/tc-ui.js'), 'utf8'));
console.log(`  ${headerGroup ? '✓' : '✗'} 2枚に割れた時は見出しを繰り返す作り（table-header-group）`);
if (!headerGroup) ng++;

console.log(ng ? `\n★${ng}件 赤★` : '\n全部 1枚に収まりました');
process.exit(ng ? 1 : 0);
