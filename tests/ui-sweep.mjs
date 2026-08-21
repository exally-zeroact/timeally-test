/* ui-sweep.mjs — ★実UIを押す。押す物の一覧を先に書いてから押す★（Timeally）
 * =============================================================================
 * ★決まり★
 *   ・「何個押した」は報告しない。★押す物の一覧を先に出してから押す★
 *   ・押して ★JSの例外が0★／★押せない物（配線されていないボタン）が0★
 *   ・倉庫は tests/fake-supa.js（★本物の倉庫は叩かない★）。
 *     ただし ★返す列は本物の設計図に在る列だけ★（偽の緑を作らない）
 *   ・★数える所は本物★（lib/tc-calc.js をそのまま読み込む）＝本番と同じ経路
 *
 * 使い方: node tests/ui-sweep.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require_('jsdom')); } catch (_) {
  console.log('\n✗ jsdom がありません。★SKIPを緑と呼ばない★ので赤で止めます（npm install してください）');
  process.exit(1);
}
const { createFake } = require_(path.join(ROOT, 'tests/fake-supa.js'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

/* ★押す物の一覧（先に書く）★ 画面ごとに、押す物と「押したら何が起きるはずか」 */
const PLAN = {
  'login.html': [
    ['b-in', '入る → 倉庫のログインを呼ぶ'],
    ['b-new', 'はじめて使う → 登録を呼ぶ'],
    ['b-reset', 'パスワードを忘れた → 送り直しを呼ぶ'],
  ],
  'index.html': [
    ['tab-company', '会社のタブ（★左から1番目★）'],
    ['tab-people', '従業員のタブ'],
    ['tab-list', '一覧のタブ'],
    ['go-shukei', '集計 →（★別のページへ飛ぶ★）'],
    ['b-prev', '前の月'],
    ['b-next', '次の月'],
    ['b-addperson', 'この人の入口を作る'],
    ['b-savecompany', '会社情報を保存する'],
    ['b-signout', 'ログアウト（★確認が出るだけ。まだ出ない★）'],
    ['b-signout-no', 'やめる（ログアウトを取り消す）'],
    ['b-signout-yes', 'ログアウト（本当に出る）'],
  ],
  /* ★押す順に意味がある★ … 締め日を過ぎた月へ行く → 確定する → 渡す → 解除する。
     ★解除した後は 渡す口が閉じる★ ところまで、この画面で1本に繋げて押す。 */
  'shukei.html': [
    ['b-prev', '前の月（★締め日を過ぎた月＝締め待ちになる★）'],
    ['b-close', 'この月を確定する（理由の欄が出る）'],
    ['b-do', '記録して実行 →★確定★', { creason: '8月分として給与へ渡すため' }],
    ['b-print', '印刷（★中身が0枚なら開かない★）'],
    ['b-csv', 'この人の日ごと（CSV）'],
    ['b-kyuyo', '給与へ渡す（全員・CSV）'],
    ['b-xlsx', 'Excel（全員）'],
    ['b-reopen', '確定を解除する（★理由が要る★）'],
    ['b-do', '記録して実行 →★解除★（ここから CSV は出せない）', { creason: '打刻漏れが見つかったため' }],
    ['b-close', 'もう一度 確定する（＝解除の後は 締め待ちに戻っている）'],
    ['b-cancel', 'やめる（記録を足さずに閉じる）'],
    ['b-next', '次の月'],
  ],
  /* ★休憩の2つは消した★（2026-08-15 司さんの指摘）＝現場は押さない。
     外出は残す（中抜けは毎日 同じ長さではない）。 */
  'punch.html': [
    ['b-in', '出勤'], ['b-out', '退勤'],
    ['b-ain', '私用で外出'], ['b-aout', '外出から戻る'],
    ['b-forget', 'この端末を忘れる'],
    ['b-setpin', '暗証番号を決める（★秘密は これ1つだけ★）', { pin1: '1234', pin2: '1234' }],
    ['b-verify', '暗証番号で入る', { pin: '1234' }],
  ],
  'kiroku.html': [
    ['b-prev', '前の月'], ['b-next', '次の月'], ['b-add', 'お願いを出す'],
  ],
};

/** HTMLを開いて、外のCDNは読まず、うちのファイルだけを順に実行する */
/** ★開いた画面は全部ここに溜める★
    本文を見る検査（★ / あいことば / 空の箱）が ★1枚も見落とさない★ ようにするため。
    2026-08-15 に踏んだ: 溜めずに results だけ見ていたら、入口を開いた画面を数えておらず
    ★バグを入れ直しても緑のまま★だった。 */
const opened_pages = [];

function openPage(file, search, seed) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const locals = [...html.matchAll(/<script src="((?!https?:)[^"]+)"/g)].map((m) => m[1].split('?')[0]);
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const stripped = html.replace(/<script[\s\S]*?<\/script>/g, '');

  /* ★jsdom は画面遷移を実装していない★ので、遷移しようとした事は
     「jsdomError」として受け取る（実際にどこへ行くかは 本物のブラウザで測る）。 */
  const navTried = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (/navigation/i.test(String(e && e.message))) navTried.push(String(e.message)); });
  const dom = new JSDOM(stripped, {
    url: 'https://example.test/' + file + (search || ''),
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const w = dom.window;
  const errors = [];
  w.addEventListener('error', (e) => errors.push(String(e.message || e)));
  w.onerror = (m) => { errors.push(String(m)); };
  /* 倉庫の代わり（★本物は叩かない★） */
  const fake = createFake(seed || {});
  w.supabase = { createClient: () => fake };
  /* 印刷は「新しい窓」を開くので、開けたかどうかだけ見えるようにする */
  const opened = [];
  w.open = () => {
    const sub = new JSDOM('<!doctype html><html><body></body></html>').window;
    opened.push(sub);
    sub.print = () => {};
    sub.focus = () => {};     // jsdom には無い。無いままだと「実装されていない」の雑音が出る
    return sub;
  };
  /* 落とす道はここで受ける（実際にファイルは作らない） */
  const delivered = [];
  w.URL.createObjectURL = () => 'blob:fake';
  w.URL.revokeObjectURL = () => {};
  const origClick = w.HTMLElement.prototype.click;
  w.HTMLElement.prototype.click = function () {
    if (this.tagName === 'A' && this.download) { delivered.push(this.download); return; }
    return origClick.apply(this, arguments);
  };

  const ctx = vm.createContext(w);
  for (const rel of locals) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) throw new Error(file + ' が読む ' + rel + ' が無い');
    vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: rel });
  }
  for (const code of inline) vm.runInContext(code, ctx, { filename: file + '#inline' });
  const page = { w, errors, opened, delivered, fake, locals, navTried, file };
  opened_pages.push(page);
  return page;
}

/* ★押す前に入れておく値★
   空のまま押すと「入れてください」で止まり、★押したのに何も起きない緑★になる。
   実際に人がやる手順（入れてから押す）に合わせる。 */
const PREFILL = {
  'login.html': { email: 'a@example.com', pw: 'password123' },
  /* ★設定は「時間」で入れる★（分ではない。8 / 40 / 1） */
  'index.html': { 'p-name': 'テスト 太郎', 'p-no': 'A02', 'p-yen': '1100', 'c-name': 'テスト商事',
    'c-daily': '8', 'c-week': '40', 'c-break': '1' },
  'kiroku.html': { at: '09:00', ar: '打ち忘れ' },
};

const wait = () => new Promise((r) => setTimeout(r, 30));

console.log('\n[実UIを押す] ★押す物の一覧を先に出す★');
for (const [file, list] of Object.entries(PLAN)) {
  console.log('  ' + file);
  list.forEach(([id, why]) => console.log('    - #' + id + '  … ' + why));
}
console.log('  （合わせて ' + Object.values(PLAN).reduce((a, b) => a + b.length, 0) + '個。これを1つ残らず押す）\n');

const results = [];
for (const [file, list] of Object.entries(PLAN)) {
  const search = /punch|kiroku/.test(file) ? '?t=11111111-1111-1111-1111-111111111111' : '';
  let page;
  try { page = openPage(file, search); } catch (e) {
    fail++; console.log('  ✗ ' + file + ' を開けない — ' + e.message); continue;
  }
  await wait(); await wait();
  /* 先に入れる（画面が描き終わってから＝後から描かれる欄にも入る）
     ★入れたら「入れた」と画面に伝える★（2026-08-18）
     ＝本物の人が打つと oninput/onchange が走る。値だけ置くと
     ★「揃うまで押せない」を入れた画面が ずっと押せないまま★になり、
     ★押した気になって0回のまま緑★になる（実際に踏んだ）。 */
  const fire = (el) => { if (!el) return; if (el.oninput) el.oninput(); if (el.onchange) el.onchange(); };
  for (const [id, v] of Object.entries(PREFILL[file] || {})) {
    const el = page.w.document.getElementById(id);
    if (el) { el.value = v; fire(el); }
  }
  const dateInput = page.w.document.querySelector('.tc-date-input');
  if (dateInput) {
    dateInput.value = '2026-08-04';
    /* 日付の欄は onchange を ★属性★で持っている（TcUi が組み立てる）→ 同じ物を直に呼ぶ */
    if (page.w.TcUi && page.w.TcUi.onDateChange) page.w.TcUi.onDateChange(dateInput);
    if (page.w.EmpApp && page.w.EmpApp.onAddChange) page.w.EmpApp.onAddChange();
    fire(dateInput);
  }
  const missing = [], threw = [], sawDisabled = [];
  for (const [id, , fill] of list) {
    const el = page.w.document.getElementById(id);
    if (!el) { missing.push(id); continue; }
    if (typeof el.onclick !== 'function' && el.tagName !== 'A') { missing.push(id + '(配線なし)'); continue; }
    /* ★押す直前に入れる★（押した拍子に欄が空にされる物があるので、先入れでは間に合わない） */
    for (const [k, v] of Object.entries(fill || {})) {
      const f = page.w.document.getElementById(k);
      if (f) f.value = v;
    }
    /* ★押せない物は「押せない」と記録して次へ★（無理に click しても何も起きず 緑に見える） */
    if (el.disabled) { sawDisabled.push(id); continue; }
    try { el.click(); } catch (e) { threw.push(id + ': ' + e.message); }
    await wait();
  }
  await wait(); await wait();
  results.push({ file, page, missing, threw, sawDisabled });
}

for (const r of results) {
  T(r.file + ' … 押す物が全部あって、配線されている', () => {
    ok(r.missing.length === 0, '見つからない/配線されていない: ' + r.missing.join(', '));
  });
  T(r.file + ' … 押してもJSの例外が出ない', () => {
    ok(r.threw.length === 0, '例外: ' + r.threw.join(' / '));
    ok(r.page.errors.length === 0, '画面のエラー: ' + r.page.errors.join(' / '));
  });
}

/* 押した結果、★本当に何かが起きたか★（空振りしていないか）を数える */
T('★集計の画面が 実際に数えて表を描いた（空振りしていない）', () => {
  const r = results.filter((x) => x.file === 'shukei.html')[0];
  const rows = r.page.w.document.querySelectorAll('#daily tr');
  ok(rows.length > 1, '日ごとの表が描かれていない（' + rows.length + '行）');
  const total = r.page.w.document.getElementById('total').textContent;
  ok(/出勤日数/.test(total), '月計が描かれていない');
  console.log('     実測: 日ごと ' + rows.length + '行 / 月計あり');
});

/* ★その日の結論を1行★（2026-08-18 指示役③）… ★社長の画面だけ 長さも足す★ */
T('★★日を押すと その日の結論が1行 出る（08:00〜17:03（実労働 8:03）の形）★★', () => {
  const r = results.filter((x) => x.file === 'shukei.html')[0];
  const d2 = r.page.w.document;
  const cell = [...d2.querySelectorAll('#cal [data-day]')].filter((b) => /\d+:\d\d/.test(b.textContent))[0];
  ok(cell, 'カレンダーに 数字の入った日が1つも無い');
  cell.click();
  const line = d2.getElementById('cal-day').textContent;
  ok(/は \d\d:\d\d〜\d\d:\d\d（実労働 \d+:\d\d）として数えます/.test(line),
    '★結論の1行が出ていない（または 空きが入っている）★: ' + line.slice(0, 80));
  console.log('     実測: ' + (/[^\n]*として数えます/.exec(line) || [''])[0].trim());
});

