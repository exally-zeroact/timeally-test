/* emp-app.js — ★従業員の画面（打つ／自分の記録）★（Timeally）
 * =============================================================================
 * ★この画面が出してよいのは「本人が打った時刻」だけ★
 *   数えた結果（働いた長さ・追加ぶん・夜の分・お金）は ★1つも出さない★。
 *   だから ★従業員は嘘の数字を一度も見ない★。
 *   守り方は2重:
 *     ① 倉庫のRPC(tc_my_punches)が ★時刻しか返さない★（画面を直しても漏れない）
 *     ② tests/employee-screen.test.mjs が ★この画面の言葉を機械で数える★
 *
 * 入口の作りは payslip-app の実績のある形をなぞっている:
 *   リンク(?t=…)＋★暗証番号(数字4〜6桁)★＋端末を覚える
 *   ＋5回間違えたら15分あかない。★平文はどこにも持たない★
 *
 * 【利用】window.EmpApp
 */
(function (global) {
  'use strict';

  var d = global.document;
  var U = global.TcUi;
  var DB = global.TcDb;

  var st = { token: '', device: '', pw: '', name: '', ym: '', notice: '', state: 'open' };

  function q(id) { return d.getElementById(id); }
  function param(k) {
    var m = new RegExp('[?&]' + k + '=([^&]*)').exec(global.location.search);
    return m ? decodeURIComponent(m[1]) : '';
  }
  function devKey() { return 'tc_dev_' + st.token; }

  /** ★中身が空なら 箱ごと消す★
      .tc-note には枠が付いているので ★文字を空にしただけでは「空の枠」が残る★。
      2026-08-15 実配信で出た（★暗証番号あり・端末を忘れた★人の入口に、
      何も書いていない箱が1つ余分に見えていた）。 */
  function setNote(id, msg) {
    var el = q(id);
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function alertBox(msg) {
    var el = q('gate-alert');
    if (!el) { U.toast(msg); return; }
    el.textContent = msg;
    el.hidden = !msg;
  }

  /* 5回で15分あかない、を人の言葉で伝える */
  function reason(r) {
    if (!r) return 'うまくいきませんでした。もう一度お試しください。';
    if (r.locked) return 'まちがいが続いたので、15分ほどお待ちください。';
    /* ★止める理由は lib/tc-pin.js が持つ★（画面で桁を書かない＝2か所に書かない） */
    if (r.bad_pin) return global.TcPin.check('1').msg;
    if (r.already_set) return 'すでに決まっています。暗証番号を入れて入ってください。';
    if (r.remaining != null) return '暗証番号が違います。あと' + r.remaining + '回。';
    if (r.future) return 'これから先の時刻は入れられません。';
    /* ★締め切った後★ … 出す文は「締め切りました」だけ。
       ★なぜ締めたか・どう数えるかの話は 1文字も出さない★（倉庫が返す文をそのまま使う） */
    if (r.closed) return st.notice || '締め切りました。直しは会社へ言ってください。';
    return 'うまくいきませんでした。会社にお伝えください。';
  }

  /** ★締め切りの知らせを出す（打つ前に分かるように）★ 出るのは1文だけ */
  function drawNotice() {
    var el = q('closed-note');
    if (el) {
      el.textContent = st.notice || '';
      el.hidden = !st.notice;
    }
    /* ★締めた後は 足せない★（倉庫も断るが、押せてしまうと「入れたのに入らない」と思われる）
       ★押せる/押せないを決めるのは drawAdd の1本だけ★ */
    if (q('b-add')) drawAdd();
  }

  /* ── 入口 ─────────────────────────────────────────────────── */
  function openGate(mode) {
    var g = q('gate');
    if (!g) return;
    g.hidden = false;
    var first = q('gate-first'), again = q('gate-again');
    if (first) first.hidden = mode !== 'first';
    if (again) again.hidden = mode === 'first';
    var t = q('gate-title');
    if (t) t.textContent = mode === 'first' ? 'はじめての方' : '暗証番号';
    /* ★記録の画面には 暗証番号を決める所を置かない★（入口は1か所）。
       決める場所（打つ画面）へ ★?t= を落とさずに★ 渡し、★決め終わったらここへ戻す★。 */
    var go = q('to-setpw');
    if (go && st.token) {
      go.href = 'punch.html?t=' + encodeURIComponent(st.token) + '&back=kiroku';
    }
  }
  function closeGate() {
    var g = q('gate');
    if (g) g.hidden = true;
    var m = q('main');
    if (m) m.hidden = false;
  }

  function begin(after) {
    st.token = param('t');
    st.device = global.localStorage ? (global.localStorage.getItem(devKey()) || '') : '';
    if (!st.token) { alertBox('リンクが正しくありません。会社にお伝えください。'); return; }

    DB.Emp.info(st.token).then(function (info) {
      if (info && info.found) {
        st.name = info.name || '';
        /* ★文を作るのは倉庫の1か所★（画面で組み立てない＝言葉が2通りにならない） */
        st.notice = info.notice || '';
        st.state = info.state || 'open';
        /* ★長すぎの線は 会社の1日の決まりから★（画面と数える所で 同じ線にする） */
        if (info.day_std_min) _dayStdMin = Number(info.day_std_min) || 0;
        drawNotice();
        var w = q('who');
        if (w) w.textContent = (info.company ? info.company + ' / ' : '') + st.name;
        var h = q('hello');
        if (h) h.textContent = st.name ? st.name + 'さん、おつかれさまです。' : 'おつかれさまです。';
      }
      return DB.Emp.auth(st.token, st.device);
    }).then(function (a) {
      if (!a || !a.found) { alertBox('このリンクは使えません。会社にお伝えください。'); return; }
      if (a.locked) { openGate(a.has_password ? 'again' : 'first'); alertBox('まちがいが続いたので、15分ほどお待ちください。'); return; }
      if (a.remembered) { closeGate(); after(); return; }
      openGate(a.has_password ? 'again' : 'first');
      setNote('gate-note', a.has_password ? '' : 'これから使う暗証番号を決めてください。次からは これだけで入れます。');
    }).catch(function (e) { alertBox('つながりませんでした（' + e.message + '）'); });

    /* ★決める（初回だけ）★ … 決めたら そのまま入る（続けて もう一度 打たせない） */
    var setpin = q('b-setpin');
    if (setpin) setpin.onclick = function () {
      var v = global.TcPin.checkPair(q('pin1').value, q('pin2').value);
      if (!v.ok) { alertBox(v.msg); return; }
      DB.Emp.setPin(st.token, v.pin).then(function (r) {
        if (!r || !r.ok) { alertBox(reason(r)); return; }
        remember(r.device_token);
        /* ★記録の画面から来た人は 元の画面へ戻す★（決めさせた所で放り出さない） */
        if (param('back') === 'kiroku') {
          global.location.href = 'kiroku.html?t=' + encodeURIComponent(st.token);
          return;
        }
        closeGate(); after();
      }).catch(function (e) { alertBox('つながりませんでした（' + e.message + '）'); });
    };
    var ver = q('b-verify');
    if (ver) ver.onclick = function () {
      var v = global.TcPin.check(q('pin').value);
      if (!v.ok) { alertBox(v.msg); return; }
      DB.Emp.verify(st.token, v.pin).then(function (r) {
        if (!r || !r.ok) { alertBox(reason(r)); return; }
        remember(r.device_token); closeGate(); after();
      }).catch(function (e) { alertBox('つながりませんでした（' + e.message + '）'); });
    };
  }
  function remember(dev) {
    st.device = dev || '';
    if (global.localStorage && st.device) global.localStorage.setItem(devKey(), st.device);
  }

  /* ── ① 打つ ───────────────────────────────────────────────────────────
     ★ミスが起きてからの対処より先に、ミスが起きない作り★（2026-08-18 司さん）
       A ★いまの状態で押してよい物だけ出す★（出勤していない人に退勤を押させない）
       B ★打った直後60秒は「取り消す」★（★取り消したら会社には何も出ない★）
       C ★連打を受け付けない★（押せない事を 見て分かる形で出す）
       E ★選べる時刻は「最後に打った時刻より後」だけ★（打つ画面で過去へ戻らせない）
     ★状態も 押せる/押せない理由も lib/tc-clean.js が1か所で持つ★（画面で言い換えない）。 */
  var PUNCH_BTN = [['b-in', 'in', '出勤'], ['b-out', 'out', '退勤'],
    ['b-ain', 'away_in', '私用で外出'], ['b-aout', 'away_out', '外出から戻る']];
  /* ★その状態で「灰色にして理由を出す」物★（これ以外の押せない物は そもそも出さない）
     ＝出勤していない人に「退勤」を ★見せるが押させない★（なぜ押せないかを覚えてもらう） */
  var GREY = { out: ['out'], in: [], away: ['out'], brk: [] };
  var _now = null;        // いまの状態（TcClean.stateOf の返り値）
  var _undo = null;       // 打った直後の取り消し {id, kind, hm, until, timer}
  var _tTouched = false;  // ★時刻欄を人が自分で選んだか★（選んだ物は上書きしない）

  /** 人が触っていない時刻欄を「いま」に合わせる（合ったら描き直す） */
  function tickNow() {
    var t = q('t');
    if (!t || _tTouched) return;
    var hm = (DB.nowJst() || '').slice(11, 16);
    if (!hm || t.value === hm) return;
    t.value = hm;
    drawPunch();
  }

  function startPunch() {
    begin(function () {
      var link = q('to-kiroku');
      if (link) link.href = 'kiroku.html?t=' + encodeURIComponent(st.token);
      var fix = q('to-fix');
      if (fix) fix.href = 'kiroku.html?t=' + encodeURIComponent(st.token);
      var t = q('t');
      if (t) {
        if (!t.value) t.value = (DB.nowJst() || '').slice(11, 16);   // ★いまの時刻。直せる★
        t.onchange = function () { _tTouched = true; drawPunch(); };
        t.oninput = function () { _tTouched = true; drawPunch(); };
      }
      /* ★人が触っていない間は 時刻欄を「いま」に追従させる★（2026-08-18 実配信で見つけた）
         ＝出勤した直後は ★同じ分★なので「最後より後」を満たさず 退勤が押せない。
           1分たてば押せるが、★欄が止まっていると いつまでも押せない★。
           ★人が自分で選んだ時刻は 上書きしない★（_tTouched） */
      if (global.setInterval) global.setInterval(tickNow, 15000);
      PUNCH_BTN.forEach(function (p) {
        var b = q(p[0]);
        if (b) b.onclick = function () { push(p[1], p[2], b); };
      });
      var u = q('b-undo');
      if (u) u.onclick = undoLast;
      drawNotice();
      var f = q('b-forget');
      if (f) f.onclick = function () {
        if (global.localStorage) global.localStorage.removeItem(devKey());
        st.device = '';
        U.toast('この端末を忘れました。次から暗証番号を聞きます。');
      };
      loadState();
    });
  }

  /** ★いまの状態を取り直す★（打刻は倉庫が正・画面で組み立てない）
      前の日から見る＝夜勤（23:50 出勤 → 翌 07:00 退勤）でも「出勤中」が続く。 */
  function loadState() {
    var today = (DB.nowJst() || '').slice(0, 10);
    var from = new Date(Date.parse(today + 'T00:00:00Z') - 2 * 86400000).toISOString().slice(0, 10);
    return DB.Emp.mine(st.token, st.device, st.pw, from, today).then(function (r) {
      if (!r || r.unauth) { _now = null; drawPunch(); return; }
      _now = global.TcClean.stateOf(r.punches || [], { today: today });
      drawPunch();
    }).catch(function () { _now = null; drawPunch(); });
  }

  /** ★押せる物・押せない理由・取り消しの箱★を描く（★描くのはここ1か所★） */
  function drawPunch() {
    var closed = st.state !== 'open';
    var sn = q('state-now');
    if (sn) {
      sn.textContent = !_now ? ''
        : _now.state === 'in' && _now.lastAt ? _now.label + '（' + global.TcClean.hmOf(_now.lastAt) + ' から）'
          : _now.label;
      sn.hidden = !sn.textContent;
    }
    /* ★E★ 選んだ時刻が 最後に打った時刻より後か */
    var today = (DB.nowJst() || '').slice(0, 10);
    var hm = (q('t') || {}).value || '';
    var tOk = hm ? global.TcClean.timeOk(_now, today + 'T' + hm) : { ok: false, why: '時刻を選んでください' };
    var tw = q('t-why');
    if (tw) { tw.textContent = tOk.ok ? '' : tOk.why; tw.hidden = tOk.ok; }

    var grey = [];
    PUNCH_BTN.forEach(function (p) {
      var b = q(p[0]);
      if (!b) return;
      var allowed = _now ? _now.allow[p[1]] : p[1] === 'in';
      var greyed = _now ? GREY[_now.state].indexOf(p[1]) >= 0 : p[1] === 'out';
      /* ★C★ いま打ったばかりの物は 押せない（見て分かる形で） */
      var justNow = _undo && _undo.kind === p[1];
      b.hidden = !allowed && !greyed;
      b.disabled = !allowed || closed || !tOk.ok || justNow;
      b.className = 'tc-btn' + (allowed && p[1] !== 'in' && p[1] !== 'out' ? ' sub' : '')
        + (allowed && !b.disabled ? ' main' : '');
      b.textContent = justNow ? p[2] + '（いま打ちました）' : p[2];
      if (greyed && !allowed) grey.push(p[2]);
    });
    var dw = q('deny-why');
    if (dw) {
      var why = closed ? '' : (grey.length && _now ? _now.deny : '');
      dw.textContent = why;
      dw.hidden = !why;
    }
    var fix = q('to-fix');
    if (fix) fix.hidden = !(_now && _now.state === 'in');
    drawUndo();
  }

  /** ★打った直後の取り消し★（残り秒を出す。0になったら箱ごと消す） */
  function drawUndo() {
    var box = q('undo'), what = q('undo-what');
    if (!box) return;
    if (!_undo) { box.hidden = true; if (what) what.textContent = ''; return; }
    var left = Math.max(0, Math.ceil((_undo.until - Date.now()) / 1000));
    if (left <= 0) { clearUndo(); return; }
    box.hidden = false;
    if (what) {
      what.textContent = _undo.hm + ' ' + KIND_LABEL[_undo.kind] + ' で打ちました'
        + '（あと ' + left + ' 秒 取り消せます）';
    }
  }
  function clearUndo() {
    if (_undo && _undo.timer) global.clearInterval(_undo.timer);
    _undo = null;
    var box = q('undo');
    if (box) { box.hidden = true; }
    drawPunch();
  }

  function push(kind, label, btn) {
    var hm = (q('t') || {}).value || (DB.nowJst() || '').slice(11, 16);
    var today = (DB.nowJst() || '').slice(0, 10);
    /* ★E★ 画面でも止める（倉庫が断る前に、なぜ駄目かを出す） */
    var tOk = global.TcClean.timeOk(_now, today + 'T' + hm);
    if (!tOk.ok) { U.toast(tOk.why); drawPunch(); return; }
    if (btn) btn.disabled = true;
    DB.Emp.punch(st.token, st.device, st.pw, today + 'T' + hm, kind, 'punch')
      .then(function (r) {
        if (!r || !r.ok) { U.toast(reason(r)); return; }
        /* ★B★ 打った直後だけ 取り消せる（会社には何も出ない） */
        if (_undo && _undo.timer) global.clearInterval(_undo.timer);
        _undo = {
          id: r.id, kind: kind, hm: hm,
          until: Date.now() + global.TcClean.UNDO_SEC * 1000, timer: null,
        };
        _undo.timer = global.setInterval(drawUndo, 1000);
        /* ★打ったら 時刻欄は「いま」に戻す★（次の1本は いまの時刻から選ぶ） */
        _tTouched = false;
        return loadState();
      })
      .catch(function (e) { U.toast('つながりませんでした（' + e.message + '）'); })
      .then(function () { drawPunch(); });
  }

  function undoLast() {
    if (!_undo) return;
    var id = _undo.id;
    var b = q('b-undo');
    if (b) b.disabled = true;
    DB.Emp.undo(st.token, st.device, st.pw, id).then(function (r) {
      if (!r || !r.ok) {
        U.toast(r && r.too_late ? '取り消せる時間が過ぎました。「記録へ」から直せます。'
          : '取り消せませんでした。');
        clearUndo();
        return loadState();
      }
      U.toast('取り消しました。記録には残りません。');
      clearUndo();
      return loadState();
    }).catch(function (e) { U.toast('つながりませんでした（' + e.message + '）'); })
      .then(function () { if (b) b.disabled = false; });
  }

  /* ── ② 自分の記録（★打った時刻を並べるだけ★） ───────────────── */
  var KIND_LABEL = {
    in: '出勤', out: '退勤',
    break_in: '休憩に入る', break_out: '休憩から戻る',
    away_in: '私用で外出', away_out: '外出から戻る',
  };

  function startKiroku() {
    begin(function () {
      st.ym = (DB.nowJst() || '').slice(0, 7);
      var link = q('to-punch');
      if (link) link.href = 'punch.html?t=' + encodeURIComponent(st.token);
      var wrap = q('ad-wrap');
      if (wrap) wrap.innerHTML = U.dateField((DB.nowJst() || '').slice(0, 10), '');
      q('b-prev').onclick = function () { shift(-1); };
      q('b-next').onclick = function () { shift(1); };
      q('b-add').onclick = addLater;
      /* ★あとから入れるは 既定で畳む★（押した時だけ開く・開いたら打刻の直しは閉じる） */
      var ao = q('b-addopen');
      if (ao) {
        ao.onclick = function () {
          _addOpen = !_addOpen;
          if (_addOpen) { _openPid = null; _fixStep = 'menu'; draw(); }
          drawAdd();
        };
      }
      /* ★D★ 日・時刻・どれ が揃うまで「足す」は押せない＋押す前に1行 見せる */
      ['at', 'ak', 'ar'].forEach(function (id) {
        var el = q(id);
        if (el) { el.oninput = drawAdd; el.onchange = drawAdd; }
      });
      var dwrap = d.querySelector('#ad-wrap .tc-date-input');
      if (dwrap) {
        var prev = dwrap.getAttribute('onchange') || '';
        dwrap.setAttribute('onchange', prev + 'EmpApp.onAddChange();');
      }
      drawNotice();
      drawAdd();
      draw();
    });
  }
  function shift(n) {
    var y = +st.ym.slice(0, 4), m = +st.ym.slice(5, 7) + n;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    st.ym = y + '-' + ('0' + m).slice(-2);
    draw();
  }
  /* ── ★おかしい所は 画面が先に言う★（2026-08-18 司さんの実機の形） ──────
     ★聞いてあげる。埋めさせない★＝空欄を出して打ち直させず、★押すだけで決まる★。
     ★何がおかしいか の判定と 文は lib/tc-clean.js が1か所で持つ★
     （社長の画面・数える所と ★同じ物★を見る＝食い違わない）。
     ★1問ごとに保存★（最後まで行かないと保存されない、を作らない）。
     ★押したら その場で記録に入る★（2026-08-18 夜3・決まりは1つ）。 */
  var _asks = [];                                   // 画面に出している質問（押した時に引く）
  /* ★もう答えた質問★（この画面を開いている間だけ覚える）
     ＝答えると その場で記録が変わるが、★何を答えたかは そのまま残す★。
     何も言わないと ★同じ物を何回も押してしまう★（連打を直す機能で連打を作らない）。 */
  var _answered = {};
  function askKey(a) { return a.type + '@' + a.at; }
  /* ★時刻そのものを直す★ … 開いている打刻／機械が見つけた分／自分の打刻ぜんぶ */
  var _openPid = null;
  var _fixStep = 'menu';   // ★開いた打刻の段★（menu＝2つだけ／pick＝候補を出す）
  var _addOpen = false;    // ★「あとから入れる」を開いているか★（既定は畳む）
  var _issues = [];
  var _all = [];
  var _dayStdMin = 0;     // 会社の1日の決まり（tc_pub_info が返す。長すぎの線に使う）

  function askHtml(a, n, res) {
    var head = '<div class="tc-askq">' + U.esc(a.text) + '</div>';
    if (_answered[askKey(a)]) {
      return '<div class="tc-ask">' + head + '<div class="tc-askwhy">直しました。</div></div>';
    }
    var btn = function (id, label, why) {
      return '<button class="tc-btn sub" type="button" id="' + id + '">' + U.esc(label) + '</button>'
        + (why ? '<span class="tc-askwhy">' + U.esc(why) + '</span>' : '');
    };
    var rows = '';
    if (a.type === 'both') {
      /* ★当てた物は根拠つきで見せる★＝押すと どうなるかを 先に出す */
      rows = btn('ask' + n + '-in', '出勤でした', global.TcClean.previewOf(res, a, 'in'))
        + btn('ask' + n + '-out', '退勤でした', global.TcClean.previewOf(res, a, 'out'));
    } else if (a.type === 'open-in') {
      /* ★「今 退勤にする」は 今日の分だけ★（前の日に「今」を入れると 日をまたぐ形になる）
         ★「この出勤を取り消す」はここに置かない★（2026-08-18 夜 司さん「複雑すぎんか？」）
         ＝打刻の行を押した中の［これは間違い（取り消す）］と ★同じ事をする物が2つ★になる。 */
      rows = (a.soft ? btn('ask' + n + '-now', '今 退勤にする', '') : '')
        + '<span class="tc-askpick"><input type="time" step="60" id="ask' + n + '-t" />'
        + btn('ask' + n + '-pick', 'この時刻に退勤', '') + '</span>';
    } else {
      rows = '<span class="tc-askpick"><input type="time" step="60" id="ask' + n + '-t" />'
        + btn('ask' + n + '-pick', 'この時刻に出勤', '') + '</span>';
    }
    return '<div class="tc-ask">' + head + '<div class="tc-askrow">' + rows + '</div></div>';
  }

  /* ── ★時刻そのものを直す★（2026-08-18）────────────────────────
     ・★元の行は消さない★＝新しい時刻の行を1本 足して、元には印を付ける
     ・★空欄を出さない★＝候補を先に出す（いつもの時刻／前後15分／いま）
     ・★選ぶまで「直す」は押せない★
     ・★押す前に1行★「8/17 の 08:00 出勤 を 07:30 に直します」 */
  /* ★出す量を減らす（2026-08-18 夜 司さん「なんか複雑すぎんか？」）★
     ・開いた時に出るのは ★2つだけ★（時刻を直す／これは間違い）
     ・★候補は「時刻を直す」を押してから★出す（＝1画面に押せる物を積まない）
     ・閉じるのは 行の右端の「×」 */
  function fixPanelHtml(p) {
    var K = KIND_LABEL[p.kind] || p.kind;
    var head = '<div class="tc-askq">'
      + U.esc(global.TcClean.mdOf(global.TcClean.dayOf(p.at)) + ' の '
        + global.TcClean.hmOf(p.at) + ' ' + K + ' を どうしますか？') + '</div>';
    if (_fixStep !== 'pick') {
      return '<div class="tc-ask">' + head + '<div class="tc-askrow">'
        + '<button class="tc-btn sub" type="button" id="fix-open">時刻を直す</button>'
        + '<button class="tc-btn danger" type="button" id="fix-drop">消す</button>'
        + '</div></div>';
    }
    var cands = global.TcClean.fixCandidates(_all, p, { nowHm: (DB.nowJst() || '').slice(11, 16) });
    /* ★候補は「時刻（理由）」で1つのボタン★（理由を別の行に出すと 画面が縦に伸びる） */
    var btns = cands.map(function (c, i) {
      return '<button class="tc-btn sub" type="button" id="fix-c' + i + '" data-hm="' + U.esc(c.hm) + '">'
        + U.esc(c.hm + '（' + c.why + '）') + '</button>';
    }).join('');
    return '<div class="tc-ask">' + head
      + '<div class="tc-askrow">' + btns
      + '<span class="tc-askpick"><input type="time" step="60" id="fix-t" />'
      + '<button class="tc-btn sub" type="button" id="fix-pick">この時刻にする</button></span>'
      + '</div>'
      + '<div class="tc-note" id="fix-why"></div>'
      + '<p><button class="tc-btn wide" type="button" id="fix-send" disabled>直す</button></p>'
      + '</div>';
  }

  /** ★機械が先に気づいて聞く★（長すぎ／短すぎ／退勤が出勤より前） */
  function issueHtml(x, n) {
    if (_answered['issue@' + x.type + '@' + x.at]) {
      return '<div class="tc-ask"><div class="tc-askq">' + U.esc(x.text) + '</div>'
        + '<div class="tc-askwhy">直しました。</div></div>';
    }
    return '<div class="tc-ask"><div class="tc-askq">' + U.esc(x.text) + '</div>'
      + '<div class="tc-askrow">'
      + '<button class="tc-btn sub" type="button" id="iss' + n + '-ok">合っている</button>'
      + '<button class="tc-btn sub" type="button" id="iss' + n + '-fix">直す</button>'
      + '</div></div>';
  }

  /** 開いた打刻の中の「直す」を配線する（★選ぶまで出せない★） */
  function bindFixPanel() {
    var p = _all.filter(function (x) { return x.id === _openPid; })[0];
    if (!p) return;
    var picked = { hm: '' };
    var send = q('fix-send'), note = q('fix-why'), tin = q('fix-t');
    var K = KIND_LABEL[p.kind] || p.kind;
    var draw2 = function () {
      var ok = !!picked.hm;
      if (note) {
        note.textContent = ok
          ? global.TcClean.mdOf(global.TcClean.dayOf(p.at)) + ' の ' + global.TcClean.hmOf(p.at)
            + ' ' + K + ' を ' + picked.hm + ' に直します'
          : '直したい時刻を選んでください';
        note.hidden = false;
      }
      if (send) send.disabled = !ok;
    };
    var openBtn = q('fix-open');
    if (openBtn) { openBtn.onclick = function () { _fixStep = 'pick'; draw(); }; }
    Array.prototype.forEach.call(d.querySelectorAll('[id^="fix-c"]'), function (b) {
      b.onclick = function () { picked.hm = b.getAttribute('data-hm'); draw2(); };
    });
    if (tin) { tin.oninput = function () { picked.hm = tin.value; draw2(); }; tin.onchange = tin.oninput; }
    var pick = q('fix-pick');
    if (pick) pick.onclick = function () { picked.hm = (tin || {}).value || ''; draw2(); };
    if (send) {
      send.onclick = function () {
        if (!picked.hm) { draw2(); return; }
        var day = global.TcClean.dayOf(p.at);
        apply({ id: p.id, at: day + 'T' + picked.hm, done: '直しました。',
          why: global.TcClean.mdOf(day) + ' の ' + global.TcClean.hmOf(p.at) + ' ' + K
            + ' を ' + picked.hm + ' に直しました' });
      };
    }
    var drop = q('fix-drop');
    if (drop) {
      drop.onclick = function () {
        apply({ id: p.id, done: '消しました。',
          why: global.TcClean.mdOf(global.TcClean.dayOf(p.at)) + ' の '
            + global.TcClean.hmOf(p.at) + ' ' + K + ' を 消しました' });
      };
    }
    draw2();
  }

  /** 打刻の行と 機械が見つけた聞く事を配線する */
  function bindRows() {
    Array.prototype.forEach.call(d.querySelectorAll('[data-pid]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-pid');
        _openPid = (_openPid === id) ? null : id;
        _fixStep = 'menu';                 // ★開いた時は いつも2つだけ★
        if (_openPid) { _addOpen = false; drawAdd(); }   // ★押す物を画面に1つに★
        draw();
      };
    });
    _issues.forEach(function (x, n) {
      var ok = q('iss' + n + '-ok'), fx = q('iss' + n + '-fix');
      if (ok) {
        ok.onclick = function () {
          /* ★合っていると答えたら 二度と聞かない★（印を1つ足すだけ・打刻は動かない） */
          DB.Emp.okTime(st.token, st.device, st.pw, x.id, x.type).then(function (r) {
            if (!r || !r.ok) { U.toast('できませんでした。'); return; }
            U.toast('わかりました。この事は もう聞きません。');
            draw();
          }).catch(function (e) { U.toast('つながりませんでした（' + e.message + '）'); });
        };
      }
      if (fx) {
        fx.onclick = function () { _openPid = x.id; draw(); };
      }
    });
    if (_openPid) bindFixPanel();
  }

  /** ★直す・消す・足す は この1本★（2026-08-18 夜3 司さん「シンプルイズベスト」）
   *  ★決まりは1つ★＝自分の打刻は 自分で直せる・消せる。締めた後はできない。
   *  ★押したら その場で入る★（確認の一言も出さない）。跡は中で残る。 */
  function apply(o) {
    var fix = global.TcClean.canFix({ state: st.state });
    if (!fix.ok) { U.toast(fix.why); return; }
    return DB.Emp.edit(st.token, st.device, st.pw, o.id || null, o.at || null, o.kind || null, o.why || '')
      .then(function (r) {
        if (!r || !r.ok) { U.toast(reason(r)); return; }
        if (o.ask) _answered[askKey(o.ask)] = true;
        _openPid = null;
        _fixStep = 'menu';
        U.toast(o.done);
        draw();
      }, function (e) { U.toast('つながりませんでした（' + e.message + '）'); });
  }

  function bindAsks() {
    _asks.forEach(function (a, n) {
      var K = global.TcClean.KIND_LABEL;
      var on = function (suffix, fn) {
        var b = q('ask' + n + '-' + suffix);
        if (b) b.onclick = fn;
      };
      var pick = function () { return (q('ask' + n + '-t') || {}).value || ''; };
      /* ★D★ 時刻を選ぶまで「この時刻に…」は押せない（押しても何も起きない、を作らない） */
      var tin = q('ask' + n + '-t'), pb = q('ask' + n + '-pick');
      if (tin && pb) {
        var sync = function () {
          pb.disabled = !tin.value;
          pb.title = tin.value ? '' : '時刻を選んでください';
        };
        tin.oninput = sync; tin.onchange = sync;
        sync();
      }
      if (a.type === 'both') {
        /* ★どちらでしたか＝片方を使わない＝「直す」の道★（締めていなければ その場で入る） */
        on('in', function () {
          apply({ id: a.outId, ask: a, done: '直しました。',
            why: a.hm + ' は ' + K.in + 'でした（' + K.out + 'を消しました）' });
        });
        on('out', function () {
          apply({ id: a.inId, ask: a, done: '直しました。',
            why: a.hm + ' は ' + K.out + 'でした（' + K.in + 'を消しました）' });
        });
      } else if (a.type === 'open-in') {
        on('now', function () {
          var hm = (DB.nowJst() || '').slice(11, 16);
          apply({ at: a.d + 'T' + hm, kind: 'out', ask: a, done: '入れました。',
            why: a.hm + ' の' + K.in + 'に ' + hm + ' の' + K.out + 'を足しました' });
        });
        on('pick', function () {
          var hm = pick();
          if (!hm) { U.toast('時刻を選んでください'); return; }
          apply({ at: a.d + 'T' + hm, kind: 'out', ask: a, done: '入れました。',
            why: a.hm + ' の' + K.in + 'に ' + hm + ' の' + K.out + 'を足しました' });
        });
      } else {
        on('pick', function () {
          var hm = pick();
          if (!hm) { U.toast('時刻を選んでください'); return; }
          apply({ at: a.d + 'T' + hm, kind: 'in', ask: a, done: '入れました。',
            why: a.hm + ' の' + K.out + 'に ' + hm + ' の' + K.in + 'を足しました' });
        });
      }
    });
  }

  function draw() {
    var lab = q('ymlabel');
    if (lab) lab.textContent = st.ym.replace('-', '年') + '月';
    /* ★見ている月が締め切られているかを 倉庫に聞く★
       （今日の分だけ見ていると、前の月を開いた人に何も出ない） */
    DB.Emp.info(st.token, st.ym + '-15').then(function (i) {
      st.notice = (i && i.notice) || '';
      drawNotice();
    }).catch(function () { /* 聞けなくても 記録の表示は止めない */ });
    var from = st.ym + '-01';
    var to = new Date(Date.UTC(+st.ym.slice(0, 4), +st.ym.slice(5, 7), 0)).toISOString().slice(0, 10);
    DB.Emp.mine(st.token, st.device, st.pw, from, to).then(function (r) {
      var box = q('list');
      if (!box) return;
      if (!r || r.unauth) { box.innerHTML = '<div class="tc-alert">もう一度 暗証番号を入れてください。</div>'; return; }
      /* ★掃除の判定は lib/tc-clean.js（社長の画面・数える所と同じ1本）★
         ここで「使う／使わない」を書き直さない。★出すのは 時刻と言葉だけ★。 */
      _all = r.punches || [];
      var res = global.TcClean.clean(_all, { today: (DB.nowJst() || '').slice(0, 10) });
      /* ★機械が先に気づく分★（長すぎ/短すぎ/退勤が先）。線は会社の1日の決まりから作る */
      _issues = global.TcClean.timeIssues(_all, {
        today: (DB.nowJst() || '').slice(0, 10), dayStdMin: _dayStdMin,
      });
      var byDay = {};
      res.punches.forEach(function (p) {
        (byDay[p.at.slice(0, 10)] = byDay[p.at.slice(0, 10)] || []).push(p);
      });
      var days = Object.keys(byDay).sort();
      if (!days.length) { box.innerHTML = '<div class="tc-note">この月はまだ何も打っていません。</div>'; return; }
      _asks = res.asks.slice();
      box.innerHTML = days.map(function (day) {
        var info = res.byDay[day] || { asks: [] };
        /* ★まとめた物も 画面には残す★（薄く・札つき）＝消したように見せない */
        var rows = byDay[day].map(function (p) {
          var merged = p.why === 'merged';
          /* ★時刻そのものを間違えた時★（2026-08-18 司さん）
             ＝打った直後の60秒を過ぎたら、★行を押して「この時刻を直す」★。
             ★元の行は消さない★＝新しい時刻の行を足して、元には印を付ける。 */
          var openable = !!p.id && !merged;
          var head = '<span class="tc-punchline' + (merged ? ' tc-dim' : '') + '">'
            + U.esc(p.at.slice(11, 16)) + '　' + U.esc(KIND_LABEL[p.kind] || p.kind)
            + (p.pending ? ' <span class="tc-tag pending">まだ入っていません</span>' : '')
            + (merged ? ' <span class="tc-tag">同じ打刻としてまとめました</span>' : '') + '</span>';
          if (!openable) return '<div>' + head + '</div>';
          return '<div class="tc-punchrow">'
            + '<button type="button" class="tc-rowbtn" data-pid="' + U.esc(p.id) + '"'
            + ' aria-expanded="' + (_openPid === p.id ? 'true' : 'false') + '">'
            + head + '<span class="tc-caret">' + (_openPid === p.id ? '×' : '直す') + '</span></button>'
            + (_openPid === p.id ? fixPanelHtml(p) : '')
            + '</div>';
        }).join('');
        /* ★その日の結論を1行★（★決められない日は 決められないと出す★・時刻だけ）
           ★言う事が在る日だけ出す★（2026-08-18 夜 司さん「複雑すぎんか？」）
           ＝出勤と退勤が並んでいる日は ★上の2行を読めば同じ事★。1日44pxを積まない。 */
        var needLine = info.undecided || (info.asks || []).length || info.merged
          || (info.pairs || []).some(function (x) { return !x.outAt; });
        var line = needLine
          ? '<div class="tc-note' + (info.undecided ? ' warn' : '') + '">'
            + U.esc(global.TcClean.daySentence(info, day)) + '</div>'
          : '';
        /* ★聞く事は 1日に1つまで★（2026-08-18 夜 司さん「複雑すぎんか？」）
           ＝決められない日に質問を3つ並べないのと ★同じ決め★を 打刻の直しにも当てる。
           ★先に聞くのは「打った物の食い違い」★（tc-clean の asks）。
           それが無い日だけ ★機械が見つけた「時刻ちがい」★を1つ出す。 */
        var one1 = (info.asks || [])[0];
        var qs = one1 ? askHtml(one1, _asks.indexOf(one1), res) : '';
        if (!qs) {
          var iss1 = _issues.filter(function (x) { return global.TcClean.dayOf(x.at) === day; })[0];
          if (iss1) qs = issueHtml(iss1, _issues.indexOf(iss1));
        }
        return '<div class="tc-card' + (qs ? ' ask' : '') + '"><div class="tc-cardhead"><b class="num">'
          + U.esc(day.slice(5).replace('-', '/')) + '（' + U.dowOf(day) + '）</b></div>'
          + rows + line + qs + '</div>';
      }).join('');
      bindAsks();
      bindRows();
    }).catch(function (e) { U.toast('つながりませんでした（' + e.message + '）'); });
  }

  /** ★D★ 出す前に「何を出すか」を1行 見せる／揃うまで押せない
   *  ＝★時刻が --:-- のまま押せてしまう★のが 今までの穴（司さんの指摘そのもの）。
   *  ★押せない理由は 押す物のすぐ上に出す★（押しても何も起きない、を作らない）。 */
  function addLater0() {
    return {
      day: (d.querySelector('#ad-wrap .tc-date-input') || {}).value || '',
      hm: (q('at') || {}).value || '',
      kind: (q('ak') || {}).value || '',
      why: (q('ar') || {}).value || '',
    };
  }
  function drawAdd() {
    var box = q('add-box'), open = q('b-addopen');
    if (box) box.hidden = !_addOpen;
    if (open) {
      open.setAttribute('aria-expanded', String(_addOpen));
      open.textContent = _addOpen ? '閉じる' : 'あとから入れる（打ち忘れた日）';
    }
    var v = addLater0(), b = q('b-add'), note = q('add-why');
    var msg = '', ok = false;
    var fix = global.TcClean.canFix({ state: st.state });
    if (!fix.ok) msg = fix.why;                           // ★締めた後は 足せない★
    else if (!v.day) msg = '日を選んでください';
    else if (!v.hm) msg = '時刻を選んでください';
    else if (!v.kind) msg = 'どれかを選んでください';
    else {
      ok = true;
      msg = global.TcClean.mdOf(v.day) + ' ' + v.hm + ' に ' + (KIND_LABEL[v.kind] || v.kind)
        + ' を足します';
    }
    if (note) { note.textContent = msg; note.hidden = !msg; }
    if (b) b.disabled = !ok;
  }

  /** ★足す★（打ち忘れた分）… ★その場で入る★（締めた後は押せない） */
  function addLater() {
    var v = addLater0();
    if (!v.day || !v.hm) { drawAdd(); return; }
    apply({
      at: v.day + 'T' + v.hm, kind: v.kind || 'in', done: '入れました。',
      why: global.TcClean.mdOf(v.day) + ' ' + v.hm + ' に '
        + (KIND_LABEL[v.kind] || v.kind) + ' を足しました' + (v.why ? '（' + v.why + '）' : ''),
    });
  }

  global.EmpApp = {
    startPunch: startPunch, startKiroku: startKiroku, KIND_LABEL: KIND_LABEL,
    /* 日付の欄（TcUi が作る）から呼ばれる＝★選び終わった事を受け取る★ */
    onAddChange: drawAdd,
    _st: st,
  };
})(typeof window !== 'undefined' ? window : globalThis);
