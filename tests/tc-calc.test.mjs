/* tc-calc.test.mjs — ★境界を実物で測ってテストに埋める★（Timeally）
 * =============================================================================
 * ここで固定している境界（実物の値・等号・端・空・不明）:
 *   休憩   … 6h00 / 6h01 / 8h00 / 8h01        ★「超える」であって「以上」ではない★
 *   残業   … 0分 / 1分                        ★所定7hの会社の30分は「割増が要らない残業」★
 *   丸め   … 29分 / 30分 / 31分
 *   深夜   … 21:59 / 22:00 / 04:59 / 05:00     ★境目の1分★
 *   その他 … 日をまたぐ勤務 / 打刻が片方だけ / 中抜けが休憩をまたぐ / 打刻ゼロ
 *
 * 使い方: node tests/tc-calc.test.mjs
 *         node tests/tc-calc.test.mjs --self-test  ★わざと壊して赤になるか★
 */
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

/* 打刻を作る小道具（★中身は全部 手で書いた実物の時刻★） */
const P = (at, kind, src) => ({ at, kind, src: src || 'punch' });
function run(punches, company, extra) {
  return C.summarize(Object.assign({ ym: '2026-08', punches: punches, shifts: [], fixes: [] }, extra || {}, { company: company || {} }));
}
const D1 = (s) => s.days.find((d) => d.d === '2026-08-03');   // 2026-08-03 は ★月曜★

console.log('\n[tc-calc] 境界を実物で測る');

/* ── 日ごとの組み立て ──────────────────────────────────────────── */
T('ふつうの1日（9:00-18:00・休憩60分）＝実労働480分・所定内480分・残業0', () => {
  const s = run([P('2026-08-03T09:00', 'in'), P('2026-08-03T12:00', 'break_in'),
    P('2026-08-03T13:00', 'break_out'), P('2026-08-03T18:00', 'out')]);
  const d = D1(s);
  eq(d.workMin, 480); eq(d.breakMin, 60); eq(d.stdMin, 480);
  eq(d.overStdMin, 0); eq(d.otMin, 0); eq(d.nightMin, 0);
});

T('★中抜け（私用外出）は休憩と別に引く★（混ぜると休憩の判定が狂う）', () => {
  const s = run([P('2026-08-03T09:00', 'in'), P('2026-08-03T12:00', 'break_in'),
    P('2026-08-03T13:00', 'break_out'),
    P('2026-08-03T15:00', 'away_in'), P('2026-08-03T15:30', 'away_out'),
    P('2026-08-03T18:00', 'out')]);
  const d = D1(s);
  eq(d.breakMin, 60, '休憩'); eq(d.awayMin, 30, '中抜け'); eq(d.workMin, 450, '実労働');
});

T('★中抜けが休憩をまたいでも二重に引かない（重なりを数える）', () => {
  // 11:30〜13:30 に外出。休憩は 12:00〜13:00 → 重なりは60分
  const s = run([P('2026-08-03T09:00', 'in'), P('2026-08-03T11:30', 'away_in'),
    P('2026-08-03T12:00', 'break_in'), P('2026-08-03T13:00', 'break_out'),
    P('2026-08-03T13:30', 'away_out'), P('2026-08-03T18:00', 'out')]);
  const d = D1(s);
  // ★足して引くと 540 - 60 - 120 = 360（＝60分ぶん 黙って短くなる）★
  //   正しくは 11:30〜13:30 の120分だけ抜けている ⇒ 540 - 120 = 420
  eq(d.breakMin, 60, '休憩は休憩として報告する');
  eq(d.awayMin, 120, '中抜けは中抜けとして報告する');
  eq(d.offMin, 120, '★実際に抜けていた分（重なりは1回だけ）★');
  eq(d.workMin, 420, '★重なりを二重に引いていない★');
});

/* ── 休憩の境界（労基法34条・「超える」） ────────────────────────── */
T('★休憩 6h00 ちょうどは要らない／6h01 から45分要る（超える＝等号を含まない）', () => {
  eq(LAW.requiredBreakMin(6 * 60), 0, '6時間ちょうど');
  eq(LAW.requiredBreakMin(6 * 60 + 1), 45, '6時間1分');
});
T('★休憩 8h00 ちょうどは45分でよい／8h01 から60分要る', () => {
  eq(LAW.requiredBreakMin(8 * 60), 45, '8時間ちょうど');
  eq(LAW.requiredBreakMin(8 * 60 + 1), 60, '8時間1分');
});
T('★休憩不足は「拘束時間」で判定する（実労働だけで見ると1分足りない日を見逃す）', () => {
  // 9:00-15:01（拘束361分・休憩0）→ 45分要るのに0分 ⇒ 警告
  const s = run([P('2026-08-03T09:00', 'in'), P('2026-08-03T15:01', 'out')]);
  const w = s.warnings.filter((x) => x.code === 'break_short');
  eq(w.length, 1); eq(w[0].need, 45); eq(w[0].got, 0);
  // 9:00-15:00（拘束360分ちょうど）→ 警告なし
  const s2 = run([P('2026-08-03T09:00', 'in'), P('2026-08-03T15:00', 'out')]);
  eq(s2.warnings.filter((x) => x.code === 'break_short').length, 0, '6時間ちょうどで誤警告');
});