/* ── ★「出勤を打ち間違えた」は その日の行まで連れて行く★（2026-08-21 指示役が実配信で見つけた） ──
   ＝前は 記録の いちばん上（月の頭）に着くだけ。今日の行は ずっと下に在って、
     ★ボタンの言葉が約束している所★に着いていなかった。 */
{
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const p = openPage('punch.html', '?t=11111111-1111-1111-1111-111111111111',
    { punches: [[today + 'T09:00', 'in']] });
  await wait(); await wait(); await wait();
  T('★★「出勤を打ち間違えた」の行き先に その日が付いている★★', () => {
    const a = p.w.document.getElementById('to-fix');
    ok(a && !a.hidden, '★出勤中なのに 逃げ道が出ていない★');
    ok(/kiroku\.html\?t=/.test(a.href), '行き先が違う: ' + a.href);
    ok(a.href.indexOf('d=' + today) > 0, '★その日が付いていない★: ' + a.href);
    console.log('     実測: ' + a.getAttribute('href'));
  });

  const k = openPage('kiroku.html', '?t=11111111-1111-1111-1111-111111111111&d=' + today,
    { punches: [[today + 'T09:00', 'in']] });
  await wait(); await wait(); await wait(); await wait();
  T('★★その行き先を開くと その日の打刻が すでに開いている★★', () => {
    const d2 = k.w.document;
    const open = [...d2.querySelectorAll('[data-pid][aria-expanded="true"]')];
    ok(open.length === 1, '★開いている行が ' + open.length + '個（1個のはず）★');
    const card = open[0].closest('.tc-card');
    ok(/#/.test('#') && card.textContent.indexOf(today.slice(5).replace('-', '/')) >= 0,
      '★別の日を開いている★: ' + card.textContent.slice(0, 40));
    const btns = [...card.querySelectorAll('button')].map((b) => b.textContent.trim());
    ok(btns.some((x) => /時刻を直す/.test(x)) && btns.some((x) => /消す/.test(x)),
      '★開いたのに 直す・消すが出ていない★: ' + JSON.stringify(btns));
    console.log('     実測: ' + today + ' の行が開いている（' + JSON.stringify(btns.slice(0, 3)) + '）');
  });

  const k2 = openPage('kiroku.html', '?t=11111111-1111-1111-1111-111111111111',
    { punches: [[today + 'T09:00', 'in']] });
  await wait(); await wait(); await wait(); await wait();
  T('★★ふつうに開いた時は 何も開かない（勝手に開かない）★★', () => {
    const open = [...k2.w.document.querySelectorAll('[data-pid][aria-expanded="true"]')];
    ok(open.length === 0, '★勝手に ' + open.length + '個 開いている★');
    console.log('     実測: 開いている行 0個');
  });
}

/* ── ★中の言葉（pin_set）を 客に見せない★（2026-08-21 指示役が実配信で見つけた） ──────
   実物に出ていた … 「2026-08-21 12:15　pin_set　田中 花子」＝★中の印がそのまま★
   ★2重で止める★ … ①倉庫へ「締めの3つだけ」と頼む ②言葉を持っていない記録は 描かない */
{
  const p = openPage('shukei.html', '', { mix: true, ym: '2026-08', pinInLog: true });
  await wait(); await wait(); await wait();
  T('★★締めの記録に 中の言葉（pin_set）が1つも出ない★★', () => {
    const t = p.w.document.getElementById('chist').textContent;
    ok(t.indexOf('pin_set') < 0, '★中の印が そのまま出ている★: ' + t.slice(0, 120));
    ok(t.indexOf('pin_reissue') < 0, '★中の印が そのまま出ている★: ' + t.slice(0, 120));
    ok(p.fake._calls.indexOf('tc_close.in') >= 0, '★倉庫に「締めの3つだけ」と頼んでいない★');
    console.log('     実測: 倉庫へ in(close/reopen/export) を送った／画面に pin_set 0件');
  });
}

/* ── ★広い画面でも 有給を付けられるか★（2026-08-21 指示役が実配信で見つけた） ─────
   広い画面は17列の表になり、★カレンダーごと消えて 有給を付ける所が どこにも無かった★。 */
{
  const p = openPage('shukei.html', '', { mix: true, ym: '2026-08' });
  await wait(); await wait(); await wait();
  const d2 = p.w.document;
  T('★★広い画面の表も 行を押したら その日の箱が開く（有給を付けられる）★★', () => {
    const rows = [...d2.querySelectorAll('#daily tbody tr[data-day]')];
    ok(rows.length > 0, '★表の行に 日の番号が付いていない★');
    const box = d2.getElementById('cal-day');
    ok(box.hidden, '押す前から開いている');
    rows[2].click();
    ok(!box.hidden && box.className.indexOf('open') >= 0,
      '★行を押しても 箱が開かない（className=' + box.className + '）★');
    const yk = box.querySelector('[data-yk]');
    ok(yk, '★開いたのに 有給を付ける物が無い★');
    console.log('     実測: 表の行 ' + rows.length + '本／押すと「' + yk.textContent.trim() + '」が出る');
  });
}

/* ── ★入社日は 入れてよい範囲の外を 通さない★（2026-08-21 指示役が 40120-02-01 を入れられた） ── */
{
  const p = openPage('index.html', '', { people: 4, hireMix: true, mix: true });
  await wait(); await wait(); await wait();
  const d3 = p.w.document;
  d3.getElementById('tab-people').click();
  await wait();
  T('★★ありえない入社日は 決めさせない（理由を出す・倉庫へ行かせない）★★', () => {
    const inp = d3.getElementById('hire-field').querySelector('.tc-date-input');
    const btn = d3.getElementById('b-hire-save');
    ok(inp.min && inp.max, '★欄に 範囲が付いていない★（min=' + inp.min + ' max=' + inp.max + '）');
    const before = (p.fake._saved || []).filter((x) => x.table === 'tc_pub').length;
    inp.value = '40120-02-01';
    p.w.OwnerApp._hirePreview();
    ok(btn.disabled, '★ありえない日でも ［決める］が押せる★');
    const why = d3.getElementById('hire-result').textContent;
    ok(why && !/有給の残り/.test(why), '★理由を出していない★: ' + why);
    btn.click();
    const after = (p.fake._saved || []).filter((x) => x.table === 'tc_pub').length;
    ok(after === before, '★倉庫へ行ってしまった★（' + before + '→' + after + '）');
    console.log('     実測: 範囲 ' + inp.min + ' 〜 ' + inp.max + '／「' + why.trim() + '」／倉庫へ 0件');
  });

  T('★★入れた日は そのまま見える（DOMに在る≠読める）★★', () => {
    const inp = d3.getElementById('hire-field').querySelector('.tc-date-input');
    inp.value = '2019-04-01';
    p.w.OwnerApp._hirePreview();
    const show = inp.parentNode.querySelector('.tc-date-show');
    ok(show.textContent.indexOf('2019-04-01') >= 0 || show.textContent.indexOf('4/1') >= 0,
      '★入れた日が 欄に出ていない★: 「' + show.textContent + '」');
    ok(!d3.getElementById('b-hire-save').disabled, '★入れられる日なのに 押せない★');
    console.log('     実測: 欄に「' + show.textContent.trim() + '」');
  });
}

/* ── ★入社日を1人ずつ聞く★（2026-08-19 指示役④-①）＝★実UIで答えて 倉庫を読む★ ────
   実データは ★18人中14人が空★。空のままだと 8割の人の有給が数えられない。 */
{
  const p = openPage('index.html', '', { people: 4, hireMix: true, mix: true });
  await wait(); await wait(); await wait();
  const d2 = p.w.document;
  console.log('  [入社日] 押す物: 従業員タブ → 日付 → ［決める］／［あとで］');

  T('★★入社日が空の人にだけ 1人ずつ聞く（別の画面を作らない・1問だけ）★★', () => {
    d2.getElementById('tab-people').click();
    const box = d2.getElementById('hire-ask');
    ok(box && !box.hidden, '★聞く箱が出ていない★');
    ok(box.querySelectorAll('.tc-card').length === 1, '★一度に ' + box.querySelectorAll('.tc-card').length + '人 聞いている（1人のはず）★');
    ok(/さんの入社日は？/.test(box.textContent), '★聞き方が違う★: ' + box.textContent.slice(0, 60));
    const num = /入社日が入っていない人 (\d+)人／(\d+)人/.exec(box.textContent);
    ok(num, '★何人 空いているかを出していない★');
    console.log('     実測: 「' + (/[^]*?さんの入社日は？/.exec(box.textContent) || [''])[0].trim()
      + '」／' + num[0] + '／一度に聞くのは 1人');
  });

  T('★★答えたら その場で結果を返す（保存する前に「この日なら…」）★★', () => {
    const inp = d2.getElementById('hire-field').querySelector('.tc-date-input');
    ok(inp, '日付の欄が無い');
    inp.value = '2019-04-01';
    p.w.TcUi.onDateChange(inp);
    p.w.OwnerApp._hirePreview();
    const res = d2.getElementById('hire-result');
    ok(!res.hidden && /有給の残り \d+日/.test(res.textContent), '★その場で返していない★: ' + res.textContent);
    console.log('     実測: 「' + res.textContent.trim() + '」');
  });

  T('★★［決める］を押したら 倉庫に入社日が1件 書かれた（1問ごと保存）★★', () => {
    const before = (p.fake._saved || []).filter((x) => x.table === 'tc_pub').length;
    d2.getElementById('b-hire-save').click();
    const rows = (p.fake._saved || []).filter((x) => x.table === 'tc_pub');
    ok(rows.length === before + 1, '★押したのに 倉庫へ行っていない★（' + before + '→' + rows.length + '）');
    const row = rows[rows.length - 1].row;
    ok(row.hire_date === '2019-04-01', '★入れた日が違う★: ' + JSON.stringify(row));
    ok(Object.keys(row).length === 1, '★入社日のほかも書き換えている★: ' + Object.keys(row).join(','));
    console.log('     実測: hire_date=' + row.hire_date + ' の1項目だけ書いた');
  });

  T('★★［あとで］で 次の人に進む（空のままでも止めない）★★', () => {
    const box = d2.getElementById('hire-ask');
    const who = (/[^]*?さん/.exec(box.textContent) || [''])[0];
    d2.getElementById('b-hire-later').click();
    const box2 = d2.getElementById('hire-ask');
    const who2 = (/[^]*?さん/.exec(box2.textContent) || [''])[0];
    ok(box2.hidden || who2 !== who, '★「あとで」を押しても 同じ人を聞き続けている★: ' + who2);
    console.log('     実測: ' + who.trim() + ' → ' + (box2.hidden ? '（もう居ない）' : who2.trim()));
  });
}

{
  const p = openPage('index.html', '', { people: 3, mix: true });   /* 全員 入社日が入っている種 */
  await wait(); await wait(); await wait();
  T('★★全員 入社日が入っていれば 聞く箱を出さない（用が済んだ物を見せない）★★', () => {
    p.w.document.getElementById('tab-people').click();
    const box = p.w.document.getElementById('hire-ask');
    ok(box.hidden, '★もう聞く事が無いのに 出している★: ' + box.textContent.slice(0, 60));
    ok(box.innerHTML === '', '★中身が残っている★');
    console.log('     実測: 箱ごと出さない（hidden=' + box.hidden + '）');
  });
}

/* ── ★年5日★（2026-08-19 指示役④-②）＝★10日以上 付いた人だけ★ ─────────────── */
{
  const p = openPage('index.html', '', { people: 4, hireMix: true, mix: true });
  await wait(); await wait(); await wait(); await wait();
  T('★★年5日＝対象の人だけ「あと◯日（期限 ◯年◯月◯日）」が出る★★', () => {
    const d3 = p.w.document;
    const head = d3.getElementById('must5-head'), box = d3.getElementById('must5');
    ok(!head.hidden, '★対象が居るのに 見出しが出ていない★');
    const cards = box.querySelectorAll('.tc-card');
    ok(cards.length > 0, '★1人も出ていない★');
    const n = /年5日（(\d+)人）/.exec(head.textContent);
    ok(n && +n[1] === cards.length, '★見出しの人数が 中身と合っていない★: ' + head.textContent);
    ok(/あと \d+日/.test(box.textContent), '★あと何日を出していない★');
    ok(/期限 \d{4}年\d{1,2}月\d{1,2}日/.test(box.textContent), '★期限を出していない★: ' + box.textContent.slice(0, 100));
    /* ★入社日が無い人は 出さない★（数えられないのに 出したら嘘になる） */
    const noHire = [...p.w.OwnerApp._st.people].filter((x) => !x.hire_date).map((x) => x.name);
    const shown = box.textContent;
    noHire.forEach((nm) => ok(shown.indexOf(nm) < 0, '★入社日が無い ' + nm + ' を出している★'));
    console.log('     実測: ' + head.textContent.trim() + '／'
      + (/あと \d+日/.exec(shown) || [''])[0] + '／'
      + (/期限 [^（]*/.exec(shown) || [''])[0].trim()
      + '／入社日が無い ' + noHire.length + '人は 出さない');
  });
}

