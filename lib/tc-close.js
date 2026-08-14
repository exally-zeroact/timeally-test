/* tc-close.js — ★締め（受付中／締め待ち／確定）を決める 1本★（Timeally）
 * =============================================================================
 * ★この3つを決めるのは ここだけ★。画面ごとに if を書かない。
 * ★「押せるか(can)」と「なぜ押せないか(why)」は 同じ1か所から返す★
 *   （2画面で別々に判定すると「確定済」と「まだです」が同時に出る）
 *
 *   受付中(open)     … 締め日より前。打刻できる・直せる
 *   締め待ち(pending)… 締め日は過ぎた。★打刻はできない／直しの申請は出せる★
 *                      社長に「確定する」が出る
 *   確定(closed)     … 数字が動かない。CSV/Excel/紙は この数字。
 *                      ★直すには 解除が要る★
 *
 * ★記録は 追記だけ★（close / reopen / export を足すだけ・消さない・上書きしない）
 *   → 労基法109条（記録は5年（当分の間3年））と同じ考え方。
 *     lib/tc-law.js の RECORD_KEEP_YEARS を見よ。
 *
 * ★時刻★ … 'YYYY-MM-DD'（JST の壁時計）しか受け取らない。
 *            ここに Date.now()/new Date() は書かない（試験が日で変わる物を持たない）。
 *
 * 【利用】ブラウザ window.TcClose / Node require('./tc-close.js')
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./tc-calc.js'));
  } else {
    root.TcClose = factory(root.TcCalc);
  }
})(typeof self !== 'undefined' ? self : this, function (CALC) {
  'use strict';

  var STATES = ['open', 'pending', 'closed'];

  /** 状態の日本語（画面に出す文字も 1か所） */
  var LABEL = { open: '受付中', pending: '締め待ち', closed: '確定' };

  /** 帯の色（★黄は文字色に使わない★＝背景に使い、文字は濃い色） */
  var TONE = { open: 'open', pending: 'wait', closed: 'done' };

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 'YYYY-MM' + 締め日 → その締めの最終日 'YYYY-MM-DD'（末日に寄せるのは tc-calc と同じ1本） */
  function periodOf(ym, closeDay) { return CALC.period(ym, closeDay); }

  /* ── 記録（追記だけ） ─────────────────────────────────────────── */

  /** 記録を古い順に並べる。★元の配列は触らない★（渡した物が書き換わると比べ物が壊れる） */
  function historyOf(log) {
    return (log || []).slice().sort(function (a, b) {
      return String(a.at) < String(b.at) ? -1 : String(a.at) > String(b.at) ? 1 : 0;
    });
  }

  /** 一番新しい action の行（無ければ null） */
  function last(rows, action) {
    for (var i = rows.length - 1; i >= 0; i--) if (rows[i].action === action) return rows[i];
    return null;
  }

  /* ── 状態を決める（ここだけ） ────────────────────────────────── */

  /**
   * @param {object} a {ym, closeDay, today:'YYYY-MM-DD', log:[{action,at,by_uid,reason}]}
   * @returns {object} {state, label, tone, periodFrom, periodTo, can:{}, why:{}, ...}
   */
  function stateOf(a) {
    var ym = a.ym;
    var closeDay = Number(a.closeDay || 31);
    var p = periodOf(ym, closeDay);
    var rows = historyOf(a.log);

    var closeRow = last(rows, 'close');
    var reopenRow = last(rows, 'reopen');
    var exportRow = last(rows, 'export');

    /* ★確定しているか＝「一番新しい 確定」が「一番新しい 解除」より後か★
       （並び順が逆に届いても同じ答えになるよう at で比べる） */
    var isClosed = !!closeRow && (!reopenRow || String(closeRow.at) > String(reopenRow.at));
    var pastDue = String(a.today || '') > p.to;      /* ★締め日の当日は まだ受付中（等号の境目）★ */

    var state = isClosed ? 'closed' : (pastDue ? 'pending' : 'open');

    var can = {
      punch: state === 'open',
      requestFix: state !== 'closed',
      close: state === 'pending',
      reopen: state === 'closed',
      exportCsv: state === 'closed',
    };

    /* ★なぜ押せないかを 同じ所から返す★（画面に「押せない理由」を書かせない） */
    var why = {
      punch: can.punch ? '' : (state === 'pending'
        ? String(closeDay) + '日の締め日を過ぎています。打刻の直しは会社へ言ってください'
        : ym + ' は確定しています。直しは会社へ言ってください'),
      /* ★誰が読んでも同じ意味になる書き方にする★
         （社長の画面に「会社が解除してください」と出ると、自分に向かって言われている事になる）
         ★画面に出す文に ★ は付けない★（★はコードの中の目印で、人に見せる物ではない） */
      requestFix: can.requestFix ? '' : 'この月は確定しています。数字は動きません。直すには 解除が要ります',
      close: can.close ? '' : (state === 'open'
        ? '締め日（' + p.to + '）が来たら 確定できます'
        : 'すでに確定しています'),
      reopen: !can.reopen ? 'まだ確定していません'
        : (exportRow ? 'この月はもう給与へ渡しています。解除すると 渡した数字と食い違います' : ''),
      exportCsv: can.exportCsv ? '' : (state === 'pending' && closeRow
        ? '解除したままです。もう一度 確定してから出してください'
        : '確定してから出してください'),
    };

    return {
      ym: ym, state: state, label: LABEL[state], tone: TONE[state],
      periodFrom: p.from, periodTo: p.to, closeDay: closeDay,
      can: can, why: why,
      closedAt: closeRow && isClosed ? closeRow.at : null,
      closedBy: closeRow && isClosed ? closeRow.by_uid : null,
      reopenedAt: reopenRow && !isClosed ? reopenRow.at : null,
      reopenReason: reopenRow && !isClosed ? reopenRow.reason : null,
      exportedAt: exportRow ? exportRow.at : null,
      history: rows,
    };
  }

  /** ★解除には理由が要る★（空白だけも受け付けない） */
  function canReopen(a) {
    var r = String((a && a.reason) || '').replace(/[\s　]/g, '');
    if (!r) return { ok: false, msg: 'なぜ解除するのか を書いてください（記録に残ります）' };
    if (r.length < 2) return { ok: false, msg: '理由が短すぎます' };
    return { ok: true, msg: '' };
  }

  /* ── 従業員に見せる文（★計算の話を混ぜない★） ──────────────── */

  /**
   * ★従業員の画面に出せるのは この文だけ★
   * 割増・丸め・切り捨て・金額の話は 1文字も入れない（tests/employee-screen が数えている）。
   */
  function employeeNotice(a) {
    if (!a || a.state !== 'closed') return '';
    var m = String(a.ym || '').slice(5).replace(/^0/, '');
    return m + '月は締め切りました。直しは会社へ言ってください';
  }

  /** 記録1行を人が読む文へ（履歴の表示も 1か所） */
  function describe(row) {
    var w = { close: '確定', reopen: '解除', export: '給与へ渡した' }[row.action] || row.action;
    return w + (row.reason ? '（' + row.reason + '）' : '');
  }

  return {
    STATES: STATES, LABEL: LABEL, TONE: TONE,
    stateOf: stateOf, canReopen: canReopen, historyOf: historyOf,
    employeeNotice: employeeNotice, describe: describe, periodOf: periodOf,
  };
});
