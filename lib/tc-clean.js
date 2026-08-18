/* tc-clean.js — ★打った物のうち「使う1本」を決める／おかしい所を言葉にする★（Timeally）
 * =============================================================================
 * なぜ在るのか（2026-08-17 司さんが実機で作った形）:
 *     08/17  08:00 出勤 ／ 08:00 退勤 ／ 08:00 出勤 ／ 17:03 退勤 ／ 21:44 出勤
 *   ★画面は打った物をそのまま並べるだけで、おかしい事を1つも言わなかった★。
 *   数える側（lib/tc-calc.js）は 黙って 0分 にしていた。
 *   ＝★#ERROR より「空になって合計が黙って小さくなる」の方が怖い★（前科あり）。
 *
 * ★守る事★
 *   ① ★打った記録は消さない・書き換えない★（勤怠は給与の元＝証跡）。
 *      ここがやるのは ★「使う／使わない」を決めて、理由を言葉にする★ だけ。
 *   ② ★可否と理由と数は1か所★。従業員の画面も 社長の画面も 数える所も、
 *      ★この1本が返した物★だけを見る（画面ごとに判定を書かない）。
 *   ③ ★ここは長さを1つも数えない★（分・時間・残業・金額の言葉が1つも無い）。
 *      だから ★従業員の画面から読み込んでよい★（tests/employee-screen.test.mjs が見張る）。
 *   ④ ★時刻は壁時計の文字列 'YYYY-MM-DDTHH:mm'★。Date.now()/new Date() を書かない
 *      （試験を走らせた日で答えが変わる物を混ぜない）。
 *
 * ★幅（窓）を いくつにしたか と、その根拠（2026-08-18 実データで測った）★
 *   テスト倉庫の tc_punch ★全402件・6人・打刻の在る日108日★を数えた結果:
 *     ・秒が0でない打刻 … ★0件★（実データは全部00秒。だから「秒だけ違う」は今は起きない）
 *     ・同じ種類が続く物を1本にまとめた時に消える本数
 *         0分以内=1本 ／ 1分=1本 ／ 2分=1本 ／ 3分=1本 ／ 5分=1本 ／ 10分=1本
 *       ＝★0分でも10分でも 結果は同じ（1本）★。★幅は実データでは決められない★。
 *     ・本物の打刻どうしの間は ★最小60分★（60分が92回・180分が44回…）
 *   ⇒ ★3分★にした。理由は「連打を押し直すのに実際かかる時間」であって データではない。
 *     ★本物の最小間隔60分より ずっと小さい★ので、★本物を巻き込まない★事だけは数で言える。
 *   ⇒ まとめる時に ★使う時刻が動いた分★を必ず数えて返す（movedMin）。
 *     ★黙って小さくなる★を作らないため（実データでは 0分）。
 *
 * 【利用】ブラウザ window.TcClean ／ Node require('./tc-clean.js')
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) { module.exports = factory(); }
  else { root.TcClean = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ★連打とみなす幅（分）★ … 上の「根拠」を読んでから変える事 */
  var WINDOW_MIN = 3;

  var KIND_LABEL = {
    in: '出勤', out: '退勤',
    break_in: '休憩に入る', break_out: '休憩から戻る',
    away_in: '私用で外出', away_out: '外出から戻る',
  };

  function toMin(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
  }
  function dayOf(at) { return String(at || '').slice(0, 10); }
  function hmOf(at) { return String(at || '').slice(11, 16); }
  /** 月/日（年は出さない） */
  function mdOf(d) { return (+String(d).slice(5, 7)) + '/' + (+String(d).slice(8, 10)); }

  /* ── ① 並べる（★tc-calc と同じ並べ方★＝同じ時刻は kind の字の順） ───── */
  function sorted(punches) {
    return (punches || []).filter(function (p) { return toMin(p && p.at) != null; })
      .map(function (p, i) {
        return {
          i: i, id: p.id == null ? null : p.id, at: p.at, kind: p.kind,
          src: p.src || 'punch', pending: !!p.pending,
          t: toMin(p.at), use: true, why: '', mergedInto: null,
        };
      })
      .sort(function (a, b) { return a.t - b.t || String(a.kind).localeCompare(String(b.kind)) || a.i - b.i; });
  }

  /** 使う物だけで「出勤〜退勤」を組む（★長さは数えない★＝時刻を並べるだけ） */
  function pairsOf(list) {
    var pairs = [], open = null, strayOut = [];
    list.forEach(function (p) {
      if (p.kind === 'in') {
        if (open) pairs.push({ inAt: open.at, outAt: null, inId: open.id, outId: null });
        open = p;
      } else if (p.kind === 'out') {
        if (!open) { strayOut.push(p); return; }
        pairs.push({ inAt: open.at, outAt: p.at, inId: open.id, outId: p.id });
        open = null;
      }
    });
    if (open) pairs.push({ inAt: open.at, outAt: null, inId: open.id, outId: null });
    return { pairs: pairs, strayOut: strayOut, openLast: open };
  }

  /**
   * ★打った物を掃除して、聞く事を作る★
   * @param {Array} punches [{id, at:'YYYY-MM-DDTHH:mm', kind, src, pending}]
   * @param {object} [opts]
   *   opts.windowMin … 連打とみなす幅（分）。既定 3
   *   opts.today     … 'YYYY-MM-DD'。★今日の最後の「出勤したまま」は聞かない★（まだ働いている）
   * @returns {{windowMin,punches,used,asks,byDay,movedMin}}
   */
  function clean(punches, opts) {
    opts = opts || {};
    var win = opts.windowMin == null ? WINDOW_MIN : Math.max(0, Number(opts.windowMin) || 0);
    var today = opts.today || null;
    var list = sorted(punches);
    var movedMin = 0;

    /* ── ② ★同じ分に 同じ種類が2本以上★ → 後の1本だけ使う ──────────────
       （並べ方で前後が入れ替わっても 同じ答えになる＝同じ分は まとめて見る） */
    var byMinKind = {};
    list.forEach(function (p) {
      var k = p.t + '|' + p.kind;
      (byMinKind[k] = byMinKind[k] || []).push(p);
    });
    Object.keys(byMinKind).forEach(function (k) {
      var arr = byMinKind[k];
      if (arr.length < 2) return;
      var keep = arr[arr.length - 1];
      arr.slice(0, -1).forEach(function (p) {
        p.use = false; p.why = 'merged'; p.mergedInto = keep.at;
      });
    });

    /* ── ③ ★窓の中で 同じ種類が続く★ → 後の1本だけ使う（指示役 2026-08-18）──
       ★使う時刻が後ろへ動いた分を必ず数える★（黙って小さくならないように） */
    var live = list.filter(function (p) { return p.use; });
    for (var i = 1; i < live.length; i++) {
      var a = live[i - 1], b = live[i];
      if (!a.use || a.kind !== b.kind) continue;
      if (b.t - a.t > win) continue;
      a.use = false; a.why = 'merged'; a.mergedInto = b.at;
      movedMin += (b.t - a.t);
    }

    /* ── ④ ★同じ分に 出勤と退勤★ → どちらか決められない（★聞く★） ─────── */
    var asks = [], undecidedMin = {};
    var byMin = {};
    list.filter(function (p) { return p.use; }).forEach(function (p) {
      (byMin[p.t] = byMin[p.t] || []).push(p);
    });
    Object.keys(byMin).forEach(function (t) {
      var arr = byMin[t];
      var pin = arr.filter(function (p) { return p.kind === 'in'; })[0];
      var pout = arr.filter(function (p) { return p.kind === 'out'; })[0];
      if (!pin || !pout) return;
      pin.use = false; pin.why = 'undecided';
      pout.use = false; pout.why = 'undecided';
      undecidedMin[dayOf(pin.at)] = true;
      asks.push({
        d: dayOf(pin.at), type: 'both', at: pin.at, hm: hmOf(pin.at),
        inId: pin.id, outId: pout.id,
        text: hmOf(pin.at) + ' は 出勤と退勤が同じ時刻です。どちらでしたか？',
      });
    });

    /* ── ⑤ 組み立てて 残りの「おかしい所」を作る ──────────────────────
       ★日ごとに切って組まない★（2026-08-18 実データで捕まえた）
       ＝23:50 出勤 → 翌 07:00 退勤 の夜勤を 日ごとに切ると
         「閉じていない出勤」＋「出勤が無い退勤」の ★嘘の質問が2つ★出る
         （テスト倉庫に この形が実際に4件ある）。★並び全体で組む★。 */
    var used = list.filter(function (p) { return p.use; });

    /* ★同じ分の出勤/退勤が決まれば消える物は 聞かない★（質問を積み上げない）
       ＝「出勤だった」「退勤だった」の どちらかで消えるなら、それは この質問の結果。 */
    function derivedAsks(seq) {
      var r = pairsOf(seq), out = [];
      r.strayOut.forEach(function (p) {
        out.push({ type: 'out-only', at: p.at, id: p.id });
      });
      r.pairs.forEach(function (pr) {
        if (pr.outAt == null) out.push({ type: 'open-in', at: pr.inAt, id: pr.inId });
      });
      return out;
    }
    function keyOf(a) { return a.type + '@' + a.at; }

    var mine = derivedAsks(used);
    Object.keys(undecidedMin).forEach(function (dd) {
      var amb = list.filter(function (p) { return p.why === 'undecided' && dayOf(p.at) === dd; });
      ['in', 'out'].forEach(function (asKind) {
        var alt = used.concat(amb.filter(function (p) { return p.kind === asKind; }))
          .sort(function (x, y) { return x.t - y.t || String(x.kind).localeCompare(String(y.kind)); });
        var left = {};
        derivedAsks(alt).forEach(function (a) { left[keyOf(a)] = true; });
        mine = mine.filter(function (a) { return left[keyOf(a)]; });
      });
    });

    mine.forEach(function (a) {
      var d = dayOf(a.at);
      {
        /* ★今日の いちばん最後の「出勤したまま」★は ★まだ働いている★だけかもしれない。
           ＝★消さずに 言い方だけ変える★（soft）。★今 退勤にする★を出せるのも この時だけ
           （前の日の出勤に「今」の時刻で退勤を入れると ★日をまたぐ長い勤務★を作ってしまう）。 */
        var isLast = used.length && used[used.length - 1].at === a.at && used[used.length - 1].kind === 'in';
        var soft = a.type === 'open-in' && !!today && d === today && !!isLast;
        asks.push({
          d: d, type: a.type, at: a.at, hm: hmOf(a.at), id: a.id, soft: soft,
          text: a.type !== 'open-in'
            ? hmOf(a.at) + ' の退勤に、出勤が入っていません'
            : soft
              ? hmOf(a.at) + ' の出勤に、まだ退勤が入っていません（まだお仕事中なら そのままで大丈夫です）'
              : hmOf(a.at) + ' の出勤に、まだ退勤が入っていません',
        });
      }
    });

    asks.sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (toMin(a.at) - toMin(b.at)); });

    /* ── ⑥ 日ごとにまとめる（★画面はこれだけ見る★） ───────────────── */
    var byDay = {};
    function day(d) {
      if (!byDay[d]) {
        byDay[d] = { d: d, undecided: false, merged: 0, asks: [], used: [], pairs: [], answer: null };
      }
      return byDay[d];
    }
    list.forEach(function (p) {
      var x = day(dayOf(p.at));
      if (p.why === 'merged') x.merged++;
      if (p.why === 'undecided') x.undecided = true;
      if (p.use) x.used.push(p);
    });
    asks.forEach(function (a) { day(a.d).asks.push(a); });
    /* ★組むのは並び全体★／★日をまたぐ勤務は「出勤した日」に付ける★（tc-calc と同じ線）
       ＝日ごとに切って組むと 夜勤が「片方だけ」に見える（実データで捕まえた）。 */
    var whole = pairsOf(used);
    whole.pairs.forEach(function (pr) { day(dayOf(pr.inAt)).pairs.push(pr); });
    whole.strayOut.forEach(function (p) { day(dayOf(p.at)); });

    return {
      windowMin: win, punches: list, used: used, asks: asks, byDay: byDay, movedMin: movedMin,
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════
     ★ミスが起きてからの対処より先に、ミスが起きない作り★（2026-08-18 司さん）
       「出勤押してもないのに退勤おせるとか」
       「時間変更する前に間違えて押した時の仕様を見直すべきやろ」
     ★状態を出すのは この1本だけ★（画面と数える所で別々に判定しない）。
     ★ここも 長さは1つも数えない★（従業員の画面から読んでよい）。
     ═══════════════════════════════════════════════════════════════════════ */

  /* 打った物 → 今の状態（★使う打刻だけで決める★＝まとめた物・決められない物は数えない） */
  var STATE_LABEL = {
    out: 'まだ出勤していません', in: '出勤中', away: '外出中', brk: '休憩中',
  };
  function nextState(kind) {
    if (kind === 'in') return 'in';
    if (kind === 'out') return 'out';
    if (kind === 'away_in') return 'away';
    if (kind === 'away_out') return 'in';
    if (kind === 'break_in') return 'brk';
    if (kind === 'break_out') return 'in';
    return null;
  }
  /* ★その状態で押してよい物★（これ以外は 画面に出さない／出すなら灰色＋理由） */
  var ALLOW = {
    out: ['in'],
    in: ['out', 'away_in'],
    away: ['away_out'],
    brk: ['break_out', 'out'],
  };
  /* ★押せない理由は ここに1つだけ書く★（画面で言い換えない） */
  var DENY = {
    out: '先に出勤を打ってください（打ち忘れた分は「記録へ」からお願いを出せます）',
    in: '出勤中です。先に退勤か 外出から戻るを打ってください',
    away: '外出中です。先に「外出から戻る」を打ってください',
    brk: '休憩中です。先に「休憩から戻る」を打ってください',
  };

  /**
   * ★今の状態と 押してよい物★
   * @param {Array} punches 自分の打刻（新しい日付を含む数日ぶん）
   * @param {object} [opts] opts.windowMin … clean と同じ幅
   */
  function stateOf(punches, opts) {
    var res = clean(punches, opts || {});
    var used = res.used;
    var state = 'out', lastAt = null, lastKind = null;
    used.forEach(function (p) {
      var s = nextState(p.kind);
      if (!s) return;
      state = s; lastAt = p.at; lastKind = p.kind;
    });
    var allow = {};
    ['in', 'out', 'away_in', 'away_out', 'break_in', 'break_out'].forEach(function (k) {
      allow[k] = ALLOW[state].indexOf(k) >= 0;
    });
    return {
      state: state, label: STATE_LABEL[state], deny: DENY[state],
      lastAt: lastAt, lastKind: lastKind, allow: allow, clean: res,
    };
  }

  /** ★選んだ時刻は「最後に打った時刻より後」だけ★（打つ画面で 過去へ戻らせない）
   *  ＝2026-08-17 の事故は ★打つ画面の時刻を朝へ戻して押した★ 事から起きている。
   *    実データで測った: この決まりを入れると あの5本のうち ★4本が そもそも入らない★
   *    ＝聞く事 2件 → 1件（「決められない日」が丸ごと消える）。
   *  ★打ち忘れの逃げ道は「あとから入れる」1本に寄せる★（退勤を押させて後で聞かない）。 */
  function timeOk(st, wallTime) {
    var t = toMin(wallTime);
    if (t == null) return { ok: false, why: '時刻を選んでください' };
    if (!st || !st.lastAt) return { ok: true, why: '' };
    if (t > toMin(st.lastAt)) return { ok: true, why: '' };
    return {
      ok: false,
      why: '最後に打ったのは ' + hmOf(st.lastAt) + ' です。それより後の時刻にしてください'
        + '（打ち忘れた分は「記録へ」からお願いを出せます）',
    };
  }

  /* ── ⑦ ★その日の結論を1行★（★時刻だけ★・長さは数えない） ──────────
     ★決められない日は「決められません」と出す★（勝手に0にしない・黙って空にしない）。
     ★数えた長さを足すのは 社長の画面だけ★（lib/tc-calc.js の値を後ろに付ける）。 */
  function daySentence(dayInfo, d) {
    var x = dayInfo || { undecided: false, pairs: [], asks: [] };
    var md = mdOf(d);
    if (x.undecided) {
      /* ★すぐ下に同じ質問が出る★ので、ここでは ★何が決まっていないか★だけを短く言う
         （同じ文を2回 並べない＝実物を撮って気づいた） */
      var b = (x.asks || []).filter(function (a) { return a.type === 'both'; })[0];
      return md + ' は 決められません（'
        + (b ? b.hm + ' が 出勤か退勤か 決まっていません' : '打った物が食い違っています') + '）';
    }
    var full = (x.pairs || []).filter(function (p) { return p.inAt && p.outAt; });
    var open = (x.pairs || []).filter(function (p) { return p.inAt && !p.outAt; });
    /* ★組めなかった日は「打刻がありません」と言わない★（打刻は在る＝聞いている事を出す）
       ＝★黙って空にする★の反対側。理由をそのまま出す。 */
    if (!x.pairs || !x.pairs.length) {
      return (x.asks && x.asks.length)
        ? md + ' は 決められません（' + x.asks[0].text + '）'
        : md + ' は 打刻がありません';
    }
    if (!full.length && open.length) return md + ' は ' + hmOf(open[0].inAt) + ' の出勤だけが残っています';
    var s = md + ' は ' + full.map(function (p) {
      return hmOf(p.inAt) + '〜' + hmOf(p.outAt);
    }).join('・') + ' として記録します';
    if (open.length) s += '（' + hmOf(open[0].inAt) + ' の出勤は まだ退勤が入っていません）';
    return s;
  }

  /** ★「どちらでしたか？」の答えを押した時、その日がどうなるか★（根拠を先に見せる） */
  function previewOf(res, ask, asKind) {
    var keepId = asKind === 'in' ? ask.inId : ask.outId;
    var list = res.punches.filter(function (p) {
      if (p.why === 'merged') return false;
      if (p.why === 'undecided') return p.id === keepId;
      return p.use;
    }).filter(function (p) { return dayOf(p.at) === ask.d; });
    var r = pairsOf(list);
    var full = r.pairs.filter(function (p) { return p.inAt && p.outAt; });
    if (full.length) {
      return full.map(function (p) { return hmOf(p.inAt) + '〜' + hmOf(p.outAt); }).join('・') + ' になります';
    }
    if (r.strayOut.length) return hmOf(r.strayOut[0].at) + ' の退勤に 出勤が入らないままになります';
    if (r.pairs.length) return hmOf(r.pairs[0].inAt) + ' の出勤に 退勤が入らないままになります';
    return 'この日は何も残りません';
  }

  /* ★打った直後の「取り消す」を出しておく長さ（秒）★
     ★実データで測った★（テスト倉庫 tc_punch・created_at の間隔）:
       その場で押した打刻は ★2本しか無い★（残り400本は種まき・後入れ）。
       司さんが 08/17 に ★押し直した間隔は 1.8 / 2.7 / 10.8 / 11.9 秒★（最大11.9秒）。
     ⇒ ★60秒★（実測の最大の5倍以上の余裕）。★取り消せる間は 会社に何も出さない★。
     ★倉庫の側でも同じ秒で門を作る★（画面だけで止めると 直に叩けば通る）。 */
  var UNDO_SEC = 60;

  return {
    WINDOW_MIN: WINDOW_MIN, UNDO_SEC: UNDO_SEC, KIND_LABEL: KIND_LABEL,
    STATE_LABEL: STATE_LABEL, ALLOW: ALLOW, DENY: DENY,
    toMin: toMin, dayOf: dayOf, hmOf: hmOf, mdOf: mdOf,
    sorted: sorted, pairsOf: pairsOf, nextState: nextState,
    clean: clean, stateOf: stateOf, timeOk: timeOk,
    daySentence: daySentence, previewOf: previewOf,
  };
});