{
  const p = openPage('index.html', '', { hireDate: null });   /* 入社日が無い1人だけ */
  await wait(); await wait(); await wait(); await wait();
  T('★★年5日の対象が0人なら 見出しごと出さない★★', () => {
    const d4 = p.w.document;
    ok(d4.getElementById('must5-head').hidden, '★0人なのに 見出しが出ている★');
    ok(d4.getElementById('must5').innerHTML === '', '★0人なのに 中身が残っている★');
    console.log('     実測: 見出しも中身も 0');
  });
}

/* ── ★従業員の画面は「残り◯日」を出すだけ★（2026-08-19 指示役⑤） ─────────────
   ★押す物は置かない★（付ける・外すは 社長だけ）／★入社日が無い人には 何も出さない★。 */
{
  const p = openPage('kiroku.html', '?t=11111111-1111-1111-1111-111111111111',
    { yukyuDays: ['2026-03-02', '2026-05-01'] });
  await wait(); await wait(); await wait();
  T('★★従業員の画面に「有給の残り ◯日」が1行 出る（押す物は増やさない）★★', () => {
    const el = p.w.document.getElementById('yukyu-left');
    ok(el && !el.hidden, '★出ていない★');
    ok(/^有給の残り \d+日$/.test(el.textContent.trim()), '★言い方が違う★: ' + el.textContent);
    ok(el.querySelectorAll('button, a, select, input').length === 0, '★押す物を置いている★');
    console.log('     実測: 「' + el.textContent.trim() + '」／その行の押す物 0個');
  });
}

{
  const p = openPage('kiroku.html', '?t=11111111-1111-1111-1111-111111111111', { hireDate: null });
  await wait(); await wait(); await wait();
  T('★★入社日が無い人（実データで 18人中14人）には 何も出さない（0日と嘘を書かない）★★', () => {
    const el = p.w.document.getElementById('yukyu-left');
    ok(el && el.hidden, '★数えられないのに 出している★: ' + (el && el.textContent));
    ok((el.textContent || '').indexOf('0日') < 0, '★0日と書いている★');
    console.log('     実測: 箱ごと出さない（hidden=' + el.hidden + '）');
  });
}

/* ── ★有給を 付ける／外す★（2026-08-19 指示役②）＝★実UIで押して 倉庫を読む★ ──────
   ここは ★押した気になって緑★を作らない：押す前と後で ★倉庫に書かれた物★を数える。 */
{
  const p = openPage('shukei.html', '', { mix: true, ym: '2026-08' });
  await wait(); await wait(); await wait();
  const d2 = p.w.document;
  /* ★押す物の一覧を先に出す★（押した数を後から数えない） */
  console.log('  [有給] 押す物: #cal の日 → 「有給にする」 → もう一度 開いて 「有給をやめる」');

  T('★★日を開くと 有給の残りが その場で出る（付与＋繰越−使った）★★', () => {
    const cell = [...d2.querySelectorAll('#cal [data-day]')][0];
    ok(cell, 'カレンダーの日が無い');
    cell.click();
    const t = d2.getElementById('cal-day').textContent;
    const m = /残り\s*(\d+)日（付与 (\d+) ＋ 繰越 (\d+) − 使った (\d+)）/.exec(t);
    ok(m, '★残りが出ていない★: ' + t.slice(-120));
    ok(+m[1] === Math.max(0, +m[2] + +m[3] - +m[4]),
      '★足し算が合っていない★: ' + m[0]);
    console.log('     実測: ' + m[0]);
  });

  T('★★「有給にする」を押したら 倉庫に paid_leave が書かれた（誰が・いつ 付き）★★', () => {
    const before = (p.fake._saved || []).filter((x) => x.table === 'tc_shift').length;
    const btn = d2.querySelector('#cal-day [data-yk]');
    ok(btn, '★押す物が無い★');
    ok(btn.textContent.trim() === '有給にする', '言葉が違う: ' + btn.textContent);
    btn.click();
    const rows = (p.fake._saved || []).filter((x) => x.table === 'tc_shift');
    ok(rows.length === before + 1, '★押したのに 倉庫へ行っていない★（' + before + '→' + rows.length + '）');
    const row = rows[rows.length - 1].row;
    ok(row.day_kind === 'paid_leave', '★有給として書いていない★: ' + row.day_kind);
    ok(row.day_kind_by, '★誰が付けたかが残っていない★');
    ok(row.day_kind_at, '★いつ付けたかが残っていない★');
    console.log('     実測: ' + row.d + ' → ' + row.day_kind + '（誰が: 有り／いつ: 有り）');
  });

  T('★★もう有給の日には「やめる」しか出ない（今の状態で押せる物だけ）★★', () => {
    /* ★有給の日★（種が入れてある 8/2）を開く＝押す物が「やめる」に変わる */
    const cells = [...d2.querySelectorAll('#cal [data-day]')];
    const yu = cells.filter((b) => /有/.test(b.textContent))[0];
    ok(yu, '★有給の印が付いた日が1つも無い★');
    yu.click();
    const btns = [...d2.querySelectorAll('#cal-day [data-yk]')];
    ok(btns.length === 1, '★押す物が ' + btns.length + '個（1個のはず）★');
    ok(btns[0].textContent.trim() === '有給をやめる', '言葉が違う: ' + btns[0].textContent);
    ok(btns[0].getAttribute('data-yk') === 'work', '★戻す先が work でない★');
    console.log('     実測: 有給の日を開くと 「' + btns[0].textContent.trim() + '」1個だけ');
  });
}

/* ★締めた月は 有給も 付けられない（可否は締めの1か所から聞く）★ */
{
  const p = openPage('shukei.html', '', { mix: true, ym: '2026-07', closedYm: '2026-07' });
  await wait(); await wait(); await wait();
  T('★★締めた月は 有給の押す物を そもそも出さない（理由を出す）★★', () => {
    const d3 = p.w.document;
    const cell = [...d3.querySelectorAll('#cal [data-day]')][0];
    if (!cell) { console.log('     実測: この月はカレンダーが無い（試験の種を見直す）'); ok(false, 'カレンダーが無い'); }
    cell.click();
    const box = d3.getElementById('cal-day');
    const btns = [...box.querySelectorAll('[data-yk]')];
    ok(btns.length === 0, '★締めた月なのに 押せる★（' + btns.length + '個）');
    /* ★理由は 締めの1か所（lib/tc-close.js）が作る文★＝ここで言い換えない */
    ok(/確定しています/.test(box.textContent), '★理由が出ていない★: ' + box.textContent.slice(-100));
    console.log('     実測: 押す物 0個／理由「'
      + (/この月は[^]*?要ります/.exec(box.textContent) || [''])[0] + '」');
  });
}

T('★「渡す」を押したらファイルが実際に作られた（名前も出る）', () => {
  const r = results.filter((x) => x.file === 'shukei.html')[0];
  ok(r.page.delivered.length >= 2, '落とした物: ' + JSON.stringify(r.page.delivered));
  ok(r.page.delivered.some((n) => /\.csv$/.test(n)), 'CSVが出ていない');
  const hint = r.page.w.document.getElementById('namehint').textContent;
  ok(/この名前で保存します/.test(hint), '★押す前に保存名を出していない★');
  console.log('     実測: ' + r.page.delivered.join(' / '));
});

/* ── 締め（実UIで 確定 → 渡す → 解除 まで通す） ───────────────────── */
T('★★実UIで「確定」を押したら 記録が1行 増えた（押しただけで終わっていない）★★', () => {
  const r = results.filter((x) => x.file === 'shukei.html')[0];
  const log = r.page.fake._store.tc_close;
  const kinds = log.map((x) => x.action);
  ok(kinds.indexOf('close') >= 0, '★確定の記録が無い★: ' + JSON.stringify(kinds));
  ok(kinds.indexOf('reopen') >= 0, '★解除の記録が無い★: ' + JSON.stringify(kinds));
  const rp = log.filter((x) => x.action === 'reopen')[0];
  ok((rp.reason || '').length >= 2, '★解除の理由が残っていない★');
  ok(log.every((x) => x.by_uid), '★誰がやったかが残っていない★');
  ok(log.every((x) => x.ym === '2026-07'), '別の月に記録している: ' + JSON.stringify(log.map((x) => x.ym)));
  const snap = log.filter((x) => x.action === 'close')[0].snapshot;
  ok(snap && snap.rows && snap.rows.length >= 1, '★確定した時の数字を焼き付けていない★');
  console.log('     実測: 記録 ' + log.length + '行 = ' + kinds.join(' → ')
    + ' / 焼き付けた人数 ' + (snap.rows || []).length);
});

T('★★解除したら 渡す口が閉じる（古い数字を配らない）★★', () => {
  const r = results.filter((x) => x.file === 'shukei.html')[0];
  const d2 = r.page.w.document;
  /* 押した順の最後は 次の月(2026-08=受付中) なので、どちらにせよ閉じている */
  ['b-csv', 'b-kyuyo', 'b-xlsx'].forEach((id) => {
    ok(d2.getElementById(id).disabled, '★' + id + ' が押せるままになっている★');
  });
  /* ★「なぜ押せないか」が 押せない物の側に付いている★（別の場所で理由を探させない） */
  const why = d2.getElementById('b-kyuyo').title;
  ok(why && why.length > 0, '★押せない理由が付いていない★');
  ok(/確定/.test(why), '理由が「確定」に触れていない: ' + why);
  /* 解除の後に もう一度 確定を押せた＝締め待ちに戻っている */
  ok(r.sawDisabled.length === 0 || !r.sawDisabled.includes('b-close'),
    '★解除の後に 確定を押せない（締め待ちに戻っていない）★');
  console.log('     実測: 押せなかった物 ' + JSON.stringify(r.sawDisabled) + ' / 理由「' + why + '」');
});

T('★★状態は 色ではなく文字で出る（受付中／締め待ち／確定）★★', () => {
  const r = results.filter((x) => x.file === 'shukei.html')[0];
  const el = r.page.w.document.getElementById('cstate');
  ok(['受付中', '締め待ち', '確定'].indexOf(el.textContent) >= 0, '状態の文字が出ていない: ' + el.textContent);
  ok(!r.page.w.document.getElementById('closebox').hidden, '締めの箱が出ていない');
  /* ★空の箱を見せない★ … 理由が空なら 文字も空（枠だけ残さない作りかを見る） */
  const hist = r.page.w.document.getElementById('chist').textContent;
  ok(hist.length > 0, '★記録が1行も出ていない（消している）★');
  console.log('     実測: 状態「' + el.textContent + '」/ 記録の表示 ' + hist.length + '文字');
});

T('★★画面に出た文に ★ が混じっていない（★はコードの目印で 人に見せる物ではない）★★', () => {
  /* 2026-08-15 実配信で出た: 社長の画面に「会社が★解除★してください」がそのまま出ていた。
     ★書いた物ではなく 出た物を見る★（描き終わった後の本文を1枚ずつ数える）。 */
  const bad = [];
  for (const r of results) {
    const t = r.page.w.document.body.textContent || '';
    const hits = (t.match(/★[^★\n]{0,40}★/g) || []);
    if (hits.length) bad.push(r.file + ': ' + hits.slice(0, 3).join(' / '));
  }
  ok(bad.length === 0, '★が出ている画面: ' + bad.join(' ｜ '));
  console.log('     実測: ' + results.length + '画面の本文を見て ★ は 0件');
});

/* ★本文を見る検査は この下ではなく ファイルの一番下でやる★
   （入口を開いた画面など ★後から開く画面も含めて数える★ ため）。
   2026-08-15 に踏んだ: 空の箱の検査を途中に置いたら、入口の画面を見ておらず
   ★バグを入れ直しても緑のまま★だった（＝見張りが空振りしていた）。 */

T('★印刷は「紙だけの新しい窓」で開く（中身が0枚なら開かない）', () => {
  const r = results.filter((x) => x.file === 'shukei.html')[0];
  ok(r.page.opened.length === 1, '新しい窓が ' + r.page.opened.length + '個');
  const body = r.page.opened[0].document.body.innerHTML;
  ok(body.length > 200, '★白紙の窓が開いた★（' + body.length + '文字）');
  ok(/勤務表/.test(body), '紙の見出しが無い');
  ok(!/どう絞り込んだ|絞り込み|フィルタ/.test(body), '★紙に絞り込みの説明を刷っている★');
});

/* ★2026-08-18 4つ全部は押せなくなった★（司さん「出勤押してもないのに退勤おせるとか」）
   ＝★いまの状態で押してよい物だけ★出す。この画面の種は「出勤中」なので
     押せるのは ★退勤 と 私用で外出 の2つだけ★（出勤・外出から戻るは その状態では出さない）。
   ★押せなかった物は sawDisabled に出る★＝黙って0回になっていないかを ここで数える。 */
