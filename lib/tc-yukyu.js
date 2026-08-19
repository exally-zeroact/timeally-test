/* tc-yukyu.js — ★年次有給休暇の法定の数だけを置く場所★（Timeally）
 * =============================================================================
 * なぜ tc-law.js と分けたのか（2026-08-19）:
 *   ★従業員の画面に「残り◯日」を1行だけ出す★事になった（指示役 2026-08-19 ⑤）。
 *   けれど tc-law.js は ★率・丸め・割増・金額の言葉★を持っていて、
 *   ★従業員の画面からは1本も読ませない★決まり（司さん 2026-08-14／
 *   tests/employee-screen.test.mjs の②が見張っている）。
 *   ⇒ ★見張りを緩めずに済ませる★ため、★有給の数だけ★を この1本に分けた。
 *     ★正本はここ1本きり★。tc-law.js は そのまま渡すだけ（同じ数を2か所に書かない）。
 *
 * ★ここも「公式の一次情報で自分の目で確かめた数」だけ★（出典URLと確認日を必ず付ける）
 *
 * ★この1本は 長さ（分・時間）を1つも数えない★
 *   数えるのは ★日数★だけ＝従業員の画面から読み込んでよい（率も金額も入っていない）。
 *
 * ★時刻は壁時計の文字列 'YYYY-MM-DD'★。Date.now()/new Date() を書かない
 *   （試験を走らせた日で答えが変わる物を混ぜない＝today は呼ぶ側が渡す）。
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.TcYukyu = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

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
  /* 10日以上 付いた人が 年5日の対象 */
  var YUKYU_MUST_TAKE_FROM_DAYS = 10;

  /* ── ★基準日・繰越・時効★（確認日 2026-08-19・一次情報を読んで数を入れた） ─────
     出典1: 厚生労働省「年次有給休暇に関するQ&A」
       https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/faq/kijyunhou_6_00001.html
       原文の表 … 6か月→10労働日／1年6か月→11／2年6か月→12／3年6か月→14／
                  4年6か月→16／5年6か月→18／★6年6か月以上→20★
       原文 …「雇い入れの日から６か月経過していること」
              「最初に年次有給休暇が付与された日から１年を経過した日に」再び付与
              ⇒★基準日＝入社日の6か月後。その後は1年ごと★
     出典2: 厚生労働省「確かめよう労働条件 年次有給休暇」
       https://www.check-roudou.mhlw.go.jp/study/roudousya_yukyu.html
       原文 …「労基法第115条に基づき２年の消滅時効にかかると解されており、
              年休発生日から2年間は行使可能」
              「年度経過後における年次有給休暇の権利は消滅しません」
              「１０日以上の年次有給休暇が付与される全ての労働者を対象に、
               その基準日から１年以内に５日以上の年休付与義務」
       ⇒★時効2年＝繰り越せるのは 前の1年ぶんだけ（それより前は消える）★
     ★ここに書いた数は 説明文に直書きしない★（画面はこの値から作る） */
  var YUKYU_FIRST_AFTER_MONTHS = 6;  // 基準日＝入社日の6か月後
  var YUKYU_PERIOD_MONTHS = 12;      // 以後 1年ごと
  var YUKYU_EXPIRE_YEARS = 2;        // 時効2年（＝繰越は前年度ぶんまで）

  /* ── ★日付の道具★（lib の中では 今日を勝手に読まない＝呼ぶ側が today を渡す） ──── */
  function ymd(y, m, d) {  /* m は 1始まり。月末を越えたら その月の末日に寄せる */
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + Math.min(d, last)).slice(-2);
  }
  function addMonths(iso, n) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    var t = (y * 12 + (m - 1)) + n;
    return ymd(Math.floor(t / 12), (t % 12) + 1, d);
  }
  function monthsBetween(fromIso, toIso) {
    var a = +fromIso.slice(0, 4) * 12 + (+fromIso.slice(5, 7) - 1);
    var b = +toIso.slice(0, 4) * 12 + (+toIso.slice(5, 7) - 1);
    var n = b - a;
    if (+toIso.slice(8, 10) < +fromIso.slice(8, 10)) n -= 1;  // 日で足りていない月は数えない
    return n;
  }

  /** ★その人の「今の1年（基準日〜）」★
   * @param {string} hireDate 'YYYY-MM-DD'（入社日）
   * @param {string} today    'YYYY-MM-DD'
   * @returns {object|null} { from, to, nth } … まだ1度も付与されていなければ null
   *   from … 基準日（この日から1年）／to … 次の基準日の前日／nth … 何回目の付与か（1始まり）
   */
  function yukyuPeriod(hireDate, today) {
    if (!hireDate || !today) return null;
    var first = addMonths(hireDate, YUKYU_FIRST_AFTER_MONTHS);
    if (today < first) return null;                     // ★入社半年未満★＝まだ付与されていない
    var n = Math.floor(monthsBetween(first, today) / YUKYU_PERIOD_MONTHS);
    var from = addMonths(first, n * YUKYU_PERIOD_MONTHS);
    var next = addMonths(from, YUKYU_PERIOD_MONTHS);
    var to = addMonths(next, 0);
    /* to は「次の基準日の前日」＝日付を1日戻す */
    var t = new Date(Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10) - 1));
    to = t.toISOString().slice(0, 10);
    return { from: from, to: to, nth: n + 1 };
  }

  /** ★有給の残り★（★倉庫に列を足さず、付けた日を数えるだけで出す★）
   *   残り ＝ 今の1年の付与 ＋ 繰越（前の1年の余り・★時効2年なので前の1年ぶんだけ★）− 今の1年に使った日数
   * @param {object} o { hireDate, today, takenDays:['YYYY-MM-DD'...] }
   * @returns {object} { ok, why, grantDays, carryDays, usedDays, leftDays, period, mustTake5 }
   *   ok=false … 数えられない（入社日が無い／まだ付与されていない）。why にその理由。
   */
  function yukyuLeft(o) {
    o = o || {};
    var taken = (o.takenDays || []).slice();
    if (!o.hireDate) {
      return { ok: false, why: '入社日が入っていません', grantDays: 0, carryDays: 0,
        usedDays: taken.length, leftDays: 0, period: null, mustTake5: false };
    }
    var p = yukyuPeriod(o.hireDate, o.today);
    if (!p) {
      return { ok: false, why: '入社から6か月たつまでは まだ付きません', grantDays: 0, carryDays: 0,
        usedDays: taken.length, leftDays: 0, period: null, mustTake5: false };
    }
    /* ★勤続月数は「何回目の付与か」から作る★（2026-08-19 境界の試験が捕まえた）
       ＝月末入社（8/31 → 基準日 2/28）で monthsBetween を使うと ★日が足りず5か月と数え、
         基準日に立っているのに 付与0日★になっていた。回数から作れば その穴が無い。 */
    var grant = yukyuGrantDays(YUKYU_FIRST_AFTER_MONTHS + (p.nth - 1) * YUKYU_PERIOD_MONTHS);
    var prevFrom = addMonths(p.from, -YUKYU_PERIOD_MONTHS);
    var used = taken.filter(function (d) { return d >= p.from && d <= p.to; }).length;
    /* ★繰越は 前の1年ぶんだけ★（時効2年）。前の1年が無い人（1回目）は 0。 */
    var carry = 0;
    if (p.nth > 1) {
      var prevGrant = yukyuGrantDays(YUKYU_FIRST_AFTER_MONTHS + (p.nth - 2) * YUKYU_PERIOD_MONTHS);
      var prevUsed = taken.filter(function (d) { return d >= prevFrom && d < p.from; }).length;
      carry = Math.max(0, prevGrant - prevUsed);
      if (carry > prevGrant) carry = prevGrant;
    }
    return {
      ok: true, why: '',
      grantDays: grant, carryDays: carry, usedDays: used,
      leftDays: Math.max(0, grant + carry - used),
      period: p, mustTake5: mustTake5(grant),
    };
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

  return {
    YUKYU_TABLE: YUKYU_TABLE,
    YUKYU_ATTEND_RATIO: YUKYU_ATTEND_RATIO,
    YUKYU_MUST_TAKE_DAYS: YUKYU_MUST_TAKE_DAYS,
    YUKYU_MUST_TAKE_FROM_DAYS: YUKYU_MUST_TAKE_FROM_DAYS,
    YUKYU_FIRST_AFTER_MONTHS: YUKYU_FIRST_AFTER_MONTHS,
    YUKYU_PERIOD_MONTHS: YUKYU_PERIOD_MONTHS,
    YUKYU_EXPIRE_YEARS: YUKYU_EXPIRE_YEARS,
    ymd: ymd, addMonths: addMonths, monthsBetween: monthsBetween,
    yukyuGrantDays: yukyuGrantDays,
    yukyuPeriod: yukyuPeriod,
    yukyuLeft: yukyuLeft,
    mustTake5: mustTake5,
  };
});
