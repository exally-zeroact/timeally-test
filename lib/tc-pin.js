/* tc-pin.js — ★従業員が触る秘密は「暗証番号」1つだけ★（Timeally）
 * =============================================================================
 * ★2026-08-15 司さんの指摘で作り直した★
 *   それまでは 従業員が ★秘密を3つ★ 持たされていた:
 *     ① リンク(?t=…)  ② 会社が渡す「最初のあいことば」  ③ 自分で決める8文字以上の文字列
 *   ★②はリンクと同じ口で渡すので 守りが増えていない★（同じ人が同じLINEで送る）。
 *   ★③は現場で毎日 何回も打つ物★＝スマホで8文字以上を打たせる作りは使われない
 *   （★「分」が数字キーボードで打てなかったのと同じ話★）。
 *   ⇒ ★秘密は「暗証番号（数字4〜6桁）」1つだけ★にした。
 *
 * ★守りが減る分の埋め合わせ★（アプリ側で入れてある）
 *   ・リンク(?t=)自体が当てられない（uuid）＝★リンクを持っている人だけが 番号を試せる★
 *   ・★5回まちがえたら15分あかない★（1人ずつ）
 *   ・★決めた／作り直した を 追記で残す★（社長の画面に日時が出る＝身に覚えが無ければ気づける）
 *   ・★2回目からは決められない★（入口を作り直すまで変えられない）
 *
 * ★同じ数字の並び（1111）を止めない★
 *   止めると ★人は紙に書きます★。それは弱くなる（司さんの指示・2026-08-15）。
 *
 * 【利用】ブラウザ window.TcPin / Node require('./tc-pin.js')
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.TcPin = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MIN = 4, MAX = 6;
  /** ★倉庫(SQL)側と同じ線★。tests/pin.test.mjs が SQL の正規表現と突き合わせている */
  var RE = /^[0-9]{4,6}$/;

  /** 全角の数字を半角へ（スマホで全角になる事がある） */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[\s　-]/g, '');
  }

  /**
   * 入れてよい暗証番号か。★止める理由は1か所★（画面ごとに書かない）
   * @returns {{ok:boolean, pin:string, msg:string}}
   */
  function check(raw) {
    var pin = normalize(raw);
    if (!pin) return { ok: false, pin: '', msg: '暗証番号を入れてください' };
    if (/[^0-9]/.test(pin)) return { ok: false, pin: pin, msg: '数字だけで入れてください' };
    if (pin.length < MIN) return { ok: false, pin: pin, msg: '暗証番号は' + MIN + '桁から' + MAX + '桁です' };
    if (pin.length > MAX) return { ok: false, pin: pin, msg: '暗証番号は' + MIN + '桁から' + MAX + '桁です' };
    /* ★1111 のような並びも通す★（止めると人は紙に書く） */
    return { ok: true, pin: pin, msg: '' };
  }

  /** 2つ入れてもらった時（決める時）に食い違っていないか */
  function checkPair(a, b) {
    var r = check(a);
    if (!r.ok) return r;
    if (normalize(a) !== normalize(b)) return { ok: false, pin: r.pin, msg: '2つの暗証番号が違います' };
    return r;
  }

  return { MIN: MIN, MAX: MAX, RE: RE, normalize: normalize, check: check, checkPair: checkPair };
});