T('★従業員の画面が 打刻を倉庫へ送った（押せる物だけ・押しただけで終わっていない）', () => {
  const r = results.filter((x) => x.file === 'punch.html')[0];
  const n = r.page.fake._calls.filter((c) => c === 'rpc:tc_punch_add').length;
  ok(n >= 1, '打刻のRPCが ' + n + '回（1回も送っていない）');
  const st = r.page.w.TcClean.stateOf([
    { at: '2026-08-03T09:00', kind: 'in' }, { at: '2026-08-03T20:00', kind: 'out' },
    { at: '2026-08-04T09:30', kind: 'in', src: 'calendar', pending: true },
  ], {});
  const canPress = ['in', 'out', 'away_in', 'away_out'].filter((k) => st.allow[k]).length;
  ok(n === canPress, '押せるはずの ' + canPress + '個と 送った ' + n + '回が合っていない');
  console.log('     実測: 状態「' + st.label + '」→ 押せる ' + canPress + '個 / 送った ' + n + '回'
    + ' / 押せなかった物 ' + JSON.stringify(r.sawDisabled));
});

/* ★2026-08-18 夜3 司さん「シンプルイズベスト」★
   ＝★決まりは1つ（自分の打刻は自分で直せる・消せる。締めた後はできない）★
   あとから入れる分も ★その場で入る★（お願い・承認は画面から消えた）。 */
T('★あとから入れる は その場で入る（お願いにしない・跡は中で残る）', () => {
  const r = results.filter((x) => x.file === 'kiroku.html')[0];
  const c = r.page.fake._calls;
  ok(c.indexOf('rpc:tc_punch_edit') >= 0, '★その場で入れていない★');
  ok(c.indexOf('rpc:tc_fix_request') < 0, '★まだ お願いを出している★');
  const add = r.page.fake._store.edit.filter((x) => !x.p_id);
  ok(add.length >= 1, '足した分が ' + add.length + '件');
  ok(add[0].p_kind, '★種類を渡していない★');
  console.log('     実測: 足した ' + add.length + '件（その場で入る）／お願い 0件');
});

/* ── 暗証番号（★従業員が持つ秘密は これ1つだけ★） ───────────────── */
{
  const TOKEN = '11111111-1111-1111-1111-111111111111';

  /* ★「暗証番号あり・端末を忘れた」人の入口★ … この形でしか出ない不具合がある。
     ★開いておかないと 下の本文の検査が空振りする★（2026-08-15 実機で出た空の箱がこれ） */
  {
    const p = openPage('punch.html', '?t=' + TOKEN, { forgotten: true });
    await wait(); await wait();
    T('★★端末を忘れた人の入口は「暗証番号」1つを聞くだけ★★', () => {
      const d2 = p.w.document;
      ok(!d2.getElementById('gate').hidden, '入口が出ていない');
      ok(d2.getElementById('gate-first').hidden, '★決めていない人の案内が出ている（もう決めてある）★');
      ok(!d2.getElementById('gate-again').hidden, '暗証番号の欄が出ていない');
      const boxes = [...d2.querySelectorAll('#gate input')].filter((el) => !el.closest('[hidden]'));
      ok(boxes.length === 1, '★聞いている欄が ' + boxes.length + '個ある（1つのはず）★');
      console.log('     実測: 端末を忘れた人に 聞く欄は ' + boxes.length + '個');
    });
  }

  T('★★従業員の入口に 秘密の欄が1つしか無い（あいことばの欄が消えている）★★', () => {
    const p = openPage('punch.html', '?t=' + TOKEN, { noPassword: true });
    const d2 = p.w.document;
    /* ★「最初のあいことば」の欄が残っていないか★ */
    ok(!d2.getElementById('init'), '★まだ初回コードの欄がある（秘密が2つ）★');
    ok(!d2.getElementById('pw1') && !d2.getElementById('pw2'), '★まだ8文字以上の欄がある★');
    ok(d2.getElementById('pin1') && d2.getElementById('pin2'), '暗証番号の欄が無い');
    const txt = d2.body.textContent;
    ok(txt.indexOf('あいことば') < 0, '★画面に「あいことば」が残っている★');
    ok(/暗証番号/.test(txt), '「暗証番号」と書いていない');
    console.log('     実測: 決める欄 2つ（pin1/pin2）／初回コードの欄 0／「あいことば」0件');
  });

  /* ★T() は同期の入れ物★（async を渡すと 中で落ちても緑になる＝偽の緑）。
     ★押すのは先に済ませて、数えるのは同期でやる★ */
  const tried = {};
  for (const [label, a, b] of [['4桁', '1234', '1234'], ['3桁', '123', '123'],
    ['1111', '1111', '1111'], ['食い違い', '1234', '5678'], ['7桁', '1234567', '1234567']]) {
    const p = openPage('punch.html', '?t=' + TOKEN, { noPassword: true });
    await wait(); await wait();
    p.w.document.getElementById('pin1').value = a;
    p.w.document.getElementById('pin2').value = b;
    p.w.document.getElementById('b-setpin').click();
    await wait(); await wait();
    tried[label] = {
      sent: p.fake._calls.indexOf('rpc:tc_pin_set') >= 0,
      alert: p.w.document.getElementById('gate-alert').textContent,
      gateClosed: p.w.document.getElementById('gate').hidden,
    };
  }

  T('★★4桁で決められる（倉庫まで届く／決めたら そのまま入る）★★', () => {
    ok(tried['4桁'].sent, '★倉庫まで届いていない★');
    ok(tried['4桁'].gateClosed, '★決めたのに入口が閉じない（もう一度 打たせている）★');
  });

  T('★★3桁と7桁は押しても倉庫へ行かない（理由も出る）★★', () => {
    ['3桁', '7桁'].forEach((k) => {
      ok(!tried[k].sent, '★' + k + 'なのに倉庫へ送った★');
      ok(/4桁から6桁/.test(tried[k].alert), k + ' の理由が出ていない: ' + tried[k].alert);
    });
    console.log('     実測: 3桁 →「' + tried['3桁'].alert + '」／倉庫へは行かなかった');
  });

  T('★★1111 は通る（止めると人は紙に書く）★★', () => {
    ok(tried['1111'].sent, '★1111 を止めている★');
  });

  T('★★2つが食い違ったら止まる★★', () => {
    ok(!tried['食い違い'].sent, '★食い違っているのに送った★');
    ok(/違います/.test(tried['食い違い'].alert), '理由が出ていない: ' + tried['食い違い'].alert);
  });
}

/* ── ①まだ暗証番号を決めていない人が 記録の画面を先に開いた時 ───────────
   ★入口を2つ作らない★＝決める所は打つ画面の1か所だけ。?t= を落とさずに渡す。 */
{
  const TOKEN = '11111111-1111-1111-1111-111111111111';
  const p = openPage('kiroku.html', '?t=' + TOKEN, { noPassword: true });
  await wait(); await wait(); await wait();

  T('★★暗証番号を決めていない人でも 記録の画面が行き止まりにならない★★', () => {
    const d2 = p.w.document;
    ok(!d2.getElementById('gate').hidden, '入口が出ていない');
    ok(!d2.getElementById('gate-first').hidden, '★「決めていない人」の案内が出ていない（空の枠だけ）★');
    ok(d2.getElementById('gate-again').hidden, '★あいことば欄が出たまま（決めていないのに入れと言っている）★');
    /* ★空の箱を見せない★ … 案内の中に 押せる物が本当に在るか */
    const a = d2.getElementById('to-setpw');
    ok(a && a.textContent.trim().length > 0, '案内が空');
    console.log('     実測: 出た案内「' + a.textContent.trim() + '」');
  });

  T('★★渡し先に ?t= が残っている（落とすと社長のログイン画面へ飛ぶ）★★', () => {
    const href = p.w.document.getElementById('to-setpw').getAttribute('href');
    ok(/^punch\.html\?/.test(href), '飛び先が打つ画面でない: ' + href);
    ok(href.indexOf('t=' + TOKEN) >= 0, '★?t= が落ちている★: ' + href);
    ok(/back=kiroku/.test(href), '★戻り先を持っていない（決めさせた所で放り出す）★');
    console.log('     実測: ' + href);
  });

  /* ★「決め終わったら記録の画面へ戻る」は ここでは測れない★
     jsdom の window.location は差し替えられない（Cannot redefine property）。
     ★測れない物を、測れたふりで緑にしない★。
     ⇒ ★本物のブラウザで通した★（2026-08-15・timeally-test.vercel.app）:
        暗証番号を決めていない人のリンクで kiroku を開く → 案内を押す →
        打つ画面で決める → ★kiroku.html?t=… へ戻り 記録が出た★
     ここで見張れるのは「渡し先が正しいか」まで（上の2本）。 */
}

/* ── ②同じ従業員番号の人を2人 作らせない ───────────────────────── */
{
  const p = openPage('index.html', '', {});
  await wait(); await wait(); await wait();

  const pwSetPage = openPage('index.html', '', { pwSet: true });
  await wait(); await wait(); await wait();

  /* ★法定休日を「曜日で決める」会社も1枚 開く★（2026-08-15）
     ＝この形でしか ★曜日の欄（hol-dow）が出ない★。開かないと
     ★その中の空の箱を 見張りが素通りする★（実機で 曜日の下に空の枠が出ていた）。 */
  openPage('index.html', '', { mix: true });
  await wait(); await wait(); await wait();

  T('★★1枚のカードの中で 札と説明が食い違わない（暗証番号のあり／なし）★★', () => {
    /* 2026-08-15 に踏んだ: 札は帳面を見ず pw_hash を見て、説明は帳面だけを見ていたので、
       ★同じカードに「暗証番号あり」と「まだ決めていません」が同時に出た★。
       ★可否と理由は同じ物から出す★（この決まりは締めでも同じ）。
       ★「暗証番号あり・帳面に記録なし」の人を作らないと この検査は素通りする★ */
    const d2 = pwSetPage.w.document;
    d2.getElementById('tab-people').click();
    /* ★2026-08-16 から 1人1行★（開くと中が出る）。★開かないと説明が読めない＝必ず開いて数える★ */
    const rows = [...d2.querySelectorAll('#people .tc-row')];
    ok(rows.length > 0, '従業員の行が無い');
    rows.forEach((c) => {
      c.querySelector('[data-open]').click();
      const t = c.textContent.replace(/\s+/g, ' ');
      const hasTag = /済/.test(c.querySelector('.tc-tag').textContent);
      const saysNone = /まだ暗証番号を決めていません/.test(t);
      ok(!(hasTag && saysNone), '★札と説明が食い違っている★: ' + t.slice(0, 90));
    });
    console.log('     実測: 従業員 ' + rows.length + '行を開いて 食い違い 0件');
  });

  T('★★同じ従業員番号は 人が読む言葉で止まる（倉庫へ書きに行かない）★★', () => {
    const d2 = p.w.document;
    d2.getElementById('tab-people').click();
    const before = p.fake._calls.filter((c) => c === 'tc_pub.insert').length;
    /* 種の人は emp_no='A01'。同じ番号で作ろうとする */
    d2.getElementById('p-name').value = '別の 人';
    d2.getElementById('p-no').value = 'A01';
    d2.getElementById('b-addperson').click();
    const after = p.fake._calls.filter((c) => c === 'tc_pub.insert').length;
    ok(after === before, '★重なっているのに倉庫へ書きに行った★');
    const toast = (d2.querySelector('.tc-toast') || {}).textContent || '';
    ok(/もう使われています/.test(toast), '★人が読む言葉で止めていない★: ' + toast);
    ok(toast.indexOf('A01') >= 0, 'どの番号かを言っていない: ' + toast);
    console.log('     実測: 「' + toast + '」／倉庫へは書きに行かなかった');
  });

  T('★★重なっていない番号なら通る（止めすぎていない）★★', () => {
    const d2 = p.w.document;
    const before = p.fake._calls.filter((c) => c === 'tc_pub.insert').length;
    d2.getElementById('p-name').value = '新しい 人';
    d2.getElementById('p-no').value = 'A99';
    d2.getElementById('b-addperson').click();
    const after = p.fake._calls.filter((c) => c === 'tc_pub.insert').length;
    ok(after === before + 1, '★重なっていないのに止めた★');
  });

  T('★★従業員番号が空でも作れる（番号を使っていない会社が在る）★★', () => {
    const d2 = p.w.document;
    const before = p.fake._calls.filter((c) => c === 'tc_pub.insert').length;
    d2.getElementById('p-name').value = '番号なし 人';
    d2.getElementById('p-no').value = '';
    d2.getElementById('b-addperson').click();
    const after = p.fake._calls.filter((c) => c === 'tc_pub.insert').length;
    ok(after === before + 1, '★空の番号を止めてしまった★');
    const sent = p.fake._saved.filter((s) => s.table === 'tc_pub' && s.kind === 'insert').slice(-1)[0];
    ok(sent.row.emp_no === null, '★空を空文字で送っている（倉庫の一意に引っかかる）★: ' + JSON.stringify(sent.row.emp_no));
  });
}