/* ── 残業の境界（所定超と法定外を混ぜない） ──────────────────────── */
T('★所定7時間の会社で7時間30分＝30分は「割増が要らない残業」（所定超）', () => {
  const s = run([P('2026-08-03T09:00', 'in'), P('2026-08-03T16:30', 'out')], { dailyStdMin: 420 });
  const d = D1(s);
  eq(d.workMin, 450); eq(d.stdMin, 420); eq(d.overStdMin, 30, '所定超'); eq(d.otMin, 0, '★ここを法定外残業にしない★');
});
T('★所定7時間の会社で8時間1分＝所定超60分＋法定外残業1分', () => {
  const s = run([P('2026-08-03T09:00', 'in'), P('2026-08-03T17:01', 'out')], { dailyStdMin: 420 });
  const d = D1(s);
  eq(d.workMin, 481); eq(d.stdMin, 420); eq(d.overStdMin, 60); eq(d.otMin, 1, '法定外残業1分');
});
T('★残業0分（8時間ちょうど）と1分（8時間1分）の境目', () => {
  const a = D1(run([P('2026-08-03T09:00', 'in'), P('2026-08-03T17:00', 'out')]));
  eq(a.otMin, 0, '8時間ちょうど');
  const b = D1(run([P('2026-08-03T09:00', 'in'), P('2026-08-03T17:01', 'out')]));
  eq(b.otMin, 1, '8時間1分');
});

/* ── 深夜の境界（22:00〜翌5:00） ────────────────────────────────── */
T('★深夜 21:59 は0分／22:00 から数える', () => {
  eq(C.nightOverlap(C.toMin('2026-08-03T20:00'), C.toMin('2026-08-03T21:59')), 0);
  eq(C.nightOverlap(C.toMin('2026-08-03T20:00'), C.toMin('2026-08-03T22:01')), 1);
});
T('★深夜 04:59 まで数え、05:00 で終わる', () => {
  eq(C.nightOverlap(C.toMin('2026-08-04T04:00'), C.toMin('2026-08-04T04:59')), 59);
  eq(C.nightOverlap(C.toMin('2026-08-04T04:00'), C.toMin('2026-08-04T06:00')), 60);
});
T('★深夜は休憩・中抜けを引いてから数える', () => {
  const s = run([P('2026-08-03T21:00', 'in'), P('2026-08-03T23:00', 'break_in'),
    P('2026-08-03T23:30', 'break_out'), P('2026-08-04T02:00', 'out')]);
  const d = D1(s);
  eq(d.nightMin, 240 - 30, '22:00〜2:00 の240分から休憩30分を引く');
});

/* ── 日をまたぐ勤務 ─────────────────────────────────────────────── */
T('★日をまたぐ勤務は「出勤した日」に付ける（翌日に割らない）', () => {
  const s = run([P('2026-08-03T22:00', 'in'), P('2026-08-04T06:00', 'out')]);
  const d = D1(s), n = s.days.find((x) => x.d === '2026-08-04');
  eq(d.workMin, 480, '出勤日にまとめる'); eq(n.workMin, 0, '翌日は0');
  ok(d.crossMidnight, '日またぎの印が付いていない');
  eq(s.warnings.filter((w) => w.code === 'cross_midnight').length, 1);
});

/* ── 打刻が片方だけ ─────────────────────────────────────────────── */
T('★出勤だけで退勤が無い日は 0分にして「打刻が片方だけ」を出す（勝手に埋めない）', () => {
  const s = run([P('2026-08-03T09:00', 'in')]);
  const d = D1(s);
  eq(d.workMin, 0); ok(d.incomplete);
  eq(s.warnings.filter((w) => w.code === 'missing_punch').length, 1);
});
T('★退勤だけ（出勤が無い）でも黙って捨てない', () => {
  const s = run([P('2026-08-03T18:00', 'out')]);
  ok(D1(s).incomplete, '印が付いていない');
});
T('★打刻が1つも無い月は 0で返る（落ちない・空にしない）', () => {
  const s = run([]);
  eq(s.month.workedMin, 0); eq(s.month.shukkin, 0); eq(s.days.length, 31);
});

