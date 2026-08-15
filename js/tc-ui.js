/* tc-ui.js — 画面で何度も要る小道具（Timeally）
 * =============================================================================
 * ★同じ物を2か所に書かない★（トースト・日付の選び方・紙の刷り方・ファイルの渡し方）
 *
 * ここに入れた理由がある物:
 *   ・★印刷は「紙だけの新しい窓」で刷る★
 *     画面に @media print を当てて刷ると、画面の都合（sticky・スクロール・被せ物）が
 *     そのまま紙に出る。★下絵が0枚のまま印刷ダイアログが開いて真っ白★という前科もある
 *     ので、★中身が1枚も無い時は開かない★。
 *   ・★ファイルは js/file-out.js が唯一の渡し口★（種類を正しく付けないと iPhone で開けない）
 *   ・★保存名は中身から作って、押す前に画面に出す★（lib/tc-name.js）
 *   ・日付は ★カレンダーで選ぶ・内部はISO・表示は M/D★（代行請求アプリと同じ形）
 *
 * 【利用】window.TcUi
 */
(function (global) {
  'use strict';

  var d = global.document;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── トースト ─────────────────────────────────────────────── */
  var _toastEl = null, _toastTimer = null;
  function toast(msg) {
    if (!d) return;
    if (!_toastEl) {
      _toastEl = d.createElement('div');
      _toastEl.className = 'tc-toast';
      _toastEl.setAttribute('role', 'status');
      d.body.appendChild(_toastEl);
    }
    _toastEl.textContent = String(msg || '');
    _toastEl.style.display = 'block';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { if (_toastEl) _toastEl.style.display = 'none'; }, 3200);
  }

  /* ── 日付：カレンダーで選ぶ・内部ISO・表示 M/D ──────────────── */
  function mdShort(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? (+m[2]) + '/' + (+m[3]) : '';
  }
  /** onchange には「値を受け取る関数名（文字列）」を渡す */
  function dateField(iso, onchangeJs) {
    var md = mdShort(iso);
    return '<div class="tc-date-wrap">'
      + '<span class="tc-date-show' + (md ? '' : ' empty') + '">' + (md ? esc(md) : '日付を選ぶ') + '</span>'
      + '<input class="tc-date-input" type="date" value="' + esc(iso || '') + '"'
      + ' onclick="try{this.showPicker()}catch(e){}"'
      + ' onchange="TcUi.onDateChange(this);' + (onchangeJs || '') + '">'
      + '</div>';
  }
  function onDateChange(el) {
    var s = el.parentNode.querySelector('.tc-date-show');
    if (!s) return;
    var md = mdShort(el.value);
    s.textContent = md || '日付を選ぶ';
    s.className = 'tc-date-show' + (md ? '' : ' empty');
  }

  /* ── 時刻の見せ方 ─────────────────────────────────────────── */
  function hm(wall) { return wall ? String(wall).slice(11, 16) : ''; }
  function minToHm(min) {
    if (min == null || min === '') return '';
    var m = Math.round(Number(min) || 0), sign = m < 0 ? '-' : '';
    m = Math.abs(m);
    return sign + Math.floor(m / 60) + ':' + ('0' + (m % 60)).slice(-2);
  }
  var DOW = ['日', '月', '火', '水', '木', '金', '土'];
  function dowOf(ymd) { return DOW[new Date(ymd + 'T00:00:00Z').getUTCDay()]; }

  /* ── 紙：★紙だけの新しい窓で刷る★ ─────────────────────────── */
  /**
   * @param {string} title 窓の題（＝紙の名前）
   * @param {string} bodyHtml 紙の中身。★空なら開かない（白紙のダイアログを出さない）★
   */
  /** ★綴じ代の余白★（上 右 下 左）。★綴じる側だけ20mm★・他は10mm */
  var BIND_MM = { left: '10mm 10mm 10mm 20mm', top: '20mm 10mm 10mm 10mm', none: '10mm' };
  function pageMargin(bind) { return BIND_MM[bind] || BIND_MM.left; }

  function printPaper(title, bodyHtml, opts) {
    var body = String(bodyHtml || '').trim();
    if (!body) { toast('刷る中身がありません（先に対象を選んでください）'); return false; }
    var w = global.open('', '_blank');
    if (!w) { toast('新しい窓が開けませんでした（ポップアップの許可が要ります）'); return false; }
    w.document.open();
    w.document.write(
      '<!doctype html><html lang="ja"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>' + esc(title) + '</title><style>'
      /* ★余白は @page だけ★（body にも margin を書くと ★二重になる★。
         2026-08-15 実測: 片側22mm（10+12）で 31日ぶんが ★3枚★ になっていた） */
      /* ★行の高さも詰める★（1行19px→約15px。31日＋見出しで 約120px 減る） */
      + "body{font-family:'Noto Sans JP',system-ui,sans-serif;color:#2B2418;margin:0;font-size:10px;line-height:1.25;}"
      + 'h1{font-size:14px;color:#8F6200;margin:0 0 4px;}'
      + '.sub{font-size:10px;color:#78705C;margin:0 0 6px;display:block;'
      + 'white-space:normal;word-break:normal;overflow-wrap:break-word;}'
      + 'table{border-collapse:collapse;width:100%;}'
      /* ★白黒コピーで読めるようにする★（薄い黄の罫線はコピーでほぼ飛ぶ）
         ＝ ★色ではなく濃さで作る★。見出しは背景ではなく ★太字＋下の太い線★で分ける。 */
      + 'th,td{border:1px solid #999999;padding:1px 4px;text-align:right;white-space:nowrap;}'
      + 'th{background:none;font-weight:700;}'
      /* ★太線は見出しの一番下の行だけ★（月計の各行に出ると うるさい） */
      + 'thead tr:last-child th{border-bottom:2px solid #333333;}'
      /* ★1段目（何の仲間か）は 中央に置いて 細い線で区切る★ */
      + 'thead tr:first-child th.grp{font-size:9px;}'
      /* ★土日と法定休日は薄い網★（★コピーで飛ばない濃さ★） */
      + 'tr.rest td{background:#EEEEEE;}'
      /* ★一番下の合計行★（月計と突き合わせられる） */
      + 'tfoot th,tfoot td{border-top:2px solid #333333;font-weight:700;}'
      /* ★長い備考で列が押し出されないようにする★（はみ出す分は切る＝表は崩さない） */
      + 'table{table-layout:fixed;}td.l{overflow:hidden;text-overflow:ellipsis;}'
      /* ★揃えの決まり（全アプリ共通）★ 数字＝右（既定）／言葉＝左(.l)／1文字の列＝中央(.c)
         ★見出しは中身と同じ揃え★（同じ class が付く）。またがる見出し(.grp)だけ中央 */
      + 'td.l,th.l{text-align:left;}td.c,th.c{text-align:center;}th.grp{text-align:center;}'
      /* ★数字は等幅★（1と8で幅が変わらない＝桁が縦に揃う） */
      + 'td.num,th.num{font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,Consolas,monospace;}'
      + 'td.warn{color:#B3261E;}'
      /* ★2枚になった時は 見出しを2枚目にも出す／1行を2枚に割らない★ */
      + 'thead{display:table-header-group;}tr{break-inside:avoid;page-break-inside:avoid;}'
      /* ★月計は横に並べる★（縦12行だと それだけで紙の1/3を使う） */
      + '.paper-sum{display:flex;gap:12px;align-items:flex-start;margin-top:6px;}'
      + '.paper-sum table{width:auto;}'
      + '.paper-foot{display:block;margin-top:6px;font-size:9px;color:#78705C;}'
      /* ★綴じ代★（2026-08-15 司さんの質問）
         2穴パンチの中心は ★紙の端からおよそ12mm★。★左10mmでは 穴が日付の列にかかる★。
         ⇒ ★綴じる側だけ20mm★・他の3辺は10mm。★どちら綴じかは会社が選ぶ★（左＝ふつう／上／綴じない）。
         ★プリンタの拡大縮小で余白が変わる★ので、画面に「実際のサイズ（100%）で」と出している。 */
      + '@page{size:A4 landscape;margin:' + pageMargin(opts && opts.bind) + ';}'
      + '</style></head><body>' + body + '</body></html>'
    );
    w.document.close();
    w.focus();
    setTimeout(function () { try { w.print(); } catch (e) { /* 端末が拒んでも窓は残す */ } }, 300);
    return true;
  }

  /* ── ファイルを渡す（★渡し口は file-out.js だけ★） ─────────── */
  function deliverText(text, filename) {
    if (!global.FileOut) { toast('ファイルの渡し口が読み込まれていません'); return Promise.reject(new Error('no FileOut')); }
    return global.FileOut.deliver(text, filename).then(function (r) {
      toast('「' + filename + '」を保存しました');
      return r;
    }, function (e) { toast('保存できませんでした: ' + e.message); throw e; });
  }

  /** 押す前に「この名前で保存します」を出すための欄を作る */
  function nameHint(el, filename) {
    if (!el) return;
    el.textContent = 'この名前で保存します: ' + filename;
  }

  global.TcUi = {
    esc: esc, toast: toast, pageMargin: pageMargin, BIND_MM: BIND_MM,
    mdShort: mdShort, dateField: dateField, onDateChange: onDateChange,
    hm: hm, minToHm: minToHm, dowOf: dowOf, DOW: DOW,
    printPaper: printPaper, deliverText: deliverText, nameHint: nameHint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