/* ── 締め切った月を 従業員が開いた時（★もう1回 開いて押す★） ─────────── */
{
  const closedPages = {};
  for (const file of ['punch.html', 'kiroku.html']) {
    const p = openPage(file, '?t=11111111-1111-1111-1111-111111111111', { empClosed: true });
    await wait(); await wait(); await wait();
    closedPages[file] = p;
  }

  T('★★締め切った月: 従業員に出るのは1文だけ（割増・丸め・金額の話が1語も無い）★★', () => {
    const t = closedPages['kiroku.html'].w.document.getElementById('closed-note');
    ok(!t.hidden, '知らせが出ていない');
    ok(/締め切りました/.test(t.textContent), '文が違う: ' + t.textContent);
    ['割増', '丸め', '切り捨て', '残業', '深夜', '実労働', '金額', '円'].forEach((w) => {
      ok(t.textContent.indexOf(w) < 0, '★' + w + ' が入っている★: ' + t.textContent);
    });
    console.log('     実測: 従業員に出た文「' + t.textContent + '」');
  });

  T('★★締め切った月: 打刻も お願いも 押せない（押せると「出したのに直らない」になる）★★', () => {
    const pd = closedPages['punch.html'].w.document;
    ['b-in', 'b-out', 'b-ain', 'b-aout'].forEach((id) => {
      ok(pd.getElementById(id).disabled, '★' + id + ' が押せる★');
    });
    ok(closedPages['kiroku.html'].w.document.getElementById('b-add').disabled, '★お願いが押せる★');
  });

  T('★★締め切った月でも 打った時刻は見えたまま（隠さない）★★', () => {
    const box = closedPages['kiroku.html'].w.document.getElementById('list');
    ok(/\d\d:\d\d/.test(box.textContent), '★時刻が消えている★');
    /* ★数えない分（まだ入っていない打刻）は 出さない★ので、出るのは数える打刻だけ */
    const n = (box.textContent.match(/\d\d:\d\d/g) || []).length;
    ok(n >= 2, '出ている時刻が ' + n + '個');
    console.log('     実測: 締め切った後も 数える打刻 ' + n + '個が見えたまま');
  });
}

/* ── ★★ミスが起きない作り（打つ画面）★★（2026-08-18 司さん）────────────────
   「出勤押してもないのに退勤おせるとか」「間違えて押した時の仕様を見直すべきやろ」
   ★押す物の一覧を先に書く★:
     未出勤の画面 … #b-in（押せる・大きい）／#b-out（★灰色＋理由★）／#b-ain #b-aout（出さない）
     押した直後   … #b-undo（★60秒だけ出る★）／#b-in（「いま打ちました」で押せない）
     出勤中の画面 … #b-out（押せる・大きい）／#b-in（出さない）／#to-fix（打ち間違えた）
     過去の時刻   … 全部 押せない＋#t-why に理由 */
{
  const nowJst = new Date(Date.now() + 9 * 3600000).toISOString();
  const today = nowJst.slice(0, 10);
  const T_URL = '?t=11111111-1111-1111-1111-111111111111';
  console.log('\n  punch.html（★いまの状態で押せる物だけ出す★）で押す物');
  ['#b-in（未出勤）', '#b-undo（打った直後60秒）', '#b-out（出勤中）'].forEach((s) => console.log('    - ' + s));

  /* ① まだ出勤していない人 */
  const p0 = openPage('punch.html', T_URL, { punches: [] });
  await wait(); await wait(); await wait();
  T('★★出勤していない人に「退勤」を押させない（灰色＋理由）★★', () => {
    const d2 = p0.w.document;
    ok(!d2.getElementById('b-in').disabled, '★出勤が押せない★');
    ok(/main/.test(d2.getElementById('b-in').className), '★押せる物が大きくなっていない★');
    ok(d2.getElementById('b-out').disabled, '★出勤していないのに 退勤が押せる★');
    ok(!d2.getElementById('b-out').hidden, '退勤を消してしまった（灰色で残して理由を出す）');
    ok(d2.getElementById('b-ain').hidden && d2.getElementById('b-aout').hidden, '外出の2つが出ている');
    const why = d2.getElementById('deny-why');
    ok(!why.hidden && /先に出勤/.test(why.textContent), '★押せない理由が出ていない★: ' + why.textContent);
    ok(/まだ出勤していません/.test(d2.getElementById('state-now').textContent), 'いまの状態が出ていない');
    console.log('     実測: 理由「' + why.textContent + '」');
  });

  /* ② 押した直後（★取り消せる★・同じ物は押せない） */
  p0.w.document.getElementById('b-in').click();
  await wait(); await wait();
  T('★★打った直後は「取り消す」が出て、同じボタンは押せない★★', () => {
    const d2 = p0.w.document;
    const box = d2.getElementById('undo');
    ok(!box.hidden, '★取り消す箱が出ていない★');
    ok(/取り消せます/.test(d2.getElementById('undo-what').textContent),
      '残り時間を出していない: ' + d2.getElementById('undo-what').textContent);
    ok(d2.getElementById('b-in').disabled, '★同じボタンが続けて押せる（連打できる）★');
    ok(/いま打ちました/.test(d2.getElementById('b-in').textContent), '★押せない事を字で出していない★');
    console.log('     実測: ' + d2.getElementById('undo-what').textContent);
  });

  T('★★取り消すと 会社には何も出ない（お願いにもならない）★★', () => {
    const d2 = p0.w.document;
    d2.getElementById('b-undo').click();
    ok(p0.fake._store.undo.length === 1, '★取り消しを倉庫へ出していない★');
    ok(p0.fake._store.fixReq.length === 0, '★取り消しなのに お願いを出している★');
    ok(!p0.fake._calls.some((c) => /tc_punch\.delete/.test(c)), '★打刻を消している★');
    console.log('     実測: 取り消し 1件／お願い 0件（★消す道は通っていない★）');
  });

  /* ③ 出勤中の人（★前の日の夜から出勤中★＝いま何時でも「最後より後」になる＝時計に振り回されない） */
  const yday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const p1 = openPage('punch.html', T_URL, { punches: [[yday + 'T23:00', 'in']] });
  await wait(); await wait(); await wait();
  T('★★出勤中の人には「退勤」だけ大きく（出勤は出さない・打ち間違えたの逃げ道を出す）★★', () => {
    const d2 = p1.w.document;
    ok(d2.getElementById('b-in').hidden, '★出勤中なのに 出勤が出ている★');
    ok(!d2.getElementById('b-out').disabled && /main/.test(d2.getElementById('b-out').className),
      '★退勤が大きく押せる形になっていない★');
    ok(!d2.getElementById('to-fix').hidden, '★「出勤を打ち間違えた」の逃げ道が無い★');
    ok(/出勤中/.test(d2.getElementById('state-now').textContent), d2.getElementById('state-now').textContent);
  });

  /* ④ ★過去の時刻には打たせない★（08/17 の事故はここから起きた）
     ★時計に振り回されない形で測る★＝今日 09:00 に出勤した人が 08:00 を選ぶ（値は直に入れる） */
  const p2 = openPage('punch.html', T_URL, { punches: [[today + 'T09:00', 'in']] });
  await wait(); await wait(); await wait();
  T('★★最後に打った時刻より前は 押せない（打つ画面で過去へ戻らせない）★★', () => {
    const d2 = p2.w.document;
    const t = d2.getElementById('t');
    t.value = '08:00';                       // 09:00 に出勤した後に 08:00 を選ぶ
    t.onchange();
    ok(d2.getElementById('b-out').disabled, '★過去の時刻で 退勤が押せる★');
    const why = d2.getElementById('t-why');
    ok(!why.hidden && /最後に打ったのは 09:00/.test(why.textContent), '理由が出ていない: ' + why.textContent);
    ok(/記録へ/.test(why.textContent), '★逃げ道（あとから入れる）を出していない★');
    console.log('     実測: 「' + why.textContent + '」');
  });
}

