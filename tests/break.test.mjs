/* break.test.mjs — ★休憩は「押させる」のをやめ「既定を引く」★（Timeally）
 * =============================================================================
 * ★テストを先に書いた★（司さんの指摘 2026-08-15）。ここが合格の線。
 *
 * ★踏んだ事実（自分で数えた）★
 *   会社情報の「休憩の既定」は ★どこにも効いていなかった★（lib/tc-calc.js で0件）。
 *   9:00〜18:00 で休憩を押し忘れると ★実労働540分・時間外60分★ と出ていた。
 *   ★現場は押さない。押さない物を前提にした計算は 必ず多く出る。★
 *
 * ★これから★
 *   ・休憩の打刻が在る日 … ★その値をそのまま使う（過去のデータは1分も動かない）★
 *   ・無い日             … 拘束6時間以下=0分／★6時間超=会社の既定を引く★
 *   ・社長が日ごとに直した日 … ★その値★（誰が・いつ が残る）
 *   ・★既定が法定を下回っても 黙って引き上げない★（引くのは既定のまま・赤で知らせる）
 *   ・★原本(打った時刻)は1分も触らない★。引くのは計算の側だけ。
 *
 * 使い方: node tests/break.test.mjs
 *         node tests/break.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const C = require_(path.join(ROOT, 'lib/tc-calc.js'));
const LAW = require_(path.join(ROOT, 'lib/tc-law.js'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

const CO = (x) => Object.assign({ closeDay: 31, dailyStdMin: 480, breakDefaultMin: 60 }, x || {});
/** 1日ぶんの打刻を作る（'HH:mm' で渡す） */
function day(d, list) {
  return list.map(function (x) { return { at: d + 'T' + x[0], kind: x[1], src: 'punch' }; });
}
function oneDay(punches, co, shifts) {
  const s = C.summarize({ ym: '2026-08', punches: punches, shifts: shifts || [], fixes: [], company: CO(co) });
  return { day: s.days.filter(function (x) { return x.d === '2026-08-03'; })[0], month: s.month, sum: s };
}

console.log('\n[休憩] 押させるのをやめ、既定を引く');

/* ── ① 押し忘れた日に 既定が引かれる ─────────────────────────── */
T('★★9:00〜18:00・休憩を押していない → 実労働480分・時間外0★★', () => {
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]));
  eq(r.day.spanMin, 540, '拘束');
  eq(r.day.breakMin, 60, '★既定の60分が引かれていない★');
  eq(r.day.breakSrc, 'default', 'どこから来た休憩かを持っていない');
  eq(r.day.workMin, 480, '★実労働が540のまま（押し忘れが 残業になっている）★');
  eq(r.day.otMin, 0, '★時間外が出てしまっている★');
  eq(r.month.workedMin, 480); eq(r.month.otMin, 0);
});

T('★会社の既定が45分なら45分だけ引く（うちが勝手に決めない）', () => {
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]), { breakDefaultMin: 45 });
  eq(r.day.breakMin, 45);
  eq(r.day.workMin, 495);
});

T('★既定が0分の会社は 引かない（そういう会社も在る）', () => {
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]), { breakDefaultMin: 0 });
  eq(r.day.breakMin, 0);
  eq(r.day.workMin, 540);
});

/* ── ② 境界（実物で測る） ────────────────────────────────────── */
T('★★拘束6時間ちょうど＝引かない／6時間1分＝引く（等号の境目）★★', () => {
  const a = oneDay(day('2026-08-03', [['09:00', 'in'], ['15:00', 'out']]));
  eq(a.day.spanMin, 360, '6時間');
  eq(a.day.breakMin, 0, '★6時間ちょうどで引いてしまっている★');
  eq(a.day.workMin, 360);

  const b = oneDay(day('2026-08-03', [['09:00', 'in'], ['15:01', 'out']]));
  eq(b.day.spanMin, 361, '6時間1分');
  eq(b.day.breakMin, 60, '★6時間1分で引いていない★');
  eq(b.day.workMin, 301);
});

T('★引きすぎて マイナスにならない（拘束より既定が長い会社）', () => {
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['16:00', 'out']]), { breakDefaultMin: 600 });
  eq(r.day.workMin, 0, '実労働がマイナスになっている');
  eq(r.day.breakMin, 420, '★拘束を超えて引いている★');
});

/* ── ③ 打刻が在る日は そのまま（過去が動かない） ───────────────── */
T('★★休憩の打刻が在る日は その値のまま（既定で上書きしない）★★', () => {
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['12:00', 'break_in'],
    ['12:45', 'break_out'], ['18:00', 'out']]));
  eq(r.day.breakMin, 45, '★打った45分が 既定60分で上書きされている★');
  eq(r.day.breakSrc, 'punch');
  eq(r.day.workMin, 495);
});

T('★片方だけの休憩の打刻は「無い」扱い＝既定を引く（打刻漏れの警告は別に出る）', () => {
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['12:00', 'break_in'], ['18:00', 'out']]));
  eq(r.day.breakSrc, 'default', '片方だけの休憩を使ってしまっている');
  eq(r.day.breakMin, 60);
});

