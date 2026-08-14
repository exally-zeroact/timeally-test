/* tc-law.js — ★法定の数値だけを置く唯一の場所★（Timeally）
 * =============================================================================
 * なぜ1か所に集めるのか:
 *   率や日数を画面の説明文に書くと、計算を直しても ★文だけが年度で取り残される★。
 *   （前科: 給与アプリ。だから「法定の率を説明文に直書きするな」が全アプリの決まり）
 *   ⇒ 画面は必ずこの表から読む。tests/no-hardcoded-statutory.test.mjs が破りを赤にする。
 *
 * ★ここに書いてよいのは「公式の一次情報で自分の目で確かめた数」だけ★
 *   すべての値に ★出典URL★ と ★確認日★ を付ける。付いていない値は置かない。
 *   確認日: 2026-08-14（このファイルを作った日に、下のURLを1本ずつ開いて確かめた）
 *
 * ★この表は「見せ方」を決めない★
 *   丸め方(none/month/daily30)は会社が選ぶ設定であって法定値ではないので tc_companies にある。
 *   ただし ★month の端数処理の中身（30分）★ は通達の数なのでここに置く。
 *
 * 【利用】ブラウザ window.TcLaw / Node require('./tc-law.js')
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.TcLaw = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── 労働時間の原則（労基法32条） ────────────────────────────────
     出典: 厚生労働省「確かめよう労働条件」労働時間の基本的ルール
           https://www.check-roudou.mhlw.go.jp/qa/roudousya/roudoujikan/q4.html
     「1日8時間、週40時間が原則」／特例事業(常時10人未満の商業・映画演劇業・保健衛生業・
       接客娯楽業)は週44時間。★Timeally は既定40時間。44時間は会社情報で選ぶ★ */
  var DAY_LEGAL_MIN = 8 * 60;          // 480 … 1日の法定労働時間
  var WEEK_LEGAL_MIN = 40 * 60;        // 2400 … 1週の法定労働時間
  var WEEK_LEGAL_MIN_TOKUREI = 44 * 60; // 2640 … 特例事業

  /* ── 休憩（労基法34条） ──────────────────────────────────────
     出典: 厚生労働省 FAQ「休憩時間は法律で決まっていますか。」
           https://www.mhlw.go.jp/bunya/roudoukijun/faq_kijyunhou_13.html
     　　　栃木労働局 休憩（第34条）
           https://jsite.mhlw.go.jp/tochigi-roudoukyoku/hourei_seido_tetsuzuki/roudoukijun_keiyaku/roukijou/roukihou_point/kijunhou_kaisetsu/article34.html
     ★「6時間を超える」＝6時間ちょうどは不要／「8時間を超える」＝8時間ちょうどは45分でよい★
     この「超える」を「以上」と読み違えるのが定番の事故なので、境界を tests に埋めてある。 */
  var BREAK_RULES = [
    { overMin: 8 * 60, needMin: 60 },   // 8時間を「超える」なら60分以上
    { overMin: 6 * 60, needMin: 45 },   // 6時間を「超える」なら45分以上
  ];

  /* ── 割増賃金（労基法37条・割増賃金令） ──────────────────────
     出典: 群馬労働局「時間外及び休日の労働、時間外・休日及び深夜の割増賃金について」
           https://jsite.mhlw.go.jp/gunma-roudoukyoku/hourei_seido_tetsuzuki/roudoukijun_keiyaku/jyouken03_3.html
       時間外 … 2割5分以上 ／ 法定休日 … 3割5分以上 ／ 深夜 … 2割5分以上
       深夜の時間帯 … 午後10時〜午前5時
     月60時間超 50%以上・★中小企業は2023(令和5)年4月1日から適用★
     出典: 厚生労働省リーフレット
           https://www.mhlw.go.jp/content/000930914.pdf
           https://jsite.mhlw.go.jp/aomori-roudoukyoku/newpage_00901.html
     ★率は「以上」＝会社がこれより高く払うのは自由★。だから下限としてだけ使う。 */
  var RATE = {
    ot: 0.25,          // 法定時間外
    ot60: 0.50,        // 1か月60時間を超える法定時間外
    night: 0.25,       // 深夜（加算）
    holiday: 0.35,     // 法定休日
  };
  var OT60_THRESHOLD_MIN = 60 * 60;      // 3600分 … 月60時間
  var OT60_SME_FROM = '2023-04-01';      // 中小企業への適用開始日
  var NIGHT_START_MIN = 22 * 60;         // 1320 … 午後10時
  var NIGHT_END_MIN = 5 * 60;            // 300  … 午前5時

  /* ── 時間外労働の上限（36協定・労基法36条） ──────────────────
     出典: 厚生労働省「働き方改革特設サイト 時間外労働の上限規制」
           https://hatarakikatakaikaku.mhlw.go.jp/overtime.html
           https://www.mhlw.go.jp/content/001140962.pdf
     原則 月45時間・年360時間。特別条項でも
       年720時間 ／ 単月100時間未満(休日労働含む) ／ 複数月平均80時間以内(休日労働含む)
       月45時間を超えてよいのは年6か月まで
     ★「100時間未満」は未満＝100時間ちょうどで既に違反★。境界を tests に埋めてある。 */
  var LIMIT = {
    monthMin: 45 * 60,            // 2700 … 原則の月上限
    yearMin: 360 * 60,            // 21600 … 原則の年上限
    specialYearMin: 720 * 60,     // 43200 … 特別条項の年上限
    singleMonthUnderMin: 100 * 60, // 6000 … 単月はこれ「未満」（休日労働含む）
    multiMonthAvgMin: 80 * 60,    // 4800 … 複数月平均の上限（休日労働含む）
    overMonthsPerYear: 6,         // 月45時間を超えてよい回数／年
    avgWindows: [2, 3, 4, 5, 6],  // 「複数月平均」は2〜6か月平均すべてが対象
  };

  /* ── 年次有給休暇（労基法39条） ──────────────────────────────
     出典: 厚生労働省「確かめよう労働条件 年次有給休暇」
           https://www.check-roudou.mhlw.go.jp/study/roudousya_yukyu.html
           https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/dl/140811-3.pdf
     6か月継続勤務＋全労働日の8割以上出勤で10労働日。以後 表のとおり。
     ★年5日の時季指定義務（法定付与が10日以上の人・平成31年4月〜）★
     出典: https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/faq/kijyunhou_6_00001.html */
  var YUKYU_TABLE = [
    { afterMonths: 6, days: 10 },
    { afterMonths: 18, days: 11 },
    { afterMonths: 30, days: 12 },
    { afterMonths: 42, days: 14 },
    { afterMonths: 54, days: 16 },
    { afterMonths: 66, days: 18 },
    { afterMonths: 78, days: 20 },   // 6年6か月以降は毎年20日
  ];
  var YUKYU_ATTEND_RATIO = 0.8;      // 全労働日の8割以上出勤
  var YUKYU_MUST_TAKE_DAYS = 5;      // 年5日
  var YUKYU_MUST_TAKE_FROM_DAYS = 10; // 法定付与が10日以上の人が対象

  /* ── 賃金計算の端数（昭和63.3.14 基発150号） ──────────────────
     出典: 愛知労働局「賃金計算の端数の取扱い（昭和63年3月14日 基発第150号より）」
           https://jsite.mhlw.go.jp/aichi-roudoukyoku/content/contents/001856612.pdf
     ★1か月における 時間外労働・休日労働・深夜労働の【各々の】時間数の合計に
       1時間未満の端数がある場合に限り、30分未満を切り捨て、30分以上を1時間に切り上げる★
     　（常に労働者に不利ではなく事務簡便のため＝24条・37条違反として取り扱わない）
     ★これは「1か月の合計」の話。★日ごとの切り捨ては この通達では認められていない★ */
  var MONTH_FRACTION_UNIT_MIN = 60;  // 1時間
  var MONTH_FRACTION_HALF_MIN = 30;  // 30分未満は切捨・30分以上は切上

  /* ── 記録の保存（労基法109条・附則143条） ────────────────────
     出典: 厚生労働省「改正労働基準法等に関するQ&A（令和2年4月1日）」
           https://www.mhlw.go.jp/content/000617980.pdf
           https://www.mhlw.go.jp/content/000617994.pdf（基発0401第27号）
     出勤簿は法定三帳簿の1つ。保存は5年（★当分の間3年★）。
     ★客観的な記録による把握（労働時間の適正な把握のためのガイドライン／労安衛法66条の8の3）★
     出典: https://jsite.mhlw.go.jp/tokyo-roudoukyoku/content/contents/001286641.pdf */
  var KEEP_YEARS = 5;
  var KEEP_YEARS_FOR_NOW = 3;

  /* ── 使う側の道具（数を画面に書かせない） ───────────────────── */

  /** その日の実労働に対して法が求める休憩の最低分数。★「超える」で判定★ */
  function requiredBreakMin(workMinIncludingBreak) {
    var m = Number(workMinIncludingBreak) || 0;
    for (var i = 0; i < BREAK_RULES.length; i++) {
      if (m > BREAK_RULES[i].overMin) return BREAK_RULES[i].needMin;
    }
    return 0;
  }

  /** 勤続月数から その年の法定付与日数。6か月未満は0。 */
  function yukyuGrantDays(monthsWorked) {
    var m = Number(monthsWorked) || 0;
    var days = 0;
    for (var i = 0; i < YUKYU_TABLE.length; i++) {
      if (m >= YUKYU_TABLE[i].afterMonths) days = YUKYU_TABLE[i].days;
    }
    return days;
  }

  /** 年5日の時季指定義務の対象か（法定付与10日以上） */
  function mustTake5(grantDays) {
    return (Number(grantDays) || 0) >= YUKYU_MUST_TAKE_FROM_DAYS;
  }

  /** 1か月の合計に対する端数処理（基発150号）。★分を返す★ */
  function roundMonthFraction(min) {
    var m = Math.round(Number(min) || 0);
    var r = m % MONTH_FRACTION_UNIT_MIN;
    if (r === 0) return m;
    return r < MONTH_FRACTION_HALF_MIN ? m - r : m + (MONTH_FRACTION_UNIT_MIN - r);
  }

  return {
    DAY_LEGAL_MIN: DAY_LEGAL_MIN,
    WEEK_LEGAL_MIN: WEEK_LEGAL_MIN,
    WEEK_LEGAL_MIN_TOKUREI: WEEK_LEGAL_MIN_TOKUREI,
    BREAK_RULES: BREAK_RULES,
    RATE: RATE,
    OT60_THRESHOLD_MIN: OT60_THRESHOLD_MIN,
    OT60_SME_FROM: OT60_SME_FROM,
    NIGHT_START_MIN: NIGHT_START_MIN,
    NIGHT_END_MIN: NIGHT_END_MIN,
    LIMIT: LIMIT,
    YUKYU_TABLE: YUKYU_TABLE,
    YUKYU_ATTEND_RATIO: YUKYU_ATTEND_RATIO,
    YUKYU_MUST_TAKE_DAYS: YUKYU_MUST_TAKE_DAYS,
    YUKYU_MUST_TAKE_FROM_DAYS: YUKYU_MUST_TAKE_FROM_DAYS,
    MONTH_FRACTION_UNIT_MIN: MONTH_FRACTION_UNIT_MIN,
    MONTH_FRACTION_HALF_MIN: MONTH_FRACTION_HALF_MIN,
    KEEP_YEARS: KEEP_YEARS,
    KEEP_YEARS_FOR_NOW: KEEP_YEARS_FOR_NOW,
    requiredBreakMin: requiredBreakMin,
    yukyuGrantDays: yukyuGrantDays,
    mustTake5: mustTake5,
    roundMonthFraction: roundMonthFraction,
  };
});