/* ── ★★連打・打ち間違い・時刻ちがい（★畳んだ後★）★★（2026-08-18 夜 司さん「複雑すぎんか？」）
   ★押す物の一覧を先に書く★:
     ① 08/17 の実物5本 … #ask0-in（出勤でした）★その日の質問は1つだけ★
     ② 行を押す        … [data-pid] → ★2つだけ★ #fix-open（時刻を直す）／#fix-drop（これは間違い）
     ③ 直す            … #fix-open → #fix-c0（候補）→ #fix-send（お願いを出す）
     ④ あとから入れる  … #b-addopen（★既定は畳む★）
   ★合格の数★: 開いた行に見える押せる物 ≤3／「お願いを出す」は画面に1つ／同じ字のボタンは1つ */
{
  const REAL = [['2026-08-17T08:00', 'in'], ['2026-08-17T08:00', 'out'], ['2026-08-17T08:00', 'in'],
    ['2026-08-17T17:03', 'out'], ['2026-08-17T21:44', 'in']];
  const T_URL = '?t=11111111-1111-1111-1111-111111111111';
  console.log('\n  kiroku.html（★08/17 の実物 5本・畳んだ後★）で押す物');
  ['#ask0-in', '[data-pid]', '#fix-open', '#fix-c0', '#fix-send', '#fix-drop', '#b-addopen']
    .forEach((x) => console.log('    - ' + x));

  /** ★見えている押せる物だけ数える★（hidden の中は数えない） */
  const visBtns = (w, root) => [...(root || w.document).querySelectorAll('button, a.tc-btn')]
    .filter((b) => !b.closest('[hidden]') && !b.hidden);

  const p = openPage('kiroku.html', T_URL, { punches: REAL });
  await wait(); await wait(); await wait();
  const text0 = p.w.document.getElementById('list').textContent;

  T('★★おかしい所は言う。ただし ★1日に1つまで★（質問を積み上げない）★★', () => {
    /* ★数えない打刻は 画面に出さない★（2026-08-18 司さん「そもそも数えんのなら見せるなや」）
       ＝08/17 の5本のうち ★出るのは 数える物だけ★（同じ分に2回 押した分は出さない） */
    ok(!/2回 押しました/.test(text0), '★数えない打刻を見せている★');
    ok(!/まとめました/.test(text0), '★まとめた説明が残っている★');
    /* ★打刻の行だけ数える★（説明の文にも時刻は出るので 行で数える） */
    const shownRows = p.w.document.querySelectorAll('#list .tc-punchline').length;
    ok(shownRows === 4, '★出ている打刻の行が ' + shownRows + '本★（数える4本のはず）');
    console.log('     実測: 出ている打刻 ' + shownRows + '本（原本5本のうち 2回押した1本は出さない）');
    ok(/08:00 は 出勤と退勤が同じ時刻です。どちらでしたか？/.test(text0), '★どちらか聞いていない★');
    ok(/決められません/.test(text0), '★その日の結論を出していない★');
    ok(!/まだ退勤が入っていません/.test(text0), '★同じ日に 質問を2つ並べている★');
    const asks = p.w.document.querySelectorAll('#list .tc-ask');
    ok(asks.length === 1, '★その日に出ている質問が ' + asks.length + '個★');
    console.log('     実測: 質問 ' + asks.length + '個（08/17）');
  });

  T('★★「あとから入れる」は既定で畳む＝「お願いを出す」は1つも見えていない★★', () => {
    const d2 = p.w.document;
    ok(d2.getElementById('add-box').hidden, '★あとから入れるが開きっぱなし★');
    const sends = visBtns(p.w).filter((b) => /お願いを出す/.test(b.textContent));
    ok(sends.length === 0, '★畳んでいるのに「お願いを出す」が ' + sends.length + '個 見えている★');
  });

  T('★★従業員の画面に 数えた結果の言葉が1つも出ていない（時刻だけ）★★', () => {
    ['実労働', '労働時間', '残業', '時間外', '深夜', '割増', '丸め', '金額', '時給', '法定']
      .forEach((w) => ok(text0.indexOf(w) < 0, '★' + w + ' が出ている★'));
  });

  /* ① 質問に答える（1問ごとに保存） */
  const a0 = p.w.document.getElementById('ask0-in');
  if (a0) a0.click();
  await wait(); await wait();
  T('★★質問の答えは ★その場で記録に入る★（お願いにしない・締めていない月）★★', () => {
    ok(a0, '#ask0-in が無い');
    const ed = p.fake._store.edit, req = p.fake._store.fixReq;
    ok(ed.length === 1, '★自分で直す道を通っていない★（' + ed.length + '件）');
    ok(ed[0].p_at === null, '★取り消しなのに 時刻を送っている★');
    ok(/08:00 は 出勤でした/.test(ed[0].p_reason), ed[0].p_reason);
    ok(req.length === 0, '★会社を待たせる道を通っている★: ' + req.length + '件');
    /* ★「直しました」は 押した時に1回 出すだけ★（画面に貼り付けない・司さんの決まり）
       ※本物では 記録が変わるので 次の描き直しで質問そのものが消える。
         ここは倉庫の代わりが 前の打刻を返し続けるので、★貼り付けていない事★だけを見る。 */
    const toast = (p.w.document.querySelector('.tc-toast') || {}).textContent || '';
    ok(/直しました/.test(toast), '★押した時に何も言っていない★: ' + toast);
    ok(!/直しました/.test(p.w.document.getElementById('list').textContent), '★画面に貼り付けている★');
    console.log('     実測: その場で直した 1件／言ったのは押した時の1回だけ');
  });

  /* ② 行を押す＝★2つだけ★ */
  const pb = openPage('kiroku.html', T_URL, { punches: REAL });
  await wait(); await wait(); await wait();
  const rows = () => [...pb.w.document.querySelectorAll('[data-pid]')];
  const rowCount = rows().length;
  if (rows()[0]) rows()[0].click();
  await wait(); await wait();

  T('★★行を押すと出るのは 2つだけ（時刻を直す／これは間違い）＝押せる物 3つまで★★', () => {
    const d2 = pb.w.document;
    const panel = d2.querySelector('.tc-punchrow .tc-ask');
    ok(panel, '★開いていない★');
    ok(d2.getElementById('fix-open') && d2.getElementById('fix-drop'), '2つが出ていない');
    ok(!d2.getElementById('fix-send'), '★候補も「お願いを出す」も先に出している★');
    /* ★開いた行に見える押せる物★＝行そのもの（押すと閉じる）＋2つ＝3つまで */
    const row = panel.closest('.tc-punchrow');
    const n = visBtns(pb.w, row).length;
    ok(n <= 3, '★開いた行に 押せる物が ' + n + '個★（3つまで）');
    console.log('     実測: 押せる行 ' + rowCount + '本／開いた行の押せる物 ' + n + '個');
  });

  /* ③ 時刻を直す → 候補 → 出す */
  const fo = pb.w.document.getElementById('fix-open');
  if (fo) fo.click();
  await wait();
  const c0 = pb.w.document.querySelector('[id^="fix-c"]');
  if (c0) c0.click();
  await wait();

  T('★★「時刻を直す」を押してから 候補が出る／選ぶと1行 出て そこで初めて押せる★★', () => {
    ok(c0, '★候補が出ていない★');
    const box = pb.w.document.getElementById('fix-why');
    ok(/に直します$/.test(box.textContent.trim()), '★出す前の1行が無い（または言葉が道と合っていない）★: ' + box.textContent);
    const send = pb.w.document.getElementById('fix-send');
    ok(!send.disabled, '★選んだのに押せない★');
    ok(send.textContent.trim() === '直す', '★承認が要らないのに「お願い」と書いている★: ' + send.textContent);
    /* ★出す物＝押すと記録が動く物★（行の「直す」は 開くだけなので数えない） */
    const sends = visBtns(pb.w).filter((b) => /tc-btn/.test(b.className || '')
      && /^(直す|会社に出す|お願いを出す)$/.test((b.textContent || '').trim()));
    ok(sends.length === 1, '★出す物が ' + sends.length + '個★');
    console.log('     実測: ' + box.textContent + '／出す物 ' + sends.length + '個（' + send.textContent + '）');
  });

  const sendBtn = pb.w.document.getElementById('fix-send');
  if (sendBtn && !sendBtn.disabled) sendBtn.click();
  await wait(); await wait();
  T('★★「直す」を押すと その場で入る（お願いを作らない・元の行は消さない）★★', () => {
    const ed = pb.fake._store.edit, req = pb.fake._store.fixReq;
    ok(ed.length === 1, '★自分で直す道を通っていない★（' + ed.length + '件）');
    ok(ed[0].p_at, '★新しい時刻を送っていない★');
    ok(ed[0].p_id, '★どの打刻を直すのか渡していない★');
    ok(req.length === 0, '★お願いも出している★: ' + req.length + '件');
    ok(!pb.fake._calls.some((c) => /tc_punch\.delete/.test(c)), '★打刻を消している★');
    console.log('     実測: 自分で直した 1件（新しい時刻つき）／お願い 0件／消した打刻 0本');
  });

  /* ④ ★同じ事をするボタンが2つ在ったら赤★ */
  const pc = openPage('kiroku.html', T_URL, { punches: [['2026-08-17T09:00', 'in']] });
  await wait(); await wait(); await wait();
  T('★★同じ字のボタンが2つ出ていない（同じ事をする物を2か所に置かない）★★', () => {
    [['閉じた画面', pc], ['08/17の画面', p]].forEach((pair) => {
      const seen = {}, dup = [];
      visBtns(pair[1].w).forEach((b) => {
        const t = (b.textContent || '').trim();
        if (!t) return;
        if (seen[t]) dup.push(t); else seen[t] = 1;
      });
      ok(dup.length === 0, '★' + pair[0] + ' に同じ字のボタンが2つ: ' + dup.join(' / ') + '★');
    });
    const t = pc.w.document.getElementById('list').textContent;
    ok(!/この出勤を取り消す/.test(t), '★取り消しの口が2つ在る★');
    console.log('     実測: 同じ字のボタン 0件／取り消しの口は「これは間違い（取り消す）」1つ');
  });

  /* ⑤ あとから入れるを開くと 打刻の直しは閉じる（お願いを出すは1つのまま） */
  pc.w.document.getElementById('b-addopen').click();
  await wait();
  T('★★「あとから入れる」を開いても 押す物は画面に1つ（言葉は「足す」）★★', () => {
    const d2 = pc.w.document;
    ok(!d2.getElementById('add-box').hidden, '開いていない');
    const sends = visBtns(pc.w).filter((b) => /^(直す|消す|足す)$/.test((b.textContent || '').trim()));
    ok(sends.length === 1, '★押す物が ' + sends.length + '個★');
    ok(sends[0].textContent.trim() === '足す', '言葉が違う: ' + sends[0].textContent);
    ok(/時刻を選んでください/.test(d2.getElementById('add-why').textContent), '押せない理由が出ていない');
    console.log('     実測: 開いた後の押す物 ' + sends.length + '個（' + sends[0].textContent.trim() + '）');
  });
}
/* ── ★★締めた月は 直せない（会社に言ってください）★★（2026-08-18 夜3 司さんの決まり）
   ★給与が確定した後に 勤怠が動くと 計算が狂う★ので、締めた後だけは 押せない。 */
{
  const SEED = { punches: [['2026-08-17T09:00', 'in'], ['2026-08-17T18:00', 'out']], empClosed: true };
  const T_URL2 = '?t=11111111-1111-1111-1111-111111111111';
  const pA = openPage('kiroku.html', T_URL2, SEED);
  await wait(); await wait(); await wait();
  const rowsA = [...pA.w.document.querySelectorAll('[data-pid]')];
  if (rowsA[0]) rowsA[0].click();
  await wait(); await wait();
  const dropA = pA.w.document.getElementById('fix-drop');
  if (dropA) dropA.click();
  await wait(); await wait();

  /* ★2026-08-22 直した★＝前は「押させてから断る」形を検査していた
     （締めた月でも「直す」が並び、押して開いて 最後に倉庫が断る）。
     ★今の決まりは 08-18 の「今の状態で押せる物しか出さない」★＝
     ★押す物は そもそも出さない／理由は 上の1行に出す★（有給の箱と同じ形）。 */
  T('★★締めた月は 直す物を そもそも出さない／理由を出す★★', () => {
    const ed = pA.fake._store.edit, req = pA.fake._store.fixReq;
    ok(ed.length === 0, '★締めた月なのに 倉庫へ送っている★（' + ed.length + '件）');
    ok(req.length === 0, '★お願いの道が まだ生きている★（' + req.length + '件）');
    ok(rowsA.length === 0, '★締めた月なのに 押せる打刻が出ている★（' + rowsA.length + '個）');
    const note = pA.w.document.getElementById('closed-note');
    ok(note && !note.hidden && /締め切りました/.test(note.textContent),
      '★理由を出していない★: ' + (note ? note.textContent : 'closed-note が無い'));
    console.log('     実測: 押せる打刻 0個／送った 0件／理由「' + (note ? note.textContent.trim() : '') + '」');
  });

  T('★★締めた月は「あとから入れる」の口ごと出さない／理由を出す★★', () => {
    const d2 = pA.w.document;
    const open = d2.getElementById('b-addopen');
    ok(open.hidden, '★締めた月なのに「あとから入れる」が出ている★');
    ok(d2.getElementById('add-box').hidden, '★中の欄が開いている★');
    const note = d2.getElementById('closed-note');
    ok(note && !note.hidden && /締め切りました/.test(note.textContent),
      '理由が出ていない: ' + (note ? note.textContent : 'closed-note が無い'));
    console.log('     実測: 口 0個／理由「' + note.textContent.trim() + '」');
  });
}

/* ── ★社長の「承認する前に どうなるか」★（★使わない印のお願いも数に入る★・2026-08-18） ── */
{
  const p = openPage('index.html', '', { fixVoid: true });
  await wait(); await wait(); await wait();
  T('★★「この1本は使わない」お願いも 承認前に 数で見せる（0→0 に見せない）★★', () => {
    const box = p.w.document.getElementById('pend').textContent;
    const m = /元は (\d+)分 → 入れると (\d+)分/.exec(box);
    ok(m, '★承認する前の数が出ていない★: ' + box.slice(0, 120));
    ok(m[1] !== m[2], '★使わない印を数に入れていない（元と後が同じ）★: ' + m[0]);
    console.log('     実測: ' + m[0]);
  });

}

/* ★数字が動かない直し★（まだ退勤が入っていない日の「時刻の直し」）は
   ★0分→0分 と出さずに 何が起きるかを言う★（2026-08-18 実配信で見た） */
{
  const day = '2026-08-03';
  const p = openPage('index.html', '', { fixSame: true, sameDay: day, punches: [[day + 'T09:00', 'in']] });
  await wait(); await wait(); await wait();
  T('★★数字が動かない直しは「0分→0分」と出さない（何が起きるかを言う）★★', () => {
    const t = p.w.document.getElementById('pend').textContent;
    ok(!/元は 0分 → 承認すると 0分/.test(t), '★0→0 のまま出している★: ' + t.slice(0, 140));
    ok(/数字は変わりません/.test(t), '★何が起きるかを言っていない★: ' + t.slice(0, 140));
    ok(/まだ退勤が入っていません/.test(t), '理由が出ていない: ' + t.slice(0, 140));
    const line = (t.split('\n').filter((x) => /数字は変わりません/.test(x))[0] || '').trim();
    console.log('     実測: ' + line.slice(0, 100));
  });
}

/* ── ★箱は2つ★（指示役 2026-08-18 夜）＝「もう入った物」と「まだの物」を混ぜない ──
   ①「直した記録」        … もう入っている → ★押す物を出さない★
   ②「まだ入っていません」… 承認前の古い分 → ［入れる］［入れない］
   ★わざと混ぜたら 赤になる★ ところまで この場で試す（見張りが空振りしていない証拠）。 */
{
  /* ★混ざり方を数える道具★（この1本を 本物と 混ぜた物の両方に当てる） */
  const mixCheck = (doc) => {
    const bad = [];
    const done = doc.getElementById('fixes');
    const pend = doc.getElementById('pend');
    const btns = done.querySelectorAll('button').length;
    if (btns) bad.push('「直した記録」に押す物が ' + btns + '個');
    if (/まだ入っていません|入れる|入れない/.test(done.textContent)) bad.push('「直した記録」に まだの物の言葉が入っている');
    if (/本人が直した|入れた|入れなかった/.test(pend.textContent)) bad.push('「まだ入っていません」に もう入った物の言葉が入っている');
    [].forEach.call(pend.querySelectorAll('.tc-card'), (c, i) => {
      if (!c.querySelector('[data-ok]') || !c.querySelector('[data-ng]')) bad.push((i + 1) + '枚目に［入れる］［入れない］が無い');
    });
    return bad;
  };
  const num = (t) => { const m = /（(\d+)件）/.exec(t || ''); return m ? +m[1] : -1; };

  const p = openPage('index.html', '', { fixBoth: true });
  await wait(); await wait(); await wait();
  const d = p.w.document;

  T('★★社長の画面＝「直した記録」と「まだ入っていません」を 1つの箱に混ぜない★★', () => {
    const bad = mixCheck(d);
    ok(bad.length === 0, '★混ざっている★: ' + bad.join(' / '));
    console.log('     実測: 直した記録 ' + d.getElementById('fixes').querySelectorAll('.tc-card').length
      + '枚（押す物 ' + d.getElementById('fixes').querySelectorAll('button').length + '個）'
      + '／まだ入っていません ' + d.getElementById('pend').querySelectorAll('.tc-card').length + '枚');
  });

  T('★★見出しに 件数を出す（①と②を それぞれ数える）★★', () => {
    const h1 = d.getElementById('fixes-head'), h2 = d.getElementById('pend-head');
    ok(!h1.hidden && !h2.hidden, '見出しが出ていない（' + h1.hidden + '/' + h2.hidden + '）');
    ok(num(h1.textContent) === d.getElementById('fixes').querySelectorAll('.tc-card').length,
      '★「直した記録」の件数が 中身と合っていない★: ' + h1.textContent);
    ok(num(h2.textContent) === d.getElementById('pend').querySelectorAll('.tc-card').length,
      '★「まだ入っていません」の件数が 中身と合っていない★: ' + h2.textContent);
    console.log('     実測: ' + h1.textContent.trim() + '／' + h2.textContent.trim());
  });

  T('★★わざと混ぜたら 赤になる（この見張りは 空振りしていない）★★', () => {
    const done = d.getElementById('fixes');
    const keep = done.innerHTML;
    done.insertAdjacentHTML('beforeend',
      '<div class="tc-card pending"><div class="tc-cardhead"><span class="tc-tag pending">まだ入っていません</span>'
      + '<button class="tc-btn" type="button" data-ok="x">入れる</button></div></div>');
    const bad = mixCheck(d);
    done.innerHTML = keep;
    ok(bad.length >= 2, '★混ぜても 気づかない★（見つけた数 ' + bad.length + '）');
    console.log('     実測: 混ぜたら ' + bad.length + '件 見つけた（' + bad[0] + ' …）');
  });
}

