/* file-out.js — ★ファイルを客に渡す唯一の口★（種類を正しく付けて、ふつうに落とす）
 *
 * なぜ必要か（2026-08-04・司さんの実機で判明）:
 *   iPhone に Excel が入っているのに、落としたファイルを ★Excelで開けなかった★。
 *   原因は端末ではなく実装で、★種類が application/octet-stream（＝種類の分からないデータ）だった1点★。
 *   iPhone は種類を見てアプリと紐づけるので、Excelが入っていても開けない。
 *
 * ★2026-08-04 に共有シート(navigator.share)をやめました。
 *   一度は「iPhoneは共有シートを出す」形にしたが、★これは間違い★でした。
 *   navigator.share は【人に送る】ための仕組みで【開く】ための仕組みではない。
 *   だからAirDrop・メッセージ・LINEが並ぶ＝客から見て回りくどい。
 *   ★社内の代行請求アプリ(daikou-seikyu.html)が、正しい種類を付けて【ふつうに落とすだけ】で
 *     iPhoneの「"Excel" で開く」を出していました。★ そのやり方に揃えます。
 *   ＝端末で分けない。全部 <a download>。種類を正しく付けるのが本体。
 *
 * 決まり:
 *   ① ★octet-stream を既定にしない。★ 種類の分からない物は落とさせない（拡張子から必ず決める）
 *   ② 端末で分岐しない（pointer や UA を見ない）
 *   ③ ★渡し口はこの1箇所だけ。★ 他の場所で Blob を作らない・writeFile を呼ばない
 *      （tests/ios-unsupported.test.mjs が破りを赤にする）
 *
 * 【利用】window.FileOut.deliver(bytes, 'name.xlsx') → Promise<{how:'download'}>
 */
(function (global) {
  'use strict';

  /* 拡張子 → 種類。★ここに無い拡張子は落とさない（黙って octet-stream にしない）。 */
  var MIME = {
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    /* ★受け取ったブックは、受け取った形のまま返す（2026-08-09 追加）★
       実物(代行計算表2026.xlsb)を開いて保存した時、ここに無くて★保存が止まった★。
       .xlsb を .xlsx として返すと、iPhoneが「Excelで開く」を出さない＝客がファイルを開けない。 */
    xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    xlsb: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
    xls: 'application/vnd.ms-excel',
    csv: 'text/csv',
    txt: 'text/plain',
    pdf: 'application/pdf',
    json: 'application/json',
    png: 'image/png',
  };

  function extOf(filename) {
    var m = /\.([A-Za-z0-9]+)$/.exec(String(filename || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function mimeOf(filename) {
    var e = extOf(filename);
    return MIME[e] || null;      // ★分からなければ null（呼ぶ側で止める）
  }

  function toBlob(data, mime) {
    if (typeof Blob === 'undefined') return null;
    if (data instanceof Blob) return data;
    return new Blob([data], { type: mime });
  }

  /* ★代行請求アプリと同じ形（動いている実物に揃える）。
     後始末（URLの取り消しと要素の削除）は 1.5秒後＝落とし始める前に消えないように。 */
  function anchorDownload(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    /* ★ホーム画面から開いたアプリで、同じ窓にファイルが開いて戻れなくなるのを止める★
       （Kyually が実測して渡してきた物。download が効く端末では target は無視されるので
       　パソコンの落ち方は変わらない。渡し口はここ1箇所なので、ここだけで全部に効く）
       ★未測定★: ホーム画面アプリの実機では未確認。 */
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
    return { how: 'download', type: blob.type, filename: filename };
  }

  /* ファイルを渡す。返りは Promise（共有シートは非同期のため）。
     opts.title … 共有シートの見出し（省略時はファイル名） */
  function deliver(data, filename, opts) {
    opts = opts || {};
    var mime = opts.type || mimeOf(filename);
    if (!mime) {
      // ★種類が分からない物は落とさない。落とすと iPhone で「開けないファイル」になる。
      return Promise.reject(new Error('ファイルの種類が分かりません（' + filename + '）。FileOut.MIME に足してください。'));
    }
    var blob = toBlob(data, mime);
    if (!blob) return Promise.reject(new Error('この環境ではファイルを作れません'));

    // ★端末で分けない。全部これ。種類が正しければ iPhone は「"Excel" で開く」を出す。
    return Promise.resolve(anchorDownload(blob, filename));
  }

  /* ファイル名の日時（YYYYMMDD_HHmm）。★毎回違う名前＝古いダウンロードと見分けがつく。
     代行請求アプリと同じ形。使うかどうかは呼ぶ側が決める。 */
  function stamp(d) {
    d = d || new Date();
    var z = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes());
  }

  global.FileOut = { deliver: deliver, mimeOf: mimeOf, MIME: MIME, stamp: stamp, extOf: extOf };
})(typeof window !== 'undefined' ? window : globalThis);
