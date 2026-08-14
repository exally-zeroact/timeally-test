/* tc-name.js — ★保存/DL/PDFの「おすすめの名前」を中身から作る★（Timeally）
 * =============================================================================
 * 決まり（全アプリ共通）:
 *   ・★中身から作った推奨ファイル名を、押す前に画面へ先に出す★（後から聞かない）
 *   ・落とせない文字を残さない: \ / : * ? " < > | と 制御文字
 *   ・空欄を並べない（相手や月が無くても「_」だけの名前を作らない）
 *   ・機種依存文字（丸数字・ローマ数字・㈱ 等）は読める字に開く
 *   ・長すぎる名前はWindowsで落とせないので上限に収める（拡張子は必ず残す）
 * 【利用】window.TcName.build({...}) / require('./tc-name.js')
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.TcName = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX = 120;   // 拡張子を除いた本体の上限（Windowsのパス上限に余裕を持たせる）

  /* 機種依存文字 → 読める字。★消さずに開く★（消すと「①②」が全部消えて意味が変わる） */
  var TRANS = [
    [/[①-⑳]/g, function (c) { return '(' + (c.charCodeAt(0) - 0x245F) + ')'; }],   // ①〜⑳
    [/[Ⅰ-Ⅻ]/g, function (c) { return ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][c.charCodeAt(0) - 0x2160]; }],
    [/㈱/g, '(株)'], [/㈲/g, '(有)'], [/㈳/g, '(社)'],
    [/㎡/g, 'm2'], [/㎜/g, 'mm'], [/㎝/g, 'cm'], [/㎞/g, 'km'],
    [/№/g, 'No.'], [/℡/g, 'TEL'], [/㎐/g, 'Hz'],
    [/[～〜]/g, '-'],   // 〜（全角チルダ／波ダッシュ）
  ];

  /** 1つの部品を、ファイル名に使える形にする。使えない物は消えるのではなく置き換える。 */
  function clean(s) {
    var t = String(s == null ? '' : s);
    for (var i = 0; i < TRANS.length; i++) t = t.replace(TRANS[i][0], TRANS[i][1]);
    t = t.replace(/[\\/:*?"<>|]/g, '-');           // Windows/macで落とせない文字
    /* eslint-disable-next-line no-control-regex */
    t = t.replace(/[\u0000-\u001f\u007f]/g, '');            // 制御文字
    t = t.replace(/[\s　]+/g, ' ').trim();
    t = t.replace(/^[.\s]+|[.\s]+$/g, '');         // 先頭末尾のドット/空白（拡張子が壊れる）
    return t;
  }

  /**
   * 名前を作る。★空の部品は静かに落とす（「__」を作らない）★
   * @param {object} p {kind:'勤怠', company, person, ym, count, stamp}
   * @param {string} ext 'csv' | 'pdf' | 'xlsx'
   */
  function build(p, ext) {
    p = p || {};
    var parts = [];
    push(parts, p.kind || '勤怠');
    push(parts, p.company);
    push(parts, p.person);
    push(parts, p.ym);
    if (p.count != null && p.count !== '' && !p.person) push(parts, '全' + p.count + '名');
    push(parts, p.stamp);
    var base = parts.join('_') || '勤怠';
    if (base.length > MAX) base = base.slice(0, MAX).replace(/[_\s]+$/, '');
    var e = String(ext || 'csv').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'csv';
    return base + '.' + e;
  }
  function push(arr, v) { var c = clean(v); if (c) arr.push(c); }

  return { build: build, clean: clean, MAX: MAX };
});
