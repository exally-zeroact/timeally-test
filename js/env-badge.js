/* env-badge.js — ★テスト環境の帯（見た瞬間に本番でないと分かる）★（Timeally）
 * ==============================================================================
 * ★出どころ★: exally-staging/js/env-badge.js（2026-08-11 指示役の実測で作られた物）。
 *   ★仕組みは1文字も変えていない★。変えたのは 色・id・グローバル名だけ。
 *   色を変えた理由: Timeally の主色は ★明るい黄★ で、Exally の帯が使っている橙は
 *   ★主色と混ざって「帯」に見えない★。うちの決まりは「注意の橙を使わない・赤に寄せる」。
 *   （hexをこのコメントに書かない＝見張り tests/palette.test.mjs の誤検知を作らない）
 *
 * ここで止めたい事故（重い順）:
 *   ① ★本番に「テスト環境」と出る★  … 本番を軽く扱って壊す。いちばん危ない。
 *   ② ★1画面でも帯が出ない★        … 出ない画面を本番だと思い込む。
 *   ③ 帯のせいで ★画面の頭が隠れる★ … 上の帯・1行目が読めなくなる（iOSの前科）。
 *   ④ 帯の文が ★1文字ずつ縦に割れる★（前科3回）
 *
 * ★何を見て決めるか＝ js/supa-config.js の env（この配信の名札）★
 *   ホスト名（github.io / vercel.app）では決めない。配り方は変わるが
 *   ★本当に大事なのは「本番のデータか、テストのデータか」★だから。
 *   倉庫のIDをこのファイルに書くのも禁じ手（★向き先を持つのは supa-config.js だけ★）。
 *
 * ★安全側の倒し方★ env が 'test' と分かった時 ★だけ★ 出す。
 *   本番('prod')／名札が無い／知らない値なら ★出さない★。
 *
 * 【利用】各HTMLの本文の最後で、supa-config.js より ★後★ に読む
 */
(function (global) {
  'use strict';

  var TEST = 'test';

  /**
   * 帯を出すか。★'test' と分かった時だけ true★
   *   本番('prod')／名札が無い／知らない値 → ★出さない（安全側）★
   */
  function shouldShow(cfg) {
    var env = (cfg && typeof cfg === 'object') ? cfg.env : cfg;
    return String(env || '') === TEST;
  }

  /* 帯の見た目。★注意も警告も赤に寄せる（主色の黄と混ぜない＝気づける）★
     地 #B3261E に白文字＝コントラスト 6.5（実測して選んだ）。 */
  var CSS = [
    '#tc-envbar{position:fixed;top:0;left:0;right:0;z-index:2147483000;',
    'background:#B3261E;color:#FFFFFF;',
    "font-family:'Noto Sans JP',system-ui,-apple-system,sans-serif;",
    'font-size:12px;font-weight:700;line-height:1.5;text-align:center;',
    'padding:calc(6px + env(safe-area-inset-top)) 12px 6px;',
    'box-shadow:0 1px 4px rgba(0,0,0,.18);',
    /* ★文は1文字ずつ縦に割れない書き方（block・折り返し可）★ */
    'white-space:normal;word-break:normal;overflow-wrap:break-word;}',
    '#tc-envbar b{font-weight:700;}',
    '#tc-envbar .tc-envbar-sub{display:block;font-weight:400;font-size:10.5px;opacity:.92;}',
    '@media print{#tc-envbar{display:none !important;}}',
  ].join('');

  function mount() {
    if (!shouldShow(global.SUPA)) return null;
    var d = global.document;
    if (!d || d.getElementById('tc-envbar')) return null;

    var st = d.createElement('style');
    st.id = 'tc-envbar-css';
    st.textContent = CSS;
    d.head.appendChild(st);

    var bar = d.createElement('div');
    bar.id = 'tc-envbar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<b>テスト環境</b>'
      + '<span class="tc-envbar-sub">ここで打った打刻は本番には入りません（練習用の倉庫です）</span>';
    d.body.insertBefore(bar, d.body.firstChild);

    fit(bar);
    global.addEventListener('resize', function () { fit(bar); });
    return bar;
  }

  /* ★帯のぶんだけ中身を下げる★（アプリの上の帯や1行目が隠れないように） */
  function fit(bar) {
    var d = global.document;
    var h = bar.offsetHeight || 0;
    if (!h) return;
    d.body.style.paddingTop = h + 'px';
    /* ★動かすのは position:sticky だけ★
       fixed は「画面いっぱいに被せる物」（ログイン画面・小窓）に使われている。
       下げると ★被せ物に隙間が空き、下がはみ出す★（2026-08-11 実機で確認）。 */
    var all = d.querySelectorAll('body *');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.id === 'tc-envbar') continue;
      var cs = global.getComputedStyle(el);
      if (cs.position !== 'sticky') continue;
      if (cs.top !== '0px' && el.getAttribute('data-envbar-top') !== '1') continue;
      el.style.top = h + 'px';
      el.setAttribute('data-envbar-top', '1');
    }
  }

  var API = { shouldShow: shouldShow, mount: mount, TEST: TEST, CSS: CSS };
  if (typeof module === 'object' && module.exports) module.exports = API;
  else {
    global.TimeallyEnvBadge = API;
    if (global.document) {
      if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', mount);
      } else {
        mount();
      }
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);
