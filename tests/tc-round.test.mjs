/* tc-round.test.mjs — ★丸めの検査（保存則）★（Timeally）
 * =============================================================================
 * ★ここで守る1本の式★
 *     生データの合計 ＝ 丸めた後 ＋ 切り捨てた分
 *   none / month / daily30 の ★3つとも★ 必ず一致する。
 *
 * ★引き算で作った数を突き合わせても意味が無い★ので、
 *   ・「生データの合計」は ★丸める前の日ごとの実労働から別に組み直した物★
 *   ・「丸めた後」は ★本番と同じ summarize() の返り値★
 *   の2つを、それぞれ独立に数えてから比べている。
 *
 * 丸めの境界（実測）: 29分 / 30分 / 31分 ／ 59分 / 60分 / 61分（月の端数）
 *
 * 法律の位置づけ:
 *   none    … 1分単位（既定・適法）
 *   month   … 1か月合計の端数のみ（昭和63.3.14 基発150号・適法）
 *   daily30 … 日ごと30分切り下げ（★客の希望。適法ではない★）
 *             ⇒ ★切り捨てた時間と金額を必ず出す★（他社は丸めて終わり）
 *
 * 使い方: node tests/tc-round.test.mjs
 *         node tests/tc-round.test.mjs --self-test
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

const P = (at, kind) => ({ at, kind, src: 'punch' });

/** 9:00 出勤で ★実労働がちょうど workMin 分★ になる1日を作る。
 *  ★短い日に休憩(12:00-13:00)を挟むと 退勤より後ろになって「休憩が無い日」になる★
 *  （最初これで 29分の日が 89分になり、テストが嘘をついた）。だから長さで分ける。 */
function dayOf(d, workMin) {
  const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  if (workMin <= 180) {
    return [P(d + 'T09:00', 'in'), P(d + 'T' + hm(9 * 60 + workMin), 'out')];
  }
  return [P(d + 'T09:00', 'in'), P(d + 'T12:00', 'break_in'), P(d + 'T13:00', 'break_out'),
    P(d + 'T' + hm(9 * 60 + 60 + workMin), 'out')];
}
function run(punches, rounding, extra) {
  return C.summarize({ ym: '2026-08', punches, shifts: [], fixes: [], company: Object.assign({ rounding, hourlyYen: 1200 }, extra || {}) });
}

/** ★保存則★ 生 ＝ 丸め後 ＋ 切り捨て分（4つの数 全部） */
function conserved(s) {
  const bad = [];
  ['workedMin', 'otMin', 'nightMin', 'holidayMin'].forEach((k) => {
    if (s.raw[k] !== s.month[k] + s.cut[k]) {
      bad.push(`${k}: 生${s.raw[k]} ≠ 後${s.month[k]} + 切${s.cut[k]}`);
    }
  });
  if (bad.length) throw new Error(bad.join(' / '));
}

console.log('\n[tc-round] 丸めの保存則と境界');

/* ── none（既定・適法） ─────────────────────────────────────────── */
T('★none は1分も削らない（切り捨て0）', () => {
  const s = run(dayOf('2026-08-03', 461), 'none');    // 7時間41分
  eq(s.month.workedMin, 461);
  eq(s.cut.workedMin, 0); eq(s.cut.otMin, 0); eq(s.cut.nightMin, 0); eq(s.cut.holidayMin, 0);
  eq(s.cut.yen, 0);
  conserved(s);
});

/* ── daily30（客の希望・適法ではない） ──────────────────────────── */
T('★daily30 の境界 29分/30分/31分（切り下げの端数がそのまま切り捨て分）', () => {
  [[29, 0, 29], [30, 30, 0], [31, 30, 1]].forEach(([w, after, cut]) => {
    const s = run(dayOf('2026-08-03', w), 'daily30');
    eq(s.month.workedMin, after, w + '分→丸め後');
    eq(s.cut.workedMin, cut, w + '分→切り捨て');
    conserved(s);
  });
});

T('★daily30 は毎日削る（30日で積み上がる）＝これが「丸めた分がいくらか」', () => {
  let ps = [];
  const ds = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'];
  ds.forEach((d) => { ps = ps.concat(dayOf(d, 489)); });   // 8時間9分 × 5日
  const s = run(ps, 'daily30');
  eq(s.raw.workedMin, 489 * 5);
  eq(s.month.workedMin, 480 * 5, '毎日9分ずつ削られる');
  eq(s.cut.workedMin, 9 * 5, '★45分ぶん消えている★');
  eq(s.cut.byDayMin, 9 * 5, '日ごとに数えた切り捨てと合計が一致');
  conserved(s);
});

T('★切り捨てた「金額」も出す（時給1200円）', () => {
  const s = run(dayOf('2026-08-03', 489), 'daily30');   // 9分削られる。うち9分は法定外残業
  eq(s.cut.workedMin, 9);
  eq(s.cut.otMin, 9, '削られたのは8時間を超えた分＝法定外残業');
  // 9分 × 1200円/60分 × 1.25 = 225円
  eq(s.cut.yen, 225);
  conserved(s);
});

