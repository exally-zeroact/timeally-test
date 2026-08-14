/* tc-law.test.mjs — ★法定の数値を実数で固める★（Timeally）
 * =============================================================================
 * ★公式の一次情報で確かめた数だけを、実数リテラルで書き留める★
 *   （lib/tc-law.js の定数を「そのまま比べる」だけでは意味が無いので、
 *     ★この検査には lib の名前ではなく 生の数字を書く★。lib を書き換えたら赤くなる。）
 *
 * 確認日 2026-08-14 に開いた一次情報:
 *   労働時間の原則   https://www.check-roudou.mhlw.go.jp/qa/roudousya/roudoujikan/q4.html
 *   休憩(34条)       https://www.mhlw.go.jp/bunya/roudoukijun/faq_kijyunhou_13.html
 *   割増(37条)・深夜 https://jsite.mhlw.go.jp/gunma-roudoukyoku/hourei_seido_tetsuzuki/roudoukijun_keiyaku/jyouken03_3.html
 *   60時間超50%      https://www.mhlw.go.jp/content/000930914.pdf
 *   36協定の上限     https://hatarakikatakaikaku.mhlw.go.jp/overtime.html
 *   有給(39条)       https://www.check-roudou.mhlw.go.jp/study/roudousya_yukyu.html
 *   年5日            https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/faq/kijyunhou_6_00001.html
 *   端数(基発150号)  https://jsite.mhlw.go.jp/aichi-roudoukyoku/content/contents/001856612.pdf
 *   記録の保存(109条) https://www.mhlw.go.jp/content/000617980.pdf
 *
 * 使い方: node tests/tc-law.test.mjs
 *         node tests/tc-law.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const LAW = require_(path.join(ROOT, 'lib/tc-law.js'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

console.log('\n[tc-law] 法定の数値（公式一次情報・実数）');

T('労働時間の原則 1日8時間・週40時間（特例事業は週44時間）', () => {
  eq(LAW.DAY_LEGAL_MIN, 480);
  eq(LAW.WEEK_LEGAL_MIN, 2400);
  eq(LAW.WEEK_LEGAL_MIN_TOKUREI, 2640);
});

T('★休憩（34条）6時間を「超える」45分／8時間を「超える」1時間', () => {
  eq(LAW.requiredBreakMin(0), 0);
  eq(LAW.requiredBreakMin(360), 0, '6時間ちょうど');
  eq(LAW.requiredBreakMin(361), 45);
  eq(LAW.requiredBreakMin(480), 45, '8時間ちょうど');
  eq(LAW.requiredBreakMin(481), 60);
  eq(LAW.requiredBreakMin(1000), 60);
});

T('★割増（37条）時間外2割5分・深夜2割5分・法定休日3割5分・月60時間超5割', () => {
  eq(LAW.RATE.ot, 0.25);
  eq(LAW.RATE.night, 0.25);
  eq(LAW.RATE.holiday, 0.35);
  eq(LAW.RATE.ot60, 0.50);
  eq(LAW.OT60_THRESHOLD_MIN, 3600, '月60時間 = 3600分');
  eq(LAW.OT60_SME_FROM, '2023-04-01', '中小企業への適用開始');
});

T('★深夜は午後10時〜午前5時', () => {
  eq(LAW.NIGHT_START_MIN, 1320, '22:00');
  eq(LAW.NIGHT_END_MIN, 300, '05:00');
});

T('★36協定 月45時間・年360時間／特別条項 年720時間・単月100時間「未満」・複数月平均80時間・年6回', () => {
  eq(LAW.LIMIT.monthMin, 2700);
  eq(LAW.LIMIT.yearMin, 21600);
  eq(LAW.LIMIT.specialYearMin, 43200);
  eq(LAW.LIMIT.singleMonthUnderMin, 6000);
  eq(LAW.LIMIT.multiMonthAvgMin, 4800);
  eq(LAW.LIMIT.overMonthsPerYear, 6);
  eq(LAW.LIMIT.avgWindows.join(','), '2,3,4,5,6', '★2〜6か月平均が全部 対象★');
});

T('★有給（39条）6か月10日 → 6年6か月以降20日（表のとおり）', () => {
  eq(LAW.yukyuGrantDays(5), 0, '6か月未満は付かない');
  eq(LAW.yukyuGrantDays(6), 10);
  eq(LAW.yukyuGrantDays(17), 10, '1年6か月の手前');
  eq(LAW.yukyuGrantDays(18), 11);
  eq(LAW.yukyuGrantDays(30), 12);
  eq(LAW.yukyuGrantDays(42), 14);
  eq(LAW.yukyuGrantDays(54), 16);
  eq(LAW.yukyuGrantDays(66), 18);
  eq(LAW.yukyuGrantDays(78), 20);
  eq(LAW.yukyuGrantDays(200), 20, '6年6か月以降は毎年20日');
  eq(LAW.YUKYU_ATTEND_RATIO, 0.8, '全労働日の8割以上出勤');
});

T('★年5日の時季指定義務は「法定付与10日以上」の人', () => {
  eq(LAW.YUKYU_MUST_TAKE_DAYS, 5);
  eq(LAW.mustTake5(9), false, '9日の人は対象外');
  eq(LAW.mustTake5(10), true, '10日ちょうどから対象');
  eq(LAW.mustTake5(20), true);
});

T('★端数（基発150号）1時間未満の端数だけ・30分未満切捨/30分以上切上', () => {
  eq(LAW.roundMonthFraction(0), 0);
  eq(LAW.roundMonthFraction(29), 0);
  eq(LAW.roundMonthFraction(30), 60);
  eq(LAW.roundMonthFraction(59), 60);
  eq(LAW.roundMonthFraction(60), 60);
  eq(LAW.roundMonthFraction(61), 60, '1時間1分は端数1分＝切捨');
  eq(LAW.roundMonthFraction(89), 60);
  eq(LAW.roundMonthFraction(90), 120);
  eq(LAW.roundMonthFraction(2700 + 30), 2760);
});

T('記録の保存 5年（当分の間3年）', () => {
  eq(LAW.KEEP_YEARS, 5);
  eq(LAW.KEEP_YEARS_FOR_NOW, 3);
});

/* ── 出典が付いているか（数だけ置いて出どころが無い物を作らない） ── */
T('★lib/tc-law.js に 出典URL と 確認日 が書いてある', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/tc-law.js'), 'utf8');
  ok(/確認日:\s*2026-\d{2}-\d{2}/.test(src), '確認日が無い');
  const urls = src.match(/https?:\/\/[^\s*]+/g) || [];
  const gov = urls.filter((u) => /mhlw\.go\.jp|e-gov\.go\.jp/.test(u));
  ok(gov.length >= 8, '公式の出典が少なすぎる: ' + gov.length + '件');
  console.log('     実測: 公式の出典 ' + gov.length + '件');
});