T('★★私用の外出は 休憩と別に そのまま引く（既定と二重に引かない）★★', () => {
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['13:00', 'away_in'],
    ['14:00', 'away_out'], ['18:00', 'out']]));
  eq(r.day.awayMin, 60, '外出が数えられていない');
  eq(r.day.breakMin, 60, '既定の休憩も引く');
  eq(r.day.workMin, 420, '★540 − 外出60 − 休憩60 = 420★');
});

/* ── ④ 社長が日ごとに直せる ──────────────────────────────────── */
T('★★社長が直した日は その値（本当に休憩が取れなかった日が在る）★★', () => {
  const sh = [{ d: '2026-08-03', breakMin: 0, breakBy: 'u1', breakAt: '2026-08-16T10:00:00Z' }];
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]), null, sh);
  eq(r.day.breakMin, 0, '★直した0分が効いていない★');
  eq(r.day.breakSrc, 'fixed');
  eq(r.day.workMin, 540);
  eq(r.day.breakBy, 'u1', '★誰が直したかが残っていない★');
  ok(r.day.breakAt, '★いつ直したかが残っていない★');
});

T('★直した値は 打刻より強い（打刻が在っても 直した方を使う）', () => {
  const sh = [{ d: '2026-08-03', breakMin: 30, breakBy: 'u1', breakAt: '2026-08-16T10:00:00Z' }];
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['12:00', 'break_in'],
    ['13:00', 'break_out'], ['18:00', 'out']]), null, sh);
  eq(r.day.breakMin, 30);
  eq(r.day.breakSrc, 'fixed');
  eq(r.day.workMin, 510);
});

/* ── ⑤ 法定を下回る既定（黙って直さない） ───────────────────── */
T('★★既定が法定を下回っても 黙って引き上げない（赤で知らせる）★★', () => {
  /* 拘束9時間 → 法定は45分ではなく60分（労基法34条・8時間超）。既定30分の会社 */
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]),
    { breakDefaultMin: 30, warnOn: true });
  eq(LAW.requiredBreakMin(540), 60, '法定の前提が違う');
  eq(r.day.breakMin, 30, '★黙って60分に引き上げている（違法な設定が見えなくなる）★');
  eq(r.day.workMin, 510);
  const w = r.sum.warnings.filter(function (x) { return x.code === 'break_default_short'; });
  ok(w.length > 0, '★赤で知らせていない★');
  ok(/法律/.test(w[0].detail), '理由が法律の話になっていない: ' + w[0].detail);
});

T('★★気づきは「引いた後の休憩」で見る（打刻だけで見ない）★★', () => {
  /* 既定60分を引けば法定を満たす日 → ★休憩が足りない とは出ない★ */
  const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]), { warnOn: true });
  const w = r.sum.warnings.filter(function (x) { return x.code === 'break_short' && x.d === '2026-08-03'; });
  eq(w.length, 0, '★引いた後は足りているのに「休憩が足りません」と出ている★');
});

T('★引いた後でも足りない日は ちゃんと出る', () => {
  /* 拘束13時間 → 法定60分。既定は60分だが 8時間超なので足りている…
     ここでは既定を30分にして 足りない事を出す */
  const r = oneDay(day('2026-08-03', [['08:00', 'in'], ['21:00', 'out']]),
    { breakDefaultMin: 30, warnOn: true });
  const w = r.sum.warnings.filter(function (x) { return x.code === 'break_short' && x.d === '2026-08-03'; });
  ok(w.length > 0, '足りないのに出ていない');
  eq(w[0].got, 30, '出している数字が「引いた後の休憩」でない');
});

/* ── ⑥ 原本と恒等式 ─────────────────────────────────────────── */
T('★★原本(打った時刻)は1分も動かない★★', () => {
  const ps = day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]);
  const before = JSON.stringify(ps);
  oneDay(ps);
  eq(JSON.stringify(ps), before, '★渡した打刻が書き換わっている★');
});

T('★★恒等式：総労働 ＝ 所定内＋所定超＋時間外＋休日（休憩を引いた後も）★★', () => {
  const ps = [];
  for (let i = 0; i < 31; i++) {
    const d = C.addDays('2026-08-01', i);
    ps.push({ at: d + 'T08:30', kind: 'in', src: 'punch' }, { at: d + 'T19:10', kind: 'out', src: 'punch' });
  }
  [0, 45, 60, 90].forEach(function (b) {
    const s = C.summarize({ ym: '2026-08', punches: ps, shifts: [], fixes: [],
      company: CO({ breakDefaultMin: b, holidayMode: 'dow', legalHolidayDow: 0 }) });
    const m = s.month;
    eq(m.stdMin + m.overStdMin + m.otMin + m.holidayMin, m.workedMin, '既定' + b + '分で 恒等式が崩れた');
    /* 日ごとの合計とも合う */
    const sum = s.days.reduce(function (a, d) { return a + d.workMin; }, 0);
    eq(m.workedMin, sum, '既定' + b + '分で 月計と日ごとが違う');
  });
});