T('★時給が未設定なら 金額は null（0円と言わない）', () => {
  const s = run(dayOf('2026-08-03', 489), 'daily30', { hourlyYen: null });
  eq(s.cut.yen, null, '★0にすると「削っていない」と読める★');
  eq(s.cut.workedMin, 9, '時間の方は必ず出す');
});

T('★daily30 で退勤を戻した先が休憩の中でも正しく数える', () => {
  // 9:00-11:50 働いて 11:50-12:50 休憩、12:50-13:10 働く → 実労働 190分
  // 30分に切り下げると 180分。10分戻すと 12:50 → 12:40（休憩の中）
  const s = run([P('2026-08-03T09:00', 'in'), P('2026-08-03T11:50', 'break_in'),
    P('2026-08-03T12:50', 'break_out'), P('2026-08-03T13:10', 'out')], 'daily30');
  eq(s.raw.workedMin, 190);
  eq(s.month.workedMin, 180);
  eq(s.cut.workedMin, 10);
  conserved(s);
});

/* ── month（適法・基発150号） ──────────────────────────────────── */
T('★month の端数処理は 30分未満切捨/30分以上切上（1時間未満の端数のみ）', () => {
  eq(LAW.roundMonthFraction(59), 60, '59分→1時間に切上');
  eq(LAW.roundMonthFraction(60), 60, '60分ちょうどは動かさない');
  eq(LAW.roundMonthFraction(61), 60, '1時間1分→切捨');
  eq(LAW.roundMonthFraction(29), 0, '29分→切捨');
  eq(LAW.roundMonthFraction(30), 60, '30分ちょうど→切上');
  eq(LAW.roundMonthFraction(31), 60, '31分→切上');
  eq(LAW.roundMonthFraction(0), 0);
});

T('★month は実労働を削らない（削ってよいのは時間外・休日・深夜の合計だけ）', () => {
  const s = run(dayOf('2026-08-03', 489), 'month');    // 残業9分
  eq(s.month.workedMin, 489, '★実労働に手を付けない★');
  eq(s.raw.otMin, 9);
  eq(s.month.otMin, 0, '9分は30分未満なので切捨');
  eq(s.cut.otMin, 9);
  conserved(s);
});

T('★month の切り上げは「切り捨て分がマイナス」で表す（隠さない）', () => {
  const s = run(dayOf('2026-08-03', 520), 'month');    // 残業40分 → 60分に切上
  eq(s.raw.otMin, 40);
  eq(s.month.otMin, 60, '30分以上なので1時間に切上');
  eq(s.cut.otMin, -20, '★増えた分をマイナスで持つ＝式が崩れない★');
  conserved(s);
});

/* ── 3つとも保存則が成り立つ（まとめて1回） ─────────────────────── */
T('★none / month / daily30 の3つとも 保存則が成り立つ（同じ打刻で）', () => {
  let ps = [];
  ['2026-08-03', '2026-08-04', '2026-08-05'].forEach((d) => { ps = ps.concat(dayOf(d, 507)); });
  ps = ps.concat([P('2026-08-08T21:00', 'in'), P('2026-08-09T02:00', 'out')]);   // 深夜あり
  ps = ps.concat([P('2026-08-09T09:00', 'in'), P('2026-08-09T15:00', 'out')]);   // 日曜=法定休日
  ['none', 'month', 'daily30'].forEach((r) => {
    const s = run(ps, r);
    conserved(s);
    if (r === 'none') {
      eq(s.cut.workedMin + s.cut.otMin + s.cut.nightMin + s.cut.holidayMin, 0, 'none で削っている');
    }
  });
});

/* ── self-test：わざと壊して赤になるか ───────────────────────────── */
if (process.argv.includes('--self-test')) {
  console.log('\n[tc-round --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('① 切り捨て分を捨てる作り物は 保存則が崩れる（本物は崩れない）', () => {
    const s = run(dayOf('2026-08-03', 489), 'daily30');
    const broken = { raw: s.raw, month: s.month, cut: Object.assign({}, s.cut, { workedMin: 0 }) };
    let threw = false;
    try { conserved(broken); } catch (_) { threw = true; }
    if (!threw) throw new Error('作り物が崩れていない＝この検査が空振り');
    conserved(s);   // ★本物は通る★
  });
  S('② 「30分以上も切り捨てる」に壊すと 30分ちょうどで答えが変わる（本物は切上）', () => {
    const wrong = (m) => m - (m % 60);
    eq(wrong(30), 0, '作り物が間違っていない＝この検査が空振り');
    eq(LAW.roundMonthFraction(30), 60, '★本物が30分ちょうどで切り捨てている★');
  });
  S('③ 「month で実労働も丸める」に壊すと実労働が動く（本物は動かない）', () => {
    const s = run(dayOf('2026-08-03', 489), 'month');
    eq(s.month.workedMin, 489, '★本物が実労働を丸めている★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