/* ── 週40時間超 ─────────────────────────────────────────────────── */
T('★週40時間を超えた分は法定外残業（日ごとの残業と二重に数えない）', () => {
  // 月〜金 各9時間（実労働8h+1h残業なし＝拘束9hで休憩1h→実労働8h）を6日
  const ps = [];
  ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'].forEach((d) => {
    ps.push(P(d + 'T09:00', 'in'), P(d + 'T12:00', 'break_in'), P(d + 'T13:00', 'break_out'), P(d + 'T18:00', 'out'));
  });
  const s = run(ps);                     // 8時間×6日 = 48時間
  eq(s.month.workedMin, 480 * 6);
  eq(s.month.otMin, 8 * 60, '★週40時間を超えた8時間が残業★');
  const sat = s.days.find((d) => d.d === '2026-08-08');
  eq(sat.weekOtMin, 480, '超えた日に付く');
});
T('★法定休日（日曜）の労働は休日労働。時間外にも週40時間にも入れない', () => {
  // ★法定休日を「日」と決めている会社★（既定は「決めていない」なので明示する）
  const s = run([P('2026-08-09T09:00', 'in'), P('2026-08-09T19:00', 'out')], { legalHolidayDow: 0 });
  const d = s.days.find((x) => x.d === '2026-08-09');
  eq(d.holidayMin, 600); eq(d.otMin, 0); eq(d.stdMin, 0);
  eq(s.month.holidayMin, 600); eq(s.month.otMin, 0);
});

T('★★法定休日を決めていない会社には 休日の割増を付けない（勝手に日曜にしない）★★', () => {
  // 労基法35条の法定休日は「週に1日」。★特定する義務は無い★ので、
  // 決めていない会社に アプリが曜日を決めてしまわない事を固定する。
  const ps = [P('2026-08-09T09:00', 'in'), P('2026-08-09T19:00', 'out')];   // 日曜10時間
  const s = run(ps);                                   // 会社情報を何も入れない＝決めていない
  const d = s.days.find((x) => x.d === '2026-08-09');
  eq(d.isLegalHoliday, false, '★勝手に法定休日にしている★');
  eq(d.holidayMin, 0, '★決めていないのに休日の割増を付けている★');
  eq(s.month.holidayMin, 0);
  eq(d.workMin, 600, '働いた時間そのものは消さない');
  eq(d.otMin, 120, 'ふつうの日として 8時間を超えた分が時間外');
  // ★既定では出さないが、中では常に数えている★
  eq(s.warnings.filter((w) => w.code === 'holiday_not_set').length, 1);
  // 決めた会社では その気づきは出ない
  eq(run(ps, { legalHolidayDow: 0 }).warnings.filter((w) => w.code === 'holiday_not_set').length, 0);
});

/* ── 締め期間 ───────────────────────────────────────────────────── */
T('★締め日25日なら 7/26〜8/25（末日締めなら 8/1〜8/31）', () => {
  eq(JSON.stringify(C.period('2026-08', 25)), JSON.stringify({ ym: '2026-08', from: '2026-07-26', to: '2026-08-25' }));
  eq(JSON.stringify(C.period('2026-08', 31)), JSON.stringify({ ym: '2026-08', from: '2026-08-01', to: '2026-08-31' }));
});
T('★存在しない日（2月30日）は末日に丸める（穴を開けない）', () => {
  eq(C.period('2026-03', 30).from, '2026-02-28');
});

/* ── self-test：わざと壊して赤になるか ───────────────────────────── */
if (process.argv.includes('--self-test')) {
  console.log('\n[tc-calc --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('①「超える」を「以上」に書き換えた作り物は 6時間ちょうどで45分を要求する（本物は0）', () => {
    const wrong = (m) => (m >= 8 * 60 ? 60 : m >= 6 * 60 ? 45 : 0);
    eq(wrong(6 * 60), 45, '作り物が間違っていない＝この検査が空振り');
    eq(LAW.requiredBreakMin(6 * 60), 0, '★本物が6時間ちょうどで休憩を要求している★');
  });
  S('② 所定超を法定外残業に混ぜる作り物は 30分を残業にする（本物は0）', () => {
    const wrong = (w, std) => Math.max(0, w - std);
    eq(wrong(450, 420), 30, '作り物が間違っていない＝この検査が空振り');
    eq(C.splitDay({ workMin: 450, nightMin: 0 }, false, 420).dayOtMin, 0, '★本物が所定超を残業にしている★');
  });
  S('③ 日またぎを翌日に割る作り物は 出勤日が0になる（本物は480）', () => {
    const s = C.summarize({ ym: '2026-08', punches: [P('2026-08-03T22:00', 'in'), P('2026-08-04T06:00', 'out')], company: {} });
    eq(s.days.find((d) => d.d === '2026-08-03').workMin, 480, '★本物が出勤日にまとめていない★');
    eq(s.days.find((d) => d.d === '2026-08-04').workMin, 0, '★本物が翌日に割っている★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