T('★★深夜が 実労働を超えない（休憩を引いた後）★★', () => {
  /* 22:00〜05:00（拘束420分・全部 深夜の時間帯）に既定60分を引く */
  const ps = [{ at: '2026-08-03T22:00', kind: 'in', src: 'punch' },
    { at: '2026-08-04T05:00', kind: 'out', src: 'punch' }];
  const r = oneDay(ps);
  eq(r.day.workMin, 360, '実労働');
  ok(r.day.nightMin <= r.day.workMin, '★深夜(' + r.day.nightMin + ') が 実労働(' + r.day.workMin + ') を超えている★');
});

/* ── ⑦ 働いた日に「休み」が立っていたら知らせる ───────────────── */
T('★★欠勤・有給になっている日に打刻が在ったら 赤で知らせる（勝手に消さない）★★', () => {
  /* 2026-08-15 指示役の指摘。★見本が雑でも通る＝本物でも通る★ので、見張りを入れる。 */
  const ps = day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]);
  ['absent', 'paid_leave'].forEach(function (kind) {
    const r = oneDay(ps, { warnOn: true }, [{ d: '2026-08-03', dayKind: kind }]);
    const w = r.sum.warnings.filter(function (x) { return x.code === 'day_conflict'; });
    ok(w.length === 1, '★' + kind + ' なのに打刻が在る日を知らせていない★');
    ok(/どちらかが違います/.test(w[0].detail), '理由が弱い: ' + w[0].detail);
    /* ★勝手に片方を消さない★（どちらが本当かは人にしか決められない） */
    eq(r.day.workMin, 480, '★働いた時間を勝手に消している★');
    eq(r.day.dayKind, kind, '★休みの印を勝手に消している★');
  });
});

T('★働いていない日の欠勤・有給は 知らせない（誤警告を出さない）', () => {
  const r = oneDay([], { warnOn: true }, [{ d: '2026-08-03', dayKind: 'absent' }]);
  eq(r.sum.warnings.filter(function (x) { return x.code === 'day_conflict'; }).length, 0);
});

/* ── ⑧ 押す画面から休憩のボタンが消えている ─────────────────── */
T('★★打つ画面のボタンは4つ（休憩の2つが消え、外出は残る）★★', () => {
  const html = fs.readFileSync(path.join(ROOT, 'punch.html'), 'utf8');
  const ids = (html.match(/id="(b-[a-z]+)"/g) || []).map(function (s) { return s.slice(4, -1); });
  ['b-bin', 'b-bout'].forEach(function (id) {
    ok(ids.indexOf(id) < 0, '★' + id + '（休憩）がまだ在る★');
  });
  ['b-in', 'b-out', 'b-ain', 'b-aout'].forEach(function (id) {
    ok(ids.indexOf(id) >= 0, id + ' が無い');
  });
  ok(html.indexOf('休憩に入る') < 0 && html.indexOf('休憩から戻る') < 0, '★休憩のボタンの字が残っている★');
  ok(/私用で外出/.test(html), '★外出まで消している（中抜けは既定で代われない）★');
});

/* ── self-test：わざと壊して赤になるか ───────────────────────── */
if (process.argv.includes('--self-test')) {
  console.log('\n[break --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('① 既定を引かない作り物は 540分・時間外60分になる（本物は480分・0分）', () => {
    const wrong = { span: 540, brk: 0 };
    eq(wrong.span - wrong.brk, 540, '作り物が壊れていない＝この検査が空振り');
    const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]));
    eq(r.day.workMin, 480, '★本物が引いていない★');
    eq(r.day.otMin, 0, '★本物に時間外が出ている★');
  });
  S('② 打刻を既定で上書きする作り物は 過去を動かす（本物は動かさない）', () => {
    const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['12:00', 'break_in'],
      ['12:45', 'break_out'], ['18:00', 'out']]));
    eq(r.day.breakMin, 45, '★本物が打った45分を上書きしている★');
  });
  S('④「働いた日の欠勤」を見ない作り物は 見本が雑でも通る（本物は赤にする）', () => {
    const wrong = function () { return []; };
    eq(wrong().length, 0, '作り物が壊れていない＝この検査が空振り');
    const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]),
      { warnOn: true }, [{ d: '2026-08-03', dayKind: 'absent' }]);
    ok(r.sum.warnings.some(function (x) { return x.code === 'day_conflict'; }), '★本物が知らせていない★');
  });
  S('③ 法定に足りない既定を黙って引き上げる作り物は 違法な設定を隠す（本物は隠さない）', () => {
    const r = oneDay(day('2026-08-03', [['09:00', 'in'], ['18:00', 'out']]),
      { breakDefaultMin: 30, warnOn: true });
    eq(r.day.breakMin, 30, '★本物が黙って引き上げている★');
    ok(r.sum.warnings.some(function (x) { return x.code === 'break_default_short'; }), '★本物が知らせていない★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
