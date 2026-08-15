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
  /** ★これ以下の拘束なら 休憩は要らない（6時間ちょうどは要らない）★
      会社の既定を引く／引かないの境目にも これを使う（★同じ線を2か所に書かない★）。 */
  var BREAK_FREE_MAX_MIN = 6 * 60;

  /** ★会社の「休憩の既定」が 法律で必要な分を下回っていないか★（2026-08-15）
      ＝1日の所定どおり働いた日（拘束＝所定＋休憩）で見る。
      ★黙って引き上げない★＝ここは「言うだけ」。数字は会社が入れた物のまま使う。
      @returns {{short:boolean, need:number, spanMin:number}} */
  function breakDefaultCheck(dailyStdMin, breakDefaultMin) {
    var std = Number(dailyStdMin) || 0;
    var brk = Number(breakDefaultMin) || 0;
    var span = std + brk;
    var need = requiredBreakMin(span);
    return { short: brk < need, need: need, spanMin: span };
  }

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

  /* ── 休日（労基法35条） ──────────────────────────────────────
     出典: 栃木労働局「休日（第35条）」（確認日 2026-08-15）
       https://jsite.mhlw.go.jp/tochigi-roudoukyoku/hourei_seido_tetsuzuki/roudoukijun_keiyaku/roukijou/roukihou_point/kijunhou_kaisetsu/article35.html
     ★毎週少なくとも1日★ の休日、★または 4週間を通じて4日以上★ の休日。
     ・4週4日を使うなら ★就業規則等で4週間の起算日を明らかにする★
     ・★法定休日を特定する義務は無い★（明確にするのが望ましい、まで）
       ⇒ 決めていない会社に ★アプリが勝手に曜日を決めない★（既定は「決めていない」）
     ・★祝日は法定休日ではない★（会社が決める所定休日）
     ★焼き込まない事★: 「特定なし＝後順の休日が法定休日」という扱いは
       ★一次情報で裏が取れていないので 計算に入れない★ */
  var WEEKLY_HOLIDAY_DAYS = 1;      // 毎週 少なくとも1日
  var CYCLE_WEEKS = 4;              // 4週間を通じて
  var CYCLE_HOLIDAY_DAYS = 4;       // 4日以上
  /* 法定休日の決め方（会社が選ぶ） */
  var HOLIDAY_MODES = ['none', 'dow', 'per_person', 'w4d4'];

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

  /* ── ★1日ごとの切り捨ては労働基準法違反★（確認日 2026-08-14） ──────
     出典: 静岡労働局「労働時間を適正に把握し正しく賃金を支払いましょう」
       https://jsite.mhlw.go.jp/shizuoka-roudoukyoku/roudoukyoku/roudou/kantoku/newpage_00977.html
       原文「1日ごとに、一定期間に満たない労働時間を一律に切り捨て、
             その分の賃金を支払わないことは、労働基準法違反となります。」
       違反の例として ★1日の時間外の15分未満を一律に切り捨て（丸め処理）★
                     ★残業申請を30分単位にして30分未満を申請させない★ が挙がっている。
     出典: 鹿児島労働局 時間外労働・休日労働・深夜労働 Q10
       https://jsite.mhlw.go.jp/kagoshima-roudoukyoku/yokuaru_goshitsumon/kyushokuchu/0310.html
       原文「1か月における時間外労働、休日労働および深夜業のおのおのの時間数の合計に
             1時間未満の端数がある場合に、30分未満の端数を切り捨て、
             それ以上を1時間に切り上げること」＝★これだけが認められている★

     ★大事な所★
       ・認められるのは ★1か月の合計★ に対してだけ（★日ごとは不可★）
       ・★「切り捨て」と「切り上げ」がセット★。★切り捨てだけ★は通達の範囲外
       ・単位は ★1時間（端数の分かれ目は30分）★。15分・30分単位は通達の形ではない
       ・★労働者に不利にならない側（切り上げ）は問題にならない★（多く払う分には自由） */

  /** 丸めの設定が法律の線の内か外か。★止める為ではなく、黙って選ばせない為★
   * @param {object} r { unitMin, dir:'floor'|'ceil'|'round', scope:'day'|'month' }
   * @returns {object} { ok, code }
   *   'no_round'      … 丸めていない（1分単位）
   *   'legal_month'   … 通達そのもの（1か月の合計・1時間未満の端数・30分で分ける）
   *   'favorable'     … 切り上げだけ＝労働者に不利にならない
   *   'day_cut'       … ★日ごとに削る＝労基法違反の扱い★
   *   'month_other'   … 1か月だが通達の形と違う（切り捨てだけ／単位が1時間でない）
   */
  function roundingLegality(r) {
    r = r || {};
    var unit = Number(r.unitMin) || 1;
    var dir = r.dir || 'floor';
    var scope = r.scope === 'month' ? 'month' : 'day';
    if (unit <= 1) return { ok: true, code: 'no_round' };
    if (dir === 'ceil') return { ok: true, code: 'favorable' };
    if (scope === 'day') return { ok: false, code: 'day_cut' };
    if (unit === MONTH_FRACTION_UNIT_MIN && dir === 'round') return { ok: true, code: 'legal_month' };
    return { ok: false, code: 'month_other' };
  }

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
    BREAK_FREE_MAX_MIN: BREAK_FREE_MAX_MIN,
    RATE: RATE,
    OT60_THRESHOLD_MIN: OT60_THRESHOLD_MIN,
    OT60_SME_FROM: OT60_SME_FROM,
    NIGHT_START_MIN: NIGHT_START_MIN,
    NIGHT_END_MIN: NIGHT_END_MIN,
    LIMIT: LIMIT,
    WEEKLY_HOLIDAY_DAYS: WEEKLY_HOLIDAY_DAYS,
    CYCLE_WEEKS: CYCLE_WEEKS,
    CYCLE_HOLIDAY_DAYS: CYCLE_HOLIDAY_DAYS,
    HOLIDAY_MODES: HOLIDAY_MODES,
    /** 割増の合計率（★重なった時は足す★）。数は RATE から作る＝説明文に書かない */
    rateOf: function (kind) {
      if (kind === 'ot') return RATE.ot;
      if (kind === 'ot60') return RATE.ot60;
      if (kind === 'holiday') return RATE.holiday;
      if (kind === 'night') return RATE.night;
      if (kind === 'ot_night') return RATE.ot + RATE.night;          // 時間外＋深夜
      if (kind === 'ot60_night') return RATE.ot60 + RATE.night;      // 60超＋深夜
      if (kind === 'holiday_night') return RATE.holiday + RATE.night; // 休日＋深夜
      return 0;
    },
    YUKYU_TABLE: YUKYU_TABLE,
    YUKYU_ATTEND_RATIO: YUKYU_ATTEND_RATIO,
    YUKYU_MUST_TAKE_DAYS: YUKYU_MUST_TAKE_DAYS,
    YUKYU_MUST_TAKE_FROM_DAYS: YUKYU_MUST_TAKE_FROM_DAYS,
    MONTH_FRACTION_UNIT_MIN: MONTH_FRACTION_UNIT_MIN,
    MONTH_FRACTION_HALF_MIN: MONTH_FRACTION_HALF_MIN,
    KEEP_YEARS: KEEP_YEARS,
    KEEP_YEARS_FOR_NOW: KEEP_YEARS_FOR_NOW,
    roundingLegality: roundingLegality,
    ROUND_UNITS: [1, 5, 10, 15, 30],   // 選べる単位（分）
    ROUND_DIRS: ['floor', 'ceil', 'round'],
    ROUND_SCOPES: ['day', 'month'],
    requiredBreakMin: requiredBreakMin,
    breakDefaultCheck: breakDefaultCheck,
    yukyuGrantDays: yukyuGrantDays,
    mustTake5: mustTake5,
    roundMonthFraction: roundMonthFraction,
  };
});