/* ── self-test：わざと壊して赤になるか ───────────────────────────── */
if (process.argv.includes('--self-test')) {
  console.log('\n[tc-law --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('①「超える」を「以上」にした作り物は 6時間ちょうどで45分（本物は0）', () => {
    const wrong = (m) => (m >= 480 ? 60 : m >= 360 ? 45 : 0);
    eq(wrong(360), 45, '作り物が間違っていない＝この検査が空振り');
    eq(LAW.requiredBreakMin(360), 0, '★本物が間違っている★');
  });
  S('②「100時間以下」にした作り物は 100時間ちょうどを許す（本物は未満）', () => {
    const wrongOk = (m) => m <= 6000;
    eq(wrongOk(6000), true, '作り物が間違っていない＝この検査が空振り');
    eq(LAW.LIMIT.singleMonthUnderMin, 6000, '★本物の値が動いた★');
  });
  S('③ 有給を「1年ごとに1日ずつ」にした作り物は 3年6か月で13日（本物は14日）', () => {
    const wrong = (m) => (m < 6 ? 0 : Math.min(20, 10 + Math.floor((m - 6) / 12)));
    eq(wrong(42), 13, '作り物が間違っていない＝この検査が空振り');
    eq(LAW.yukyuGrantDays(42), 14, '★本物が表からズレている★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
