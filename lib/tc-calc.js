/* tc-calc.js — ★打刻の生データを潰す関数は これ1本だけ★（Timeally）
 * =============================================================================
 * なぜ1本なのか:
 *   同じ物を2か所で潰すと ★必ず数字が食い違う★（前科: 「全員確認済」と「2名が未確認」が
 *   同時に出た件／同じ本数を2通りで数えて 17.8% と 14.2% が並んだ件）。
 *   ⇒ 画面・印刷・CSV・警告 の全部が この1本の返り値だけを見る。
 *
 * ★守る順番（法律）★
 *   ① 打刻の生データ(tc_punch)は 1分単位。★丸めない・上書きしない・消さない★
 *      労働時間は1分単位が原則（労基法24条 賃金全額払い）。★日ごとの切り捨ては違法★。
 *   ② 会社が選べるのは「見せ方」だけ:
 *        none    … 何もしない（既定・適法）
 *        month   … 1か月合計の端数だけ（昭和63.3.14 基発150号・適法）
 *        daily30 … 日ごと30分切り下げ（★客の希望。適法ではない★）
 *      daily30 のときは ★切り捨てた時間と金額を必ず別に持って返す★
 *      （他社は丸めて終わり。うちは「丸めた分がいくらか」を出せる）
 *   ③ ★この返り値は社長側にしか出さない★。従業員の画面に出るのは 自分が打った生の時刻だけ。
 *      （tests/employee-screen.test.mjs が、従業員の画面に計算の言葉が出ていないか機械で数える）
 *
 * ★時刻の持ち方★
 *   このライブラリは ★壁時計の文字列 'YYYY-MM-DDTHH:mm'（JST）★ しか受け取らない。
 *   タイムゾーンの変換は js/tc-db.js が1か所でやる。ここに Date.now()/new Date() は書かない
 *   （試験が動かした日で答えが変わる物を混ぜない＝毎回同じ答えになる）。
 *
 * 【利用】ブラウザ window.TcCalc / Node require('./tc-calc.js')
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./tc-law.js'));
  } else {
    root.TcCalc = factory(root.TcLaw);
  }
})(typeof self !== 'undefined' ? self : this, function (LAW) {
  'use strict';

  var DAY = 1440;

  /* ── 時刻の道具（壁時計・タイムゾーンに触らない） ───────────────── */

  /** 'YYYY-MM-DDTHH:mm' → 1970-01-01T00:00 からの分。★UTCで組み立てるので実行環境の時差で動かない★ */
  function toMin(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
  }
  /** 分 → 'YYYY-MM-DDTHH:mm' */
  function toStr(min) {
    var d = new Date(min * 60000);
    return d.toISOString().slice(0, 16);
  }
  /** 'YYYY-MM-DD' → その日の0:00の分 */
  function dayMin(ymd) { return toMin(ymd + 'T00:00'); }
  /** 分 → 'YYYY-MM-DD' */
  function dayOf(min) { return toStr(Math.floor(min / DAY) * DAY).slice(0, 10); }
  /** 'YYYY-MM-DD' の曜日（0=日） */
  function dowOf(ymd) { return new Date(dayMin(ymd) * 60000).getUTCDay(); }
  /** その月の日数 */
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  /** 日付を n 日進める */
  function addDays(ymd, n) { return dayOf(dayMin(ymd) + n * DAY); }
  /** 'HH:mm' → 分（0:00からの） */
  function hmToMin(hm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || ''));
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }

  /* ── 締め期間（会社情報の締め日から決める） ─────────────────────
     closeDay = 31 は「末日締め」。それ以外は 前月(closeDay+1) 〜 当月(closeDay)。
     2月30日のような日は その月の末日に丸める（存在しない日で穴を開けない）。 */
  function period(ym, closeDay) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var cd = Number(closeDay) || 31;
    if (cd >= 31) {
      return { ym: ym, from: ym + '-01', to: ym + '-' + pad2(daysInMonth(y, m)) };
    }
    var pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
    var fromD = Math.min(cd + 1, daysInMonth(py, pm));
    var toD = Math.min(cd, daysInMonth(y, m));
    return {
      ym: ym,
      from: py + '-' + pad2(pm) + '-' + pad2(fromD),
      to: y + '-' + pad2(m) + '-' + pad2(toD),
    };
  }
  function pad2(n) { return ('0' + n).slice(-2); }

  /* ── 深夜（22:00〜翌5:00）が [s,e) と重なる分 ───────────────── */
  function nightOverlap(s, e) {
    if (!(e > s)) return 0;
    var total = 0;
    for (var d = Math.floor(s / DAY) - 1; d <= Math.floor(e / DAY); d++) {
      var ns = d * DAY + LAW.NIGHT_START_MIN;        // その日の22:00
      var ne = d * DAY + DAY + LAW.NIGHT_END_MIN;    // 翌日の5:00
      total += Math.max(0, Math.min(e, ne) - Math.max(s, ns));
    }
    return total;
  }

  /* ── ① 生データを日ごとに組み立てる ─────────────────────────
     kind = in | out | break_in | break_out | away_in | away_out
     ★away（私用外出＝中抜け）は 休憩と別に持つ★。混ぜると 休憩45分/60分 の判定が狂う。
     ★日をまたぐ勤務は「出勤した日」に付ける★（22:00〜翌6:00 は前の日の1日）。 */
  function sessions(punches) {
    var ps = (punches || []).slice().filter(function (p) { return toMin(p.at) != null; });
    ps.sort(function (a, b) { return toMin(a.at) - toMin(b.at) || String(a.kind).localeCompare(String(b.kind)); });

    var out = [], cur = null, stray = [];
    function close(endMin, endRaw) {
      if (!cur) return;
      cur.end = endMin;
      cur.endAt = endRaw;
      out.push(cur);
      cur = null;
    }
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], t = toMin(p.at);
      if (p.kind === 'in') {
        if (cur) { cur.incomplete = true; close(null, null); }   // 前の出勤が閉じていない
        cur = { start: t, startAt: p.at, end: null, endAt: null, breaks: [], aways: [], incomplete: false, src: p.src || 'punch' };
      } else if (p.kind === 'out') {
        if (!cur) { stray.push(p); continue; }                    // 出勤が無いのに退勤
        close(t, p.at);
      } else if (p.kind === 'break_in' || p.kind === 'away_in') {
        if (!cur) { stray.push(p); continue; }
        var arr = p.kind === 'break_in' ? cur.breaks : cur.aways;
        arr.push({ s: t, e: null });
      } else if (p.kind === 'break_out' || p.kind === 'away_out') {
        if (!cur) { stray.push(p); continue; }
        var arr2 = p.kind === 'break_out' ? cur.breaks : cur.aways;
        var last = arr2[arr2.length - 1];
        if (last && last.e == null) last.e = t; else stray.push(p);
      }
    }
    if (cur) { cur.incomplete = true; close(null, null); }
    return { list: out, stray: stray };
  }

  /** 1つの出勤を、終わりを endOverride まで切り詰めて数え直す（丸め用にも使う）。
   *  ★休憩・中抜けも同じ範囲で切る★ので、切った先が休憩の中でも正しく数えられる。 */
  function measure(sess, endOverride) {
    var s = sess.start;
    var e = endOverride != null ? endOverride : sess.end;
    if (e == null || !(e > s)) {
      return { workMin: 0, breakMin: 0, awayMin: 0, nightMin: 0, spanMin: 0, end: e };
    }
    /* 片方だけの休憩は数えない（打刻漏れとして別に警告する） */
    function clip(list) {
      var out = [];
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a.e == null) continue;
        var cs = Math.max(a.s, s), ce = Math.min(a.e, e);
        if (ce > cs) out.push({ s: cs, e: ce });
      }
      return out;
    }
    function sum(iv) { var t = 0; for (var i = 0; i < iv.length; i++) t += iv[i].e - iv[i].s; return t; }
    function nightSum(iv) { var t = 0; for (var i = 0; i < iv.length; i++) t += nightOverlap(iv[i].s, iv[i].e); return t; }
    /* ★重なりは1回だけ引く★
       休憩の途中で「私用外出」を打つ人が必ずいる。単純に足して引くと ★二重に引いて
       実労働が短くなる★（＝黙って合計が小さくなる。#ERROR より先に潰す種類の事故）。
       休憩と中抜けは【別々に】報告するが、引くのは【重ねてまとめた分】だけ。 */
    function union(iv) {
      var a = iv.slice().sort(function (x, y) { return x.s - y.s; }), out = [];
      for (var i = 0; i < a.length; i++) {
        var last = out[out.length - 1];
        if (last && a[i].s <= last.e) last.e = Math.max(last.e, a[i].e);
        else out.push({ s: a[i].s, e: a[i].e });
      }
      return out;
    }
    var b = clip(sess.breaks), a2 = clip(sess.aways);
    var u = union(b.concat(a2));
    var span = e - s;
    return {
      spanMin: span,
      breakMin: sum(b),
      awayMin: sum(a2),
      offMin: sum(u),                                     // ★実際に抜けていた分（重なりは1回）★
      workMin: Math.max(0, span - sum(u)),
      nightMin: Math.max(0, nightOverlap(s, e) - nightSum(u)),
      end: e,
    };
  }

  /** ★休憩を引く★（打刻ぶんの上書きではなく、引く分を差し替える）
      ・★拘束を超えて引かない★（実労働がマイナスにならない）
      ・★深夜は減らさない★（休憩がいつ取られたか分からないので 位置を決めつけない）。
        ただし ★深夜が実労働を超える事は起きない★ようにする（超えたら実労働に揃える）。 */
  function setBreak(d, wantMin) {
    var want = Math.max(0, Number(wantMin) || 0);
    var room = d.workMin + d.breakMin;              // 引ける上限（拘束から外出を除いた分）
    var applied = Math.min(want, room);
    d.workMin = Math.max(0, room - applied);
    d.rawWorkMin = d.workMin;                       // 丸めの「元」も 引いた後にする
    d.breakMin = applied;
    if (d.nightMin > d.workMin) d.nightMin = d.workMin;
    d.rawNightMin = d.nightMin;
  }

  /* ── ② 日ごとに分ける（所定内／所定超(割増なし)／法定外残業／深夜／休日） ──
     ★所定7時間の会社で7.5時間働いた30分は「割増が要らない残業」★。ここを混ぜない。
     法定休日の労働は ★全部 休日労働★（時間外には算入しない）。深夜は別立てで加算。 */
  function splitDay(m, isLegalHoliday, dailyStdMin) {
    var w = m.workMin;
    if (isLegalHoliday) {
      return { stdMin: 0, overStdMin: 0, dayOtMin: 0, holidayMin: w, nightMin: m.nightMin };
    }
    var std = Math.min(w, dailyStdMin);
    var overStd = Math.max(0, Math.min(w, LAW.DAY_LEGAL_MIN) - dailyStdMin);
    var ot = Math.max(0, w - Math.max(dailyStdMin, LAW.DAY_LEGAL_MIN));
    return { stdMin: std, overStdMin: overStd, dayOtMin: ot, holidayMin: 0, nightMin: m.nightMin };
  }

  /* ── 丸めの決め方（★1か所に集める★） ─────────────────────────
     none    … 1分単位（既定・適法）
     month   … ★通達そのもの★（1か月の合計・1時間未満の端数・30分で分ける／基発150号）
     daily30 … 日ごと30分切り下げ（古い設定。custom(30/floor/day) と同じ）
     custom  … 単位(1/5/10/15/30分)×向き(切捨/切上/四捨五入)×かける先(日ごと/1か月の合計)
     ★どれを選んでも 打った時刻(tc_punch)は1分単位のまま★。変わるのは見せ方だけ。 */
  var ROUND_MODES = ['none', 'month', 'daily30', 'custom'];

  function normalizeRound(o) {
    var mode = ROUND_MODES.indexOf(o.rounding) >= 0 ? o.rounding : 'none';
    if (mode === 'none') return { unitMin: 1, dir: 'floor', scope: 'day' };
    /* ★通達は「1時間未満の端数を30分で分ける」＝単位60分の四捨五入と同じ★
       （29分→0 / 30分→60 / 31分→60。LAW.roundMonthFraction と一致する事を検査で固定） */
    if (mode === 'month') return { unitMin: 60, dir: 'round', scope: 'month' };
    if (mode === 'daily30') return { unitMin: 30, dir: 'floor', scope: 'day' };
    return {
      unitMin: num(o.roundUnitMin, 1),
      dir: ['floor', 'ceil', 'round'].indexOf(o.roundDir) >= 0 ? o.roundDir : 'floor',
      scope: o.roundScope === 'month' ? 'month' : 'day',
    };
  }

  /* ── 法定休日の決め方（労基法35条） ─────────────────────────
     ★曜日で決まる形★（none / dow / per_person）は 日を並べた時点で決まる。
     ★4週4日制★は「働いた結果」で決まるので、日ごとの実労働が出てから後で決める。 */
  function fixedHolidayDow(o) {
    if (o.holidayMode === 'dow') return o.legalHolidayDow;
    if (o.holidayMode === 'per_person') {
      return o.personHolidayDow == null ? o.legalHolidayDow : o.personHolidayDow;
    }
    return -1;   // none / w4d4 は曜日では決まらない
  }

  /** ★4週4日制★：働いた事で「4週に4日」が確保できなくなった日から先の休日労働を法定休日労働にする。
   *  起算日から4週間ずつ区切り、日を順に見て
   *    その日を働いた後で「残り全部 休んでも4日に届かない」なら ★その日から先★ が法定休日労働。
   *  ★起算日が無いときは何もしない★（空のまま使わせない＝画面でも選べない） */
  function applyW4D4(days, o) {
    if (o.holidayMode !== 'w4d4' || !o.holidayCycleStart) return;
    var N = LAW.CYCLE_WEEKS * 7;
    var start = dayMin(o.holidayCycleStart);
    var byBlock = {};
    days.forEach(function (d) {
      var idx = Math.floor((dayMin(d.d) - start) / DAY);
      var block = Math.floor(idx / N);
      (byBlock[block] = byBlock[block] || []).push({ d: d, pos: ((idx % N) + N) % N });
    });
    Object.keys(byBlock).forEach(function (b) {
      var list = byBlock[b].sort(function (x, y) { return x.pos - y.pos; });
      var rest = 0, broken = false;
      list.forEach(function (x) {
        if (x.d.workMin <= 0) { rest++; return; }
        /* 今日 働いた。残りを全部 休んだとして 4日に届くか */
        var maxRest = rest + (N - 1 - x.pos);
        if (maxRest < LAW.CYCLE_HOLIDAY_DAYS) broken = true;
        if (broken) x.d.isLegalHoliday = true;
      });
    });
  }

  /** 単位に合わせる。dir=floor 切捨 / ceil 切上 / round 四捨五入（半分ちょうどは切上） */
  function adjust(min, unitMin, dir) {
    var u = Number(unitMin) || 1;
    if (u <= 1) return Math.round(min);
    var q = min / u;
    if (dir === 'ceil') return Math.ceil(q) * u;
    if (dir === 'round') return Math.round(q) * u;
    return Math.floor(q) * u;
  }

  /* ── 会社情報の既定 ───────────────────────────────────────── */
  function withDefaults(o) {
    o = o || {};
    return {
      dailyStdMin: num(o.dailyStdMin, LAW.DAY_LEGAL_MIN),
      weekLegalMin: num(o.weekLegalMin, LAW.WEEK_LEGAL_MIN),
      closeDay: num(o.closeDay, 31),
      rounding: ROUND_MODES.indexOf(o.rounding) >= 0 ? o.rounding : 'none',
      round: normalizeRound(o),
      /* ★法定休日の決め方（労基法35条：毎週1日 または 4週4日）★
         none       … 決めていない（★既定★）。特定する義務は無いので勝手に曜日を決めない
         dow        … 曜日で決める（会社ぜんぶ同じ）
         per_person … 従業員ごとに曜日で決める（会社の既定＋人ごとの上書き）
         w4d4       … 4週4日制。★起算日が要る★ */
      holidayMode: LAW.HOLIDAY_MODES.indexOf(o.holidayMode) >= 0 ? o.holidayMode : 'none',
      /* -1 = 決めていない（会社の既定） */
      legalHolidayDow: num(o.legalHolidayDow, -1),
      /* 人ごとの上書き（null なら会社の決まりに従う） */
      personHolidayDow: o.personHolidayDow == null || o.personHolidayDow === '' ? null : Number(o.personHolidayDow),
      /* 4週の起算日 'YYYY-MM-DD'（w4d4 のときだけ使う） */
      holidayCycleStart: o.holidayCycleStart || null,
      weekStartDow: num(o.weekStartDow, 0),         // 週の起算（0=日曜）
      /* ★休憩の既定★（2026-08-15）… 休憩の打刻が無い日に引く分。
         ★0 の会社も在る★ので「入っていないから60」にはしない（既定は60、明示の0は0）。 */
      breakDefaultMin: num(o.breakDefaultMin, 60),
      hourlyYen: o.hourlyYen == null || o.hourlyYen === '' ? null : Number(o.hourlyYen),
      sme: o.sme !== false,                          // 中小企業か（60時間超50%は2023-04-01から）
      warnOn: o.warnOn === true,                     // ★既定=切。ただし中では常に数える★
      grantDays: o.grantDays == null ? null : Number(o.grantDays),   // その年の有給付与日数
      yukyuTakenBefore: num(o.yukyuTakenBefore, 0),  // 期首からこの月の前までに消化した日数
    };
  }
  function num(v, d) { var n = Number(v); return isFinite(n) && v !== null && v !== '' ? n : d; }

  /* ── ③④ 1人・1か月ぶんを潰す（★入口はこれ1つ★） ─────────────
   * @param {object} arg
   *   arg.ym        'YYYY-MM'
   *   arg.punches   [{at:'YYYY-MM-DDTHH:mm', kind, src}]      ★生データ★
   *   arg.shifts    [{d:'YYYY-MM-DD', plannedMin, dayKind, plannedIn:'09:00', plannedOut:'18:00'}]
   *   arg.fixes     [{d, beforeMin, afterMin, reason, status}]
   *   arg.company   会社情報（withDefaults 参照）
   */
  function summarize(arg) {
    var o = withDefaults(arg && arg.company);
    var per = period(arg.ym, o.closeDay);
    var ses = sessions(arg.punches);

    var shiftBy = {}; (arg.shifts || []).forEach(function (s) { shiftBy[s.d] = s; });
    var fixBy = {}; (arg.fixes || []).forEach(function (f) { (fixBy[f.d] = fixBy[f.d] || []).push(f); });

    /* 期間内の全日を先に並べる（打刻が無い日も 欠勤/有給の判定に要る） */
    var days = [], cursor = per.from;
    while (cursor <= per.to) {
      var sh = shiftBy[cursor] || null;
      days.push({
        d: cursor,
        dow: dowOf(cursor),
        isLegalHoliday: fixedHolidayDow(o) >= 0 && dowOf(cursor) === fixedHolidayDow(o),
        dayKind: sh && sh.dayKind ? sh.dayKind : 'work',
        plannedMin: sh && sh.plannedMin != null ? Number(sh.plannedMin) : null,
        plannedIn: sh && sh.plannedIn ? sh.plannedIn : null,
        plannedOut: sh && sh.plannedOut ? sh.plannedOut : null,
        inAt: null, outAt: null,
        spanMin: 0,                                        // ★拘束（出勤〜退勤）★
        breakSrc: 'none',                                  // punch / fixed / default / none
        breakBy: null, breakAt: null,                      // 社長が直した時の 誰が・いつ
        breakMin: 0, awayMin: 0, offMin: 0, workMin: 0,
        stdMin: 0, overStdMin: 0, dayOtMin: 0, weekOtMin: 0, otMin: 0,
        nightMin: 0, holidayMin: 0,
        lateMin: null, earlyMin: null,
        incomplete: false, crossMidnight: false,
        rawWorkMin: 0, rawNightMin: 0, cutMin: 0,
        srcs: [], fixes: fixBy[cursor] || [],
      });
      cursor = addDays(cursor, 1);
    }
    var byDate = {}; days.forEach(function (x) { byDate[x.d] = x; });

    /* 出勤ごとに、出勤した日へ載せる */
    var outside = 0;
    ses.list.forEach(function (s) {
      var d = byDate[dayOf(s.start)];
      if (!d) { outside++; return; }                       // 期間外（前後の月）
      var m = measure(s, null);
      d.inAt = d.inAt || toStr(s.start);
      d.outAt = s.end != null ? toStr(s.end) : null;
      d.breakMin += m.breakMin;
      d.awayMin += m.awayMin;
      d.offMin += m.offMin;
      d.spanMin += m.spanMin;
      d.workMin += m.workMin;
      d.nightMin += m.nightMin;
      d.rawWorkMin += m.workMin;
      d.rawNightMin += m.nightMin;
      d.incomplete = d.incomplete || s.incomplete || s.end == null;
      d.crossMidnight = d.crossMidnight || (s.end != null && dayOf(s.end) !== d.d);
      if (s.src && d.srcs.indexOf(s.src) < 0) d.srcs.push(s.src);
      d._sess = (d._sess || []).concat([s]);
    });
    ses.stray.forEach(function (p) {
      var d = byDate[dayOf(toMin(p.at))];
      if (d) d.incomplete = true;
    });

    /* ── ★休憩を決める（2026-08-15 司さんの指摘で作り直した）★ ──────────
       それまでは ★休憩の打刻が無ければ 休憩0分＝働いた事にしていた★。
       ★現場は休憩ボタンを押さない★ ので、押し忘れがそのまま残業になっていた
       （9:00〜18:00 で 実労働540分・時間外60分と出ていた）。
       ⇒ ★押させるのをやめ、既定を引く★。強い順に:
            ① 社長が直した値（本当に休憩が取れなかった日が在る）
            ② 打刻された休憩（★過去のデータは1分も動かない★）
            ③ 会社の既定（★拘束6時間ちょうどは引かない／6時間1分から引く★）
       ★既定が法定を下回っても 黙って引き上げない★（引くのは既定のまま・赤で知らせる）。
       ★原本(打った時刻)には触らない★。引くのは ここ＝計算の側だけ。
       ★丸めより先にやる★（休憩を引いた後の実労働を丸める）。 */
    days.forEach(function (d) {
      var fix = shiftBy[d.d] && shiftBy[d.d].breakMin != null ? shiftBy[d.d] : null;
      if (fix) {
        d.breakSrc = 'fixed';
        d.breakBy = fix.breakBy || null;
        d.breakAt = fix.breakAt || null;
        setBreak(d, Number(fix.breakMin) || 0);
        return;
      }
      if (d.breakMin > 0) { d.breakSrc = 'punch'; return; }   // 打刻ぶんは もう引かれている
      if (d.spanMin <= LAW.BREAK_FREE_MAX_MIN) { d.breakSrc = 'none'; return; }
      d.breakSrc = 'default';
      setBreak(d, o.breakDefaultMin);
    });

    /* ── ③ 丸め（会社情報の設定でここだけ変わる） ──────────────
       daily30 … 日ごとに30分へ切り下げる。★退勤を切った分だけ手前に戻して数え直す★
                 （休憩の中に落ちても正しく数えられる。切った分は cutMin に必ず残す） */
    days.forEach(function (d) {
      if (o.round.scope !== 'day' || o.round.unitMin <= 1 || d.workMin <= 0) return;
      var target = adjust(d.workMin, o.round.unitMin, o.round.dir);
      if (target === d.workMin) return;
      if (target > d.workMin) {
        /* ★切り上げ★ … 打った時刻より後ろは分からないので、時刻は動かさず
           実労働だけ増やす（★深夜は増やさない★＝働いていない時間帯を作らない）。 */
        d.workMin = target;
        d.cutMin = d.rawWorkMin - d.workMin;               // 増えた分はマイナスで持つ
        return;
      }
      /* ★切り下げ★ … 退勤を削った分だけ手前に戻して数え直す
         （休憩の中に落ちても正しく数えられる。深夜もその場で減る） */
      if (!d._sess) { d.workMin = target; d.cutMin = d.rawWorkMin - d.workMin; return; }
      var s = d._sess[d._sess.length - 1];                 // その日の最後の出勤から削る
      if (s.end == null) { d.workMin = target; d.cutMin = d.rawWorkMin - d.workMin; return; }
      var e = s.end, guard = 0;
      var base = d.workMin - measure(s, null).workMin;      // 同日の他の出勤ぶん
      while (guard++ < DAY && base + measure(s, e).workMin > target) e--;
      var m2 = measure(s, e);
      var full = measure(s, null);
      d.breakMin = d.breakMin - full.breakMin + m2.breakMin;
      d.awayMin = d.awayMin - full.awayMin + m2.awayMin;
      d.offMin = d.offMin - full.offMin + m2.offMin;
      d.nightMin = d.nightMin - full.nightMin + m2.nightMin;
      d.workMin = base + m2.workMin;
      d.cutMin = d.rawWorkMin - d.workMin;
    });

    /* ★4週4日制★は 働いた結果で決まるので、実労働が出てから決める（丸めの後） */
    applyW4D4(days, o);

    /* ② 区分に分ける（丸めた後の実労働で分ける） */
    days.forEach(function (d) {
      var sp = splitDay({ workMin: d.workMin, nightMin: d.nightMin }, d.isLegalHoliday, o.dailyStdMin);
      d.stdMin = sp.stdMin; d.overStdMin = sp.overStdMin; d.dayOtMin = sp.dayOtMin;
      d.holidayMin = sp.holidayMin; d.nightMin = sp.nightMin;
      if (d.plannedIn && d.inAt) {
        var pi = dayMin(d.d) + hmToMin(d.plannedIn);
        d.lateMin = Math.max(0, toMin(d.inAt) - pi);
      }
      if (d.plannedOut && d.outAt) {
        var po = dayMin(d.d) + hmToMin(d.plannedOut);
        d.earlyMin = Math.max(0, po - toMin(d.outAt));
      }
    });

    /* 週40時間超（法定休日の労働は数えない・日ごとの残業と二重に数えない）
       ★週の起算日から順に積んで、40時間を超えた所から先が週の残業★ */
    var weekAcc = {}, lastWeek = null;
    days.forEach(function (d) {
      var wk = weekKey(d.d, o.weekStartDow);
      if (wk !== lastWeek) { lastWeek = wk; }
      if (d.isLegalHoliday) return;
      var plain = d.workMin - d.dayOtMin;                   // 日ごとの残業として既に数えた分は除く
      var before = weekAcc[wk] || 0, after = before + plain;
      weekAcc[wk] = after;
      d.weekOtMin = Math.max(0, after - o.weekLegalMin) - Math.max(0, before - o.weekLegalMin);
    });
    /* ★週40時間超に回した分は 所定内／所定超から抜く★
       抜かないと ★同じ分が2か所に数えられ★、
       「総労働 ＝ 所定内＋所定超＋時間外＋休日」が合わなくなる（実測で見つけた）。
       抜く順は ★所定超（割増なし）→ 所定内★（上から順に時間外へ移る） */
    days.forEach(function (d) {
      d.otMin = d.dayOtMin + d.weekOtMin;
      var move = d.weekOtMin;
      var fromOver = Math.min(move, d.overStdMin);
      d.overStdMin -= fromOver; move -= fromOver;
      var fromStd = Math.min(move, d.stdMin);
      d.stdMin -= fromStd;
    });

    /* ── ④ 月合計に潰す（★kintai-csv.js と同じ形★） ────────────── */
    function totals(pick) {
      var t = { workedMin: 0, otMin: 0, nightMin: 0, holidayMin: 0 };
      days.forEach(function (d) {
        t.workedMin += pick(d).workedMin;
        t.otMin += pick(d).otMin;
        t.nightMin += pick(d).nightMin;
        t.holidayMin += pick(d).holidayMin;
      });
      return t;
    }
    var afterDaily = totals(function (d) { return { workedMin: d.workMin, otMin: d.otMin, nightMin: d.nightMin, holidayMin: d.holidayMin }; });
    /* ★割増の内訳（社長が画面で確かめられるように）★
       所定内・所定超（割増なし）・休日の深夜 は 合計しないと出てこない */
    var breakdown = { stdMin: 0, overStdMin: 0, holidayNightMin: 0 };
    days.forEach(function (d) {
      breakdown.stdMin += d.stdMin;
      breakdown.overStdMin += d.overStdMin;
      if (d.isLegalHoliday) breakdown.holidayNightMin += d.nightMin;
    });
    /* ★生データの合計（丸める前）★ … 保存則の検査に使う */
    var raw = { workedMin: 0, otMin: 0, nightMin: 0, holidayMin: 0 };
    days.forEach(function (d) { raw.workedMin += d.rawWorkMin; });
    var dayRounded = o.round.scope === 'day' && o.round.unitMin > 1;
    if (dayRounded) {
      var rawDays = rebuildRaw(days, o);
      raw.otMin = rawDays.otMin; raw.nightMin = rawDays.nightMin; raw.holidayMin = rawDays.holidayMin;
    } else {
      raw.otMin = afterDaily.otMin; raw.nightMin = afterDaily.nightMin; raw.holidayMin = afterDaily.holidayMin;
    }

    var month = {
      workedMin: afterDaily.workedMin,
      otMin: afterDaily.otMin,
      nightMin: afterDaily.nightMin,
      holidayMin: afterDaily.holidayMin,
    };
    /* かける先が「1か月の合計」の時 … ★時間外・休日・深夜の【各々】の合計★に当てる
       （通達がその形なので、custom でも同じ3つに当てる。★実労働の合計は動かさない★） */
    if (o.round.scope === 'month' && o.round.unitMin > 1) {
      month.otMin = adjust(month.otMin, o.round.unitMin, o.round.dir);
      month.nightMin = adjust(month.nightMin, o.round.unitMin, o.round.dir);
      month.holidayMin = adjust(month.holidayMin, o.round.unitMin, o.round.dir);
    }
    month.ot60Min = Math.max(0, month.otMin - LAW.OT60_THRESHOLD_MIN);
    /* ★割増の内訳★（★総労働 ＝ 所定内＋所定超＋時間外＋休日★。深夜は上乗せなので足さない） */
    month.stdMin = breakdown.stdMin;
    month.overStdMin = breakdown.overStdMin;
    month.holidayNightMin = Math.min(breakdown.holidayNightMin, month.holidayMin);
    month.shukkin = days.filter(function (d) { return d.workMin > 0; }).length;
    month.kekkin = days.filter(function (d) { return d.dayKind === 'absent'; }).length;
    month.yukyu = days.filter(function (d) { return d.dayKind === 'paid_leave'; }).length;
    /* ★遅刻・早退の合計★（2026-08-15 指示役の指摘）
       ＝★給与で控除に使う数字★なのに、どこにも合計が出ていなかった
       （社長が31行を目で足す事になっていた）。★丸めは当てない★＝予定との差そのもの。 */
    month.lateMin = days.reduce(function (a, d) { return a + (d.lateMin || 0); }, 0);
    month.earlyMin = days.reduce(function (a, d) { return a + (d.earlyMin || 0); }, 0);

    /* ★切り捨てた分＝生データ − 丸めた後★（引き算で作らず、両方を別々に数えてから引く） */
    var cut = {
      workedMin: raw.workedMin - month.workedMin,
      otMin: raw.otMin - month.otMin,
      nightMin: raw.nightMin - month.nightMin,
      holidayMin: raw.holidayMin - month.holidayMin,
      yen: null,
    };
    if (o.hourlyYen != null && isFinite(o.hourlyYen)) {
      cut.yen = Math.round(payOf(raw, o) - payOf(month, o));
    }
    cut.byDayMin = days.reduce(function (a, d) { return a + d.cutMin; }, 0);


    return {
      period: per,
      rounding: o.rounding,
      round: o.round,
      /* ★法律の線の内か外か（止める為ではなく、黙って選ばせない為）★ */
      legality: LAW.roundingLegality(o.round),
      days: days.map(strip),
      month: month,
      raw: raw,
      cut: cut,
      outsidePeriodSessions: outside,
    };
  }

  /* 丸める前の区分合計を作り直す（daily30 のときだけ使う） */
  function rebuildRaw(days, o) {
    var t = { otMin: 0, nightMin: 0, holidayMin: 0 };
    var weekAcc = {};
    days.forEach(function (d) {
      var m = { workMin: d.rawWorkMin, nightMin: d.rawNightMin };
      var sp = splitDay(m, d.isLegalHoliday, o.dailyStdMin);
      t.holidayMin += sp.holidayMin;
      t.nightMin += sp.nightMin;
      var plain = m.workMin - sp.dayOtMin;
      var wk = weekKey(d.d, o.weekStartDow);
      var before = weekAcc[wk] || 0, after = before + (d.isLegalHoliday ? 0 : plain);
      if (!d.isLegalHoliday) weekAcc[wk] = after;
      var weekOt = d.isLegalHoliday ? 0 : Math.max(0, after - o.weekLegalMin) - Math.max(0, before - o.weekLegalMin);
      t.otMin += sp.dayOtMin + weekOt;
    });
    return t;
  }
  /** その月の賃金（時給×割増）。★切り捨てた金額を出すためだけの目安★ */
  function payOf(t, o) {
    var h = o.hourlyYen / 60;
    var ot60 = Math.max(0, t.otMin - LAW.OT60_THRESHOLD_MIN);
    var ot = t.otMin - ot60;
    var plain = Math.max(0, t.workedMin - t.otMin - t.holidayMin);
    return h * (
      plain * 1
      + ot * (1 + LAW.RATE.ot)
      + ot60 * (1 + LAW.RATE.ot60)
      + t.holidayMin * (1 + LAW.RATE.holiday)
      + t.nightMin * LAW.RATE.night
    );
  }

  function weekKey(ymd, startDow) {
    var m = dayMin(ymd), dw = dowOf(ymd);
    var back = (dw - startDow + 7) % 7;
    return dayOf(m - back * DAY);
  }

  function strip(d) {
    var c = {}; for (var k in d) if (k !== '_sess') c[k] = d[k];
    return c;
  }

  /* ★気づき（警告）は 2026-08-15 に丸ごと外した★（司さんの決定）
     ＝ 6日続けて出勤／36協定の上限／年5日／法定休日を決めていない／4週の起算日／
       休憩が足りません … これらは ★誰も見ない物になっていた★。
     ★消していない物★:
       ・lib/tc-law.js は残す（★丸めが法律の線の内か外か／法定休日の判定／法定の休憩時間★に使う）
       ・★紙の備考★（打刻が片方だけ／日をまたぐ勤務／欠勤なのに打刻がある）＝その日に何が起きたか
       ・★休憩の既定が法定を下回る赤★＝会社情報の その場で言う（設定の間違い）
     ★数えるだけで誰も呼ばない物は残さない★ ので countWarnings ごと消した。 */


  return {
    toMin: toMin, toStr: toStr, dayOf: dayOf, dowOf: dowOf, addDays: addDays,
    daysInMonth: daysInMonth, hmToMin: hmToMin, weekKey: weekKey,
    period: period, nightOverlap: nightOverlap,
    sessions: sessions, measure: measure, splitDay: splitDay,
    withDefaults: withDefaults, payOf: payOf,
    normalizeRound: normalizeRound, adjust: adjust, ROUND_MODES: ROUND_MODES,
    fixedHolidayDow: fixedHolidayDow, applyW4D4: applyW4D4,
    summarize: summarize,
  };
});
