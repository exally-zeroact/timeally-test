/* tc-csv.js — ★給与への出口★（Timeally）
 * =============================================================================
 * ★合格条件は1行で決まる★:
 *   「出したCSVを exally-prod/kyuyo/lib/kintai-csv.js に食わせて rows が期待どおり」
 *   ＝ ★繋ぐ前に、テストだけで確かめられる★（tests/tc-csv.test.mjs が実際に食わせている）
 *
 * だから見出しは【受け取る側が読める言葉】で出す。kintai-csv.js の classify() は
 *   氏名 / 従業員番号 / 出勤日数 / 欠勤 / 有給 / 労働時間 / 時間外 / 深夜 / 休日
 * をキーワードで拾う。★見出しを勝手に変えない★（変えたら受け取る側が黙って0になる）。
 *
 * 時間は "160:30"（時:分）で出す。kintai-csv.toMinutes が ':' を見て分に直す。
 *   ★小数時（160.5）にしない★＝丸め誤差が1分単位の原本と食い違う。
 *
 * ★Excelで開けるように UTF-8 BOM ＋ CRLF★（BOMが無いと日本語が化ける）。
 *   kintai-csv.splitLine は BOM を落とし、改行は \r\n / \r / \n のどれでも読む。
 *
 * 【利用】window.TcCsv / require('./tc-csv.js')
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.TcCsv = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var BOM = '﻿';
  var EOL = '\r\n';

  /** 分 → "H:MM"。★負の分（月合計の切り上げ）も落とさずに出す★ */
  function hhmm(min) {
    var m = Math.round(Number(min) || 0);
    var sign = m < 0 ? '-' : '';
    m = Math.abs(m);
    return sign + Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2);
  }

  function cell(v) {
    var s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function join(aoa) {
    return BOM + aoa.map(function (r) { return r.map(cell).join(','); }).join(EOL) + EOL;
  }

  /* ── 給与への受け口（1人1行・月合計） ─────────────────────────
     ★見出しは kintai-csv.js が読める言葉のまま★ */
  var MONTHLY_HEADERS = [
    '従業員番号', '氏名', '出勤日数', '欠勤日数', '有給日数',
    '労働時間', '時間外労働', '深夜労働', '休日労働',
  ];

  /**
   * @param {Array} people [{ no, name, month:{shukkin,kekkin,yukyu,workedMin,otMin,nightMin,holidayMin} }]
   */
  function monthlyAoa(people) {
    var aoa = [MONTHLY_HEADERS.slice()];
    (people || []).forEach(function (p) {
      var m = p.month || {};
      aoa.push([
        p.no == null ? '' : p.no,
        p.name || '',
        m.shukkin == null ? '' : m.shukkin,
        m.kekkin == null ? '' : m.kekkin,
        m.yukyu == null ? '' : m.yukyu,
        hhmm(m.workedMin), hhmm(m.otMin), hhmm(m.nightMin), hhmm(m.holidayMin),
      ]);
    });
    return aoa;
  }
  function monthlyCsv(people) { return join(monthlyAoa(people)); }

  /* ── 日ごとの明細（社長側の集計/印刷と同じ並び） ─────────────────
     ★紙に「どう絞り込んだか」は刷らない★＝この表にも絞り込み条件の列を作らない。 */
  var DAILY_HEADERS = [
    '日付', '曜日', '出勤', '退勤', '休憩', '中抜け', '実労働',
    '所定内', '所定超', '法定外残業', '深夜', '休日', '遅刻', '早退',
    '有給', '欠勤', '備考',
  ];
  var DOW = ['日', '月', '火', '水', '木', '金', '土'];

  function dailyAoa(summary) {
    var aoa = [DAILY_HEADERS.slice()];
    (summary.days || []).forEach(function (d) {
      aoa.push([
        d.d, DOW[d.dow],
        d.inAt ? d.inAt.slice(11) : '',
        d.outAt ? d.outAt.slice(11) : '',
        hhmm(d.breakMin), hhmm(d.awayMin), hhmm(d.workMin),
        hhmm(d.stdMin), hhmm(d.overStdMin), hhmm(d.otMin),
        hhmm(d.nightMin), hhmm(d.holidayMin),
        d.lateMin == null ? '' : hhmm(d.lateMin),
        d.earlyMin == null ? '' : hhmm(d.earlyMin),
        d.dayKind === 'paid_leave' ? 1 : '',
        d.dayKind === 'absent' ? 1 : '',
        note(d),
      ]);
    });
    return aoa;
  }
  function dailyCsv(summary) { return join(dailyAoa(summary)); }

  /** 備考＝直した記録（元は何分か）と、打刻漏れ・日またぎ・切り捨て */
  function note(d) {
    var n = [];
    (d.fixes || []).forEach(function (f) {
      if (f.status && f.status !== 'approved') return;
      n.push('直し ' + f.beforeMin + '分→' + f.afterMin + '分' + (f.reason ? '（' + f.reason + '）' : ''));
    });
    if (d.incomplete) n.push('打刻が片方だけ');
    if (d.crossMidnight) n.push('日をまたぐ勤務');
    if (d.cutMin) n.push('切り捨て ' + d.cutMin + '分');
    if (d.srcs && d.srcs.indexOf('calendar') >= 0) n.push('後から入れた申請');
    return n.join(' / ');
  }

  return {
    MONTHLY_HEADERS: MONTHLY_HEADERS,
    DAILY_HEADERS: DAILY_HEADERS,
    hhmm: hhmm, join: join,
    monthlyAoa: monthlyAoa, monthlyCsv: monthlyCsv,
    dailyAoa: dailyAoa, dailyCsv: dailyCsv, note: note,
  };
});