/* ── ★「直した記録」は 読めるか★（2026-08-21 司さんが実機で開いて詰まった） ─────────
   実機に出ていた物 … 「元は 0分 → 0分」／「理由: …は 間違いなので使いません」／
                      「入れた」の札／★同じ 17:03 退勤 が2回★（4件と出ていた）
   ⇒★言う事は1つだけ＝どの打刻を 数えないことにしたか★ */
{
  const p = openPage('index.html', '', { fixReal: true });
  await wait(); await wait(); await wait();
  const d2 = p.w.document;
  T('★★「直した記録」は 1打刻＝1行（重なりを消す・数も直す）★★', () => {
    const box = d2.getElementById('must5') && d2.getElementById('fixes');
    const cards = [...d2.querySelectorAll('#fixes .tc-card')];
    const rows = [...d2.querySelectorAll('#fixes .tc-card div')].map((x) => x.textContent.trim())
      .filter((t) => /数えません/.test(t));
    ok(cards.length === 1, '★同じ人・同じ日が ' + cards.length + '枚に分かれている（1枚のはず）★');
    ok(rows.length === 3, '★行が ' + rows.length + '本（重なりを消して 3本のはず）★: ' + JSON.stringify(rows));
    ok(new Set(rows).size === rows.length, '★同じ行が2回 出ている★: ' + JSON.stringify(rows));
    const head = d2.getElementById('fixes-head').textContent;
    ok(/（3件）/.test(head), '★見出しの数が 重なりを消した後になっていない★: ' + head);
    console.log('     実測: 見出し「' + head.trim() + '」／' + JSON.stringify(rows));
  });

  T('★★「元は 0分 → 0分」「理由:」「入れた」を 出さない（何も言っていない物を消す）★★', () => {
    const t = d2.getElementById('fixes').textContent;
    ok(!/0分 → 0分/.test(t), '★動いていない数を出している★: ' + t.slice(0, 120));
    ok(t.indexOf('理由:') < 0, '★「理由:」が残っている★');
    ok(t.indexOf('入れた') < 0, '★「入れた」の札が残っている★');
    ok(t.indexOf('間違いなので使いません') < 0, '★中の書き方が そのまま出ている★');
    ok(/矢野|山田|太郎|さん|[一-龥]/.test(t), '名前が出ていない');
    console.log('     実測: ' + t.replace(/\s+/g, ' ').trim().slice(0, 80));
  });
}

/* ── ★「まだ入っていません」に 昔の書き方を刷らない★（2026-08-21 指示役・倉庫に残っている文） ──
   作る所は消したが ★保存済みの文は 倉庫に残る★。人が書いた理由は そのまま出す。 */
{
  const p = openPage('index.html', '', { fixOldReason: true });
  await wait(); await wait(); await wait();
  T('★★倉庫に残っている「昔の書き方」は 刷らない（理由:の見出しも出さない）★★', () => {
    const box = p.w.document.getElementById('pend');
    const t = box.textContent;
    ok(box.querySelectorAll('.tc-card').length === 1, '★その1件が出ていない★');
    ok(t.indexOf('間違いなので使いません') < 0, '★昔の書き方を そのまま刷っている★: ' + t.slice(0, 140));
    ok(t.indexOf('理由:') < 0, '★中身が無いのに「理由:」の見出しが出ている★: ' + t.slice(0, 140));
    console.log('     実測: ' + t.replace(/\s+/g, ' ').trim().slice(0, 90));
  });
}

{
  /* ★人が書いた理由は 消さない★（全部 消していないか＝この見張りが空振りしていない証拠） */
  const p = openPage('index.html', '', {});
  await wait(); await wait(); await wait();
  T('★★人が書いた理由（打ち忘れ）は そのまま出す（消しすぎていない）★★', () => {
    const t = p.w.document.getElementById('pend').textContent;
    ok(/理由: 打ち忘れ/.test(t), '★人が書いた理由まで消している★: ' + t.slice(0, 140));
    /* ★機械が作った説明は「理由:」に出さない★（2026-08-21 指示役
       「…を 13:47 に直します」が 理由の顔で出ていた＝★型を潰す★） */
    ok(!/理由:[^]{0,40}(直します|直しました|足しました|消しました|使いません)/.test(t),
      '★機械が作った説明が「理由:」に出ている★: ' + t.slice(0, 160));
    console.log('     実測: ' + (/理由: [^\s]+/.exec(t) || [''])[0] + '（機械の文は 0件）');
  });
}

/* ★古い分が 0件の時★＝②の箱は 見出しごと出さない（今どきの会社は ほぼ これ） */
{
  const p = openPage('index.html', '', { fixDoneOnly: true });
  await wait(); await wait(); await wait();
  T('★★もう「お願い」を出さない会社では ②の箱が出ない（0件なら 見出しごと消す）★★', () => {
    const d = p.w.document;
    const h2 = d.getElementById('pend-head');
    ok(h2.hidden, '★0件なのに ②の見出しが出ている★: ' + h2.textContent);
    ok(d.getElementById('pend').innerHTML === '', '★0件なのに ②の中身が残っている★');
    ok(!d.getElementById('fixes-head').hidden, '①の見出しが出ていない');
    ok(d.getElementById('fixes').querySelectorAll('button').length === 0,
      '★本人が直した物に 押す物が出ている★');
    console.log('     実測: ②は 見出しも中身も 0（①は ' + d.getElementById('fixes-head').textContent.trim()
      + '・押す物 0個）');
  });
}

T('★従業員の追加・会社情報の保存が 実際に倉庫へ書きに行った', () => {
  const r = results.filter((x) => x.file === 'index.html')[0];
  const c = r.page.fake._calls;
  ok(c.indexOf('tc_pub.insert') >= 0, '従業員の追加が書きに行っていない');
  ok(c.indexOf('tc_companies.upsert') >= 0, '会社情報の保存が書きに行っていない');
});

T('★★「時間」で入れた設定が「分」で倉庫へ行く（8→480 / 40→2400 / 1→60）★★', () => {
  const r = results.filter((x) => x.file === 'index.html')[0];
  const w = r.page.w;
  ok(w.TcHours, 'lib/tc-hours.js を読み込んでいない');
  /* ★単位は打たせず 押させる★（スマホの数字キーボードでは「分」が打てない）
     見出しに単位は書かない（ボタンと二重になる） */
  const lab = w.document.querySelector('label[for="c-daily"]').textContent;
  ok(!/（時間）|（分）/.test(lab), '見出しに単位が残っている: ' + lab);
  ['c-daily', 'c-week', 'c-break'].forEach((id) => {
    ok(w.document.getElementById(id + '-h'), id + ' に「時間」のボタンが無い');
    ok(w.document.getElementById(id + '-m'), id + ' に「分」のボタンが無い');
  });
  /* 押した時に何を送ったか（保存の中身）を実際に見る */
  const sent = r.page.fake._saved.filter((x) => x.table === 'tc_companies').pop();
  ok(sent, '会社情報を送っていない');
  ok(sent.row.daily_std_min === 480, '1日の所定が ' + sent.row.daily_std_min + '（480のはず）');
  ok(sent.row.week_std_min === 2400, '1週の所定が ' + sent.row.week_std_min + '（2400のはず）');
  ok(sent.row.break_default_min === 60, '休憩の既定が ' + sent.row.break_default_min + '（60のはず）');
  console.log('     実測: 8→' + sent.row.daily_std_min + ' / 40→' + sent.row.week_std_min + ' / 1→' + sent.row.break_default_min);
});

T('★★「分」を押して 45 と入れたら 45分で保存される（スマホで単位が打てない件）★★', () => {
  const r = results.filter((x) => x.file === 'index.html')[0];
  const d = r.page.w.document;
  d.getElementById('tab-company').click();
  d.getElementById('c-break').value = '45';
  d.getElementById('c-break-m').click();                    // ★「分」を押す★
  const hint = d.getElementById('c-break-hint').textContent;
  ok(/＝ 45分/.test(hint), '欄の下が「＝45分」になっていない: ' + hint);
  ok(d.getElementById('c-break-m').getAttribute('aria-selected') === 'true', '「分」が選ばれていない');
  ok(d.getElementById('c-break-h').getAttribute('aria-selected') === 'false', '「時間」も選ばれたまま');
  d.getElementById('b-savecompany').click();
  const sent = r.page.fake._saved.filter((x) => x.table === 'tc_companies').pop();
  ok(sent.row.break_default_min === 45, '★倉庫へ ' + sent.row.break_default_min + ' が行った（45のはず）★');
  /* ★「時間」に戻すと 45時間＝長すぎで止まる（理由も本当の事を言う）★ */
  d.getElementById('c-break-h').click();
  const h2 = d.getElementById('c-break-hint').textContent;
  ok(/45時間/.test(h2) && /「分」を押して/.test(h2), '止めた理由が本当の事になっていない: ' + h2);
  console.log('     実測: 「分」→45→倉庫 45分 ／「時間」→45→止まる（理由つき）');
});

T('★単位ボタンも「選ばれている1つだけ黄」（タブと同じ決まり）', () => {
  const r = results.filter((x) => x.file === 'index.html')[0];
  const d = r.page.w.document;
  ['c-daily', 'c-week', 'c-break'].forEach((id) => {
    const on = [id + '-h', id + '-m'].filter((x) => d.getElementById(x).getAttribute('aria-selected') === 'true');
    ok(on.length === 1, id + ' で選ばれている単位が ' + on.length + '個');
  });
});

T('★★「出る」はタブと同じ形にしない・押しても1回 確認する★★', () => {
  const r = results.filter((x) => x.file === 'index.html')[0];
  const d = r.page.w.document;
  const out = d.getElementById('b-signout');
  const tab = d.getElementById('tab-list');
  /* ★見た目が同じだとタブだと思って押す（実機で踏んだ）★ */
  ok(out.className !== tab.className, '「出る」がタブと同じ見た目（class が同じ）');
  ok(/quiet/.test(out.className), '「出る」を目立たない形にしていない');
  /* ★タブの行の中に居ない★（ヘッダーへ移した） */
  ok(!out.closest('.tc-tabs'), '「出る」がまだタブの行に並んでいる');
  /* 並びは 会社 → 従業員 → 今月の勤務（★月めくりの行と混ぜない★＝role=tablist の行だけ見る）
     ★2026-08-16 から 集計へは タブの行ではなく 帯のいちばん右★
     ＝★別のページへ移る物の置き場所を 全画面で1つに決めた★（司さん「戻るが集計の時だけ右上」） */
  const row = d.querySelector('.tc-tabs[role="tablist"]');
  ok(row, 'タブの行が見つからない');
  const order = [...row.children].map((e) => e.id).filter(Boolean);
  ok(order.join(',') === 'tab-company,tab-people,tab-list',
    '並びが違う: ' + order.join(','));
  const goShukei = d.getElementById('go-shukei');
  ok(goShukei && goShukei.closest('.tc-appbar'), '★集計へが 帯の中に無い★');
  ok(goShukei && !goShukei.closest('.tc-tabs'), '★集計へが タブの行に戻っている★');
  ok(goShukei && goShukei.parentNode.lastElementChild === goShukei, '★集計へが 帯のいちばん右にない★');
  /* ★集計は別のページへ飛ぶ物だと分かる★ */
  const go = d.getElementById('go-shukei');
  ok(go.tagName === 'A' && /shukei\.html/.test(go.getAttribute('href')), '集計が飛び先を持っていない');
  ok(/→/.test(go.textContent), '飛ぶ物だと分かる印（→）が無い');
  /* ★押しただけでは出ない（確認が出る）★ */
  ok(r.page.fake._calls.indexOf('auth.signOut') < 0
    || r.page.fake._calls.indexOf('auth.signOut') > r.page.fake._calls.indexOf('auth.getUser'),
  '確認なしで出ている');
  /* ★言葉は「ログアウト」★（「出る」だとどこから出るのか分からない・司さん指摘） */
  ok(out.textContent.trim() === 'ログアウト', '右上が「' + out.textContent.trim() + '」');
  ok(d.getElementById('b-signout-yes').textContent.trim() === 'ログアウト',
    '確認の中のボタンが「' + d.getElementById('b-signout-yes').textContent.trim() + '」');
  console.log('     実測: 並び ' + order.join(' → ') + ' ／ 右上は「' + out.textContent.trim() + '」' + out.className);
});

