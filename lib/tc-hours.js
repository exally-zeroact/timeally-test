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

  /** 全角→半角・余計な語を落とす。
   *  ★「8時間30分」は "830" ではなく "8:30" にする★（そのまま消すと830時間になる。実際に踏んだ） */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[０-９．：]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[\s　]/g, '')
      .replace(/時間|時|hours|hour|hrs|hr|h/gi, ':')
      .replace(/分|minutes|minute|mins|min|m/gi, '')
      .replace(/:+$/, '');            // "8時間" → "8:" → "8"
  }

  /**
   * 「時間」の入力 → ★分★。読めなければ null（0にしない）。
   *  "8:30" は 8時間30分＝510分。"7.5" は 450分。
   *  ★分に直す時だけ四捨五入★（0.1時間＝6分。7.33時間＝439.8→440分）
   */
  function toMin(text) {
    var s = normalize(text);
    if (s === '') return null;
    if (s.indexOf(':') >= 0) {
      var p = s.split(':');
      if (p.length !== 2) return null;
      if (!/^\d+$/.test(p[0]) || !/^\d{1,2}$/.test(p[1])) return null;
      var mm = Number(p[1]);
      if (mm > 59) return null;
      return Number(p[0]) * 60 + mm;
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    return Math.round(Number(s) * 60);
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

  /** 上限つきで読む（1日は24時間まで・1週は168時間まで 等）。だめなら理由を返す */
  function read(text, opts) {
    opts = opts || {};
    var min = toMin(text);
    if (min == null) return { min: null, error: String(text || '').trim() === '' ? 'empty' : 'unreadable' };
    if (min < 0) return { min: null, error: 'negative' };
    if (opts.maxMin != null && min > opts.maxMin) return { min: null, error: 'too_big' };
    return { min: min, error: null };
  }

  var MAX_DAY_MIN = 24 * 60;        // 1日
  var MAX_WEEK_MIN = 24 * 7 * 60;   // 1週

  return {
    normalize: normalize, toMin: toMin, toText: toText, read: read,
    MAX_DAY_MIN: MAX_DAY_MIN, MAX_WEEK_MIN: MAX_WEEK_MIN,
  };
});
