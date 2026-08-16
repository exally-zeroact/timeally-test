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
  /* 先に入れる（画面が描き終わってから＝後から描かれる欄にも入る） */
  for (const [id, v] of Object.entries(PREFILL[file] || {})) {
    const el = page.w.document.getElementById(id);
    if (el) el.value = v;
  }
  const dateInput = page.w.document.querySelector('.tc-date-input');
  if (dateInput) dateInput.value = '2026-08-04';
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

T('★従業員の画面が 打刻を倉庫へ送った（押しただけで終わっていない）', () => {
  const r = results.filter((x) => x.file === 'punch.html')[0];
  const n = r.page.fake._calls.filter((c) => c === 'rpc:tc_punch_add').length;
  ok(n === 4, '打刻のRPCが ' + n + '回（4つのボタンぶん来ていない）');
});

T('★あとから入れる は お願い(申請)として送られる', () => {
  const r = results.filter((x) => x.file === 'kiroku.html')[0];
  ok(r.page.fake._calls.indexOf('rpc:tc_fix_request') >= 0, '申請が送られていない');
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
    const n = (box.textContent.match(/\d\d:\d\d/g) || []).length;
    ok(n >= 3, '出ている時刻が ' + n + '個');
    console.log('     実測: 締め切った後も 時刻 ' + n + '個が見えたまま');
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