T('★★開いているタブは いつでも1つだけ（4つ順に押して毎回 数える）★★', () => {
  const r = results.filter((x) => x.file === 'index.html')[0];
  const d = r.page.w.document;
  const tabs = ['tab-company', 'tab-people', 'tab-list'];
  const counts = [];
  tabs.forEach((id) => {
    d.getElementById(id).click();
    const on = [...d.querySelectorAll('.tc-tabs[role="tablist"] [aria-selected]')]
      .filter((e) => e.getAttribute('aria-selected') === 'true');
    counts.push(id + ':' + on.length);
    ok(on.length === 1, id + ' を押したら 開いているタブが ' + on.length + '個');
    ok(on[0].id === id, id + ' を押したのに ' + on[0].id + ' が開いている事になっている');
  });
  /* ★集計は「開いているタブ」にならない★（別のページへ飛ぶ物） */
  const go = d.getElementById('go-shukei');
  ok(!go.hasAttribute('aria-selected'), '集計が選択中の印を持っている＝タブに見える');
  console.log('     実測: ' + counts.join(' / ') + '（集計は選択中の印を持たない）');
});

T('★丸めの選び方が画面に出ていて、法律の外なら注意が出る', () => {
  const r = results.filter((x) => x.file === 'index.html')[0];
  const w = r.page.w, d = w.document;
  ok(d.getElementById('c-runit').options.length >= 4, '単位の選択肢が無い');
  ok(d.getElementById('c-rdir').options.length === 3, '向きの選択肢が3つでない');
  ok(d.getElementById('c-rscope').options.length === 2, 'かける先の選択肢が2つでない');
  /* ★日ごと・切り捨て★ を選んだら 注意が出るか（実際に選んで確かめる） */
  d.getElementById('c-round').value = 'custom';
  d.getElementById('c-runit').value = '15';
  d.getElementById('c-rdir').value = 'floor';
  d.getElementById('c-rscope').value = 'day';
  d.getElementById('c-round').onchange();
  const warn = d.getElementById('round-warn');
  ok(!warn.hidden, '★日ごとに15分切り捨て を選んでも注意が出ない★');
  ok(/法律の上ではできない/.test(warn.textContent), '注意の中身が違う: ' + warn.textContent);
  ok(!d.getElementById('round-custom').hidden, '細かい選択肢が出ていない');
  /* ★認められている形★ を選んだら 注意は消える */
  d.getElementById('c-round').value = 'month';
  d.getElementById('c-round').onchange();
  ok(d.getElementById('round-warn').hidden, '認められている形なのに注意が出ている');
  ok(/認められている形です/.test(d.getElementById('round-example').textContent), '「認められている形」と言っていない');
});

T('★ログインの3つのボタンが それぞれ違う所を呼ぶ', () => {
  const c = results.filter((x) => x.file === 'login.html')[0].page.fake._calls;
  ['auth.signIn', 'auth.signUp', 'auth.reset'].forEach((k) => ok(c.indexOf(k) >= 0, k + ' を呼んでいない'));
});

/* ★社長が覚えるURLは1つだけ★ … ログインしていなければ そのまま入口へ送る
   （「ログインへ」をもう1回押させる作りだと、login.html も覚えるURLになってしまう） */
for (const file of ['index.html', 'shukei.html']) {
  const p = openPage(file, '', { noUser: true });
  await wait(); await wait();
  T(file + ' … ★ログインしていなければ そのまま入口へ送る（押させない）', () => {
    ok(p.fake._calls.indexOf('auth.getUser') >= 0, 'ログインを見に行っていない');
    ok(p.navTried.length > 0, '入口へ送っていない（画面を移そうとしていない）');
    ok(p.w.document.getElementById('main').hidden, '中身を出したままにしている');
    ok(!p.w.document.getElementById('gate'), '★「ログインへ」の被せ物が残っている＝URLが増える★');
    /* 送り先が login.html である事は ★本物のブラウザで実測する★（jsdom は遷移しない）。
       ここでは「コードが login.html を指している」ことだけ固定する。 */
    const src = fs.readFileSync(path.join(ROOT, 'js/owner-app.js'), 'utf8');
    ok(/location\.replace\('login\.html'\)/.test(src), '送り先が login.html になっていない');
  });
}

/* ★ログインが切れた時に 中身の無い画面を出さない★（実配信で踏んだ：
   倉庫は401を返しているのに、画面は「0件」に見えていた） */
{
  const p = openPage('index.html', '', { expired: true });
  await wait(); await wait(); await wait();
  T('★★ログインが切れていたら 入口へ送る（空の画面を出さない）★★', () => {
    ok(p.fake._calls.indexOf('auth.getUser') >= 0, 'ログインを見に行っていない');
    ok(p.navTried.length > 0, '★401なのに その場に留まっている＝空の画面が出る★');
    const src = fs.readFileSync(path.join(ROOT, 'js/tc-db.js'), 'utf8');
    ok(/isAuthError/.test(src), '401を見分ける所が無い');
    ok(/PGRST301|401/.test(src), '401 を見ていない');
  });
}

T('★1000件で切れない道を通っている（range を呼んでいる）', () => {
  const r = results.filter((x) => x.file === 'index.html')[0];
  ok(r.page.fake._calls.some((c) => /\.range$/.test(c)), 'range を1度も呼んでいない＝ページめくりの道が死んでいる');
});

/* ★どの画面も 描き終わるまで待ってから数える★
   （途中の画面を数えると ★まだ描いていない箱★を「空の箱」と言ってしまう） */
await new Promise((r) => setTimeout(r, 400));


/* ═══ 本文を見る検査（★一番下でやる＝開いた画面を1枚残らず数える★） ═══════ */

T('★★画面に出た文に ★ が混じっていない（★はコードの目印で 人に見せる物ではない）★★', () => {
  /* 2026-08-15 実配信で出た: 社長の画面に「会社が★解除★してください」がそのまま出ていた。
     ★書いた物ではなく 出た物を見る★（描き終わった後の本文を1枚ずつ数える）。 */
  const bad = [];
  for (const p of opened_pages) {
    const t = p.w.document.body.textContent || '';
    const hits = (t.match(/★[^★\n]{0,40}★/g) || []);
    if (hits.length) bad.push(p.file + ': ' + hits.slice(0, 3).join(' / '));
  }
  ok(bad.length === 0, '★が出ている画面: ' + bad.join(' ｜ '));
  console.log('     実測: ' + opened_pages.length + '枚 数えて ★ は 0件');
});

T('★★中身が空なのに 枠だけ出ている箱が無い（空の箱を人に見せない）★★', () => {
  /* ★前科3回＋2026-08-15 にもう1回★ … 文字を空にしただけでは .tc-note の枠が残る
     （入口に 何も書いていない箱が1つ余分に見えていた）。 */
  const bad = [];
  for (const p of opened_pages) {
    /* ★閉じているタブの中も見る★（2026-08-15 実機で また出た）
       ＝タブで隠れている所は ★押せば出る所★。見ないと ★空の箱を見逃す★
       （会社情報の「曜日」の下に 空の枠が1つ出ていたのを 見張りが素通りしていた）。
       ★親の hidden を一時的に外して★ 数え、終わったら元へ戻す。 */
    /* ★まだ描き終わっていない画面は数えない★（入口で止まっている＝人はまだ何も見ていない）。
       ★描き終わったか＝本体が出ているか★で見る。 */
    const main = p.w.document.getElementById('main');
    if (main && main.hidden) continue;
    /* ★会社の行をまだ読めていない画面は数えない★（＝まだ描き終わっていない。
       本物では 会社が読めるまで欄は描かれないので、★空の箱として人に見える事は無い★） */
    if (p.w.OwnerApp && !p.w.OwnerApp._st.company) continue;
    const panes = [...p.w.document.querySelectorAll('section[hidden], #pane-company, #pane-people, #pane-list')];
    const was = panes.map((s) => s.hidden);
    panes.forEach((s) => { s.hidden = false; });
    p.w.document.querySelectorAll('.tc-note, .tc-alert').forEach((el) => {
      if (el.hidden || el.closest('[hidden]')) return;     // 自分で消してある物は見ない
      const t = (el.textContent || '').replace(/[\s　]/g, '');
      if (!t && !el.querySelector('img,svg,input,button,a')) bad.push(p.file + '[' + opened_pages.indexOf(p) + ']#' + (el.id || el.className));
    });
    panes.forEach((s, i) => { s.hidden = was[i]; });
  }
  ok(bad.length === 0, '★空の箱が出ている★: ' + bad.join(' ｜ '));
  console.log('     実測: ' + opened_pages.length + '枚の 見えている箱を数えて 空は 0件');
});

T('★★画面に「気づき」が1文字も無い（2026-08-15 に丸ごと外した）★★', () => {
  /* ★書いた物ではなく 出た物を見る★。列も箱も設定も 全部 消えている事を数える。 */
  const bad = [];
  for (const p of opened_pages) {
    const t = p.w.document.body.textContent || '';
    if (t.indexOf('気づき') >= 0) bad.push(p.file);
  }
  ok(bad.length === 0, '★「気づき」が出ている画面: ' + [...new Set(bad)].join(', '));
  /* ★一覧の列が1つ減っている★（氏名＋7列＝8列。前は「気づき」を入れて9列だった） */
  const idx = results.filter((x) => x.file === 'index.html')[0];
  const cols = idx.page.w.document.querySelectorAll('#people-summary thead th').length;
  ok(cols === 8, '★一覧の列が ' + cols + '個（8個のはず＝気づきを外した後）★');
  console.log('     実測: ' + opened_pages.length + '枚を見て「気づき」0件／一覧の列 ' + cols + '個');
});

T('★★画面に「綴じ代」の設定が無い（いつでも四辺20mm）★★', () => {
  /* 2026-08-15 司さんの決定＝★勤務表は必ず綴じる紙★なので選ばせない。
     ★人が決める事を1つ減らした★のが 本当に消えているかを 出た物から数える。 */
  const bad = [];
  for (const p of opened_pages) {
    const d2 = p.w.document;
    if (d2.getElementById('c-bind')) bad.push(p.file + '（設定が残っている）');
    if ((d2.body.textContent || '').indexOf('綴じ代をとる') >= 0) bad.push(p.file + '（説明が残っている）');
    if ((d2.body.textContent || '').indexOf('綴じない') >= 0) bad.push(p.file + '（「綴じない」が残っている）');
  }
  ok(bad.length === 0, '★綴じ代の設定が残っている: ' + [...new Set(bad)].join(', '));
  /* ★「実際のサイズ（100%）で」は残す★（刷る画面へ移した） */
  const sh = results.filter((x) => x.file === 'shukei.html')[0];
  ok(/実際のサイズ/.test(sh.page.w.document.body.textContent || ''),
    '★「実際のサイズ（100%）で刷ってください」が消えている★');
  console.log('     実測: ' + opened_pages.length + '枚に 綴じ代の設定 0件／「実際のサイズ」は残っている');
});

T('★★画面に出た文に「あいことば」が無い（言葉は「暗証番号」1つ）★★', () => {
  /* 言葉が2つある物は必ず食い違う（司さん 2026-08-15）。 */
  const bad = [], withPin = [];
  for (const p of opened_pages) {
    const t = p.w.document.body.textContent || '';
    if (t.indexOf('あいことば') >= 0) bad.push(p.file);
    if (/暗証番号/.test(t)) withPin.push(p.file);
  }
  ok(bad.length === 0, '★「あいことば」が出ている画面: ' + [...new Set(bad)].join(', '));
  ok(withPin.length >= 2, '「暗証番号」と書いている画面が ' + withPin.length + '枚しかない');
  console.log('     実測: ' + opened_pages.length + '枚を見て「あいことば」0件／「暗証番号」'
    + [...new Set(withPin)].length + '種類の画面');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
