/* tc-hours.js — ★「時間」で入れさせて、中では「分」で持つ★（Timeally）
 * =============================================================================
 * 司さんの指摘（2026-08-14）:
 *   設定の画面が全部「分」になっていた（480 / 2400 / 60）。
 *   ★人は「8時間・40時間・1時間」で考える。分で書かせない。★
 *
 * ★中では今までどおり分のまま持つ★（倉庫の列も分のまま）。
 *   計算を分でやるのは ★丸めの誤差を作らない★ため。
 *   ここは ★入り口と出口の言い換えだけ★をする。
 *
 * 受ける書き方（打つ人が迷わないように広く受ける）:
 *   "8" / "7.5" / "0.75" / "8:30" / "8：30"（全角コロン） / "８.５"（全角数字）
 *   前後の空白・全角空白 / "8時間" / "8h" も落とす
 * ★空欄は 0 ではなく null★（「未入力」と「0時間」を混ぜない）
 *
 * 【利用】ブラウザ window.TcHours / Node require('./tc-hours.js')
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.TcHours = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 全角→半角・空白落とし・小文字化だけ。★単位の語は消さない★
   *  （前は「時間」を ':' に直して「分」を消していた。すると ★「45分」が "45"＝45時間★ に
   *    なってしまった。★単位を消してから読む★のが間違いだった。実機で踏んだ） */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[０-９．：]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[\s　]/g, '')
      .toLowerCase();
  }

  var H = '(?:時間|時|hours|hour|hrs|hr|h)';
  var M = '(?:分|minutes|minute|mins|min|m)';
  var N = '(\\d+(?:\\.\\d+)?)';
  /* ★書き方ごとに、単位を見てから読む★（順に当てる。当たらなければ読めない＝null） */
  var PATTERNS = [
    // ① 8時間30分 / 1時間30分 / 8h30m … 時間＋分
    { re: new RegExp('^' + N + H + N + M + '?$'), f: function (m) { return Number(m[1]) * 60 + Number(m[2]); } },
    // ② 8時間 / 8h … 時間だけ
    { re: new RegExp('^' + N + H + '$'), f: function (m) { return Number(m[1]) * 60; } },
    // ③ ★45分 / 90分 / 45m … 分だけ★（★ここが抜けていた★）
    { re: new RegExp('^' + N + M + '$'), f: function (m) { return Number(m[1]); } },
    // ④ 8:30 … 時:分
    { re: /^(\d+):(\d{1,2})$/, f: function (m) { return Number(m[2]) > 59 ? null : Number(m[1]) * 60 + Number(m[2]); } },
    // ⑤ 8 / 7.5 … 単位が無ければ ★時間★（欄の見出しが「時間」なので）
    { re: /^(\d+(?:\.\d+)?)$/, f: function (m) { return Number(m[1]) * 60; } },
  ];

  /**
   * 入力 → ★分★。読めなければ null（0にしない）。
   *   "8"→480 ／ "7.5"→450 ／ "8:30"→510 ／ ★"45分"→45★ ／ "8時間30分"→510
   *   ★分に直す時だけ四捨五入★（0.1時間＝6分。7.33時間＝439.8→440分）
   */
  function toMin(text) {
    var s = normalize(text);
    if (s === '') return null;
    for (var i = 0; i < PATTERNS.length; i++) {
      var m = PATTERNS[i].re.exec(s);
      if (!m) continue;
      var v = PATTERNS[i].f(m);
      if (v == null || !isFinite(v)) return null;
      return Math.round(v);
    }
    return null;
  }

  /** どの書き方で読んだか（画面の言い方を変えるのに使う） */
  function unitOf(text) {
    var s = normalize(text);
    if (s === '') return null;
    if (new RegExp('^' + N + M + '$').test(s)) return 'minute';
    if (/^(\d+):(\d{1,2})$/.test(s)) return 'hm';
    if (new RegExp('^' + N + H + N + M + '?$').test(s) || new RegExp('^' + N + H + '$').test(s)) return 'hm';
    if (/^(\d+(?:\.\d+)?)$/.test(s)) return 'hour';
    return null;
  }

  /**
   * 分 → 人が読む「時間」。
   *   ちょうどの時間は "8"／端数があれば "7:30"（★どちらか分かる形にする★）
   *   null / 未入力は ''
   */
  function toText(min) {
    if (min == null || min === '') return '';
    var m = Math.round(Number(min));
    if (!isFinite(m)) return '';
    var sign = m < 0 ? '-' : '';
    m = Math.abs(m);
    if (m % 60 === 0) return sign + (m / 60);
    return sign + Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2);
  }

  /** 上限つきで読む。だめなら ★止めた本当の理由★ を返す
   *  （前は「45分」を45時間と読んで「大きすぎます（24時間まで）」と出していた＝★嘘の理由★。
   *    人は「24時間まで？」と読んで固まる。理由は正しく言う） */
  function read(text, opts) {
    opts = opts || {};
    var min = toMin(text);
    if (min == null) return { min: null, error: String(text == null ? '' : text).trim() === '' ? 'empty' : 'unreadable', unit: null };
    if (min < 0) return { min: null, error: 'negative', unit: unitOf(text) };
    if (opts.maxMin != null && min > opts.maxMin) {
      return { min: null, error: 'too_big', read: min, maxMin: opts.maxMin, unit: unitOf(text) };
    }
    return { min: min, error: null, unit: unitOf(text) };
  }

  var MAX_DAY_MIN = 24 * 60;        // 1日
  var MAX_WEEK_MIN = 24 * 7 * 60;   // 1週

  return {
    normalize: normalize, toMin: toMin, toText: toText, read: read, unitOf: unitOf,
    MAX_DAY_MIN: MAX_DAY_MIN, MAX_WEEK_MIN: MAX_WEEK_MIN,
  };
});
