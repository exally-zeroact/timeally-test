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
 *   リンク(?t=…)＋最初のあいことば＋自分のあいことば(8文字以上)＋端末を覚える
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
    if (r.weak) return 'あいことばは8文字以上にしてください。';
    if (r.already_set) return 'すでに決まっています。「あいことば」を入れて入ってください。';
    if (r.bad_init) return 'はじめのあいことばが違います。あと' + (r.remaining == null ? '' : r.remaining + '回') + '。';
    if (r.remaining != null) return 'あいことばが違います。あと' + r.remaining + '回。';
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
    /* ★締め切った月には「お願い」も出せない★
       倉庫が断るので入りはしないが、★押せてしまうと「出したのに直らない」と思われる★ */
    var add = q('b-add');
    if (add) add.disabled = !!st.notice;
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
    if (t) t.textContent = mode === 'first' ? 'はじめての方' : 'あいことば';
    /* ★記録の画面には あいことばを決める所を置かない★（入口は1か所）。
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
      var n = q('gate-note');
      if (n) n.textContent = a.has_password ? '' : '会社から渡された「最初のあいことば」を入れて、あなたのあいことばを決めてください。';
    }).catch(function (e) { alertBox('つながりませんでした（' + e.message + '）'); });

    var setpw = q('b-setpw');
    if (setpw) setpw.onclick = function () {
      var a = q('pw1').value, b = q('pw2').value;
      if (a !== b) { alertBox('2つのあいことばが違います。'); return; }
      if (a.length < 8) { alertBox('あいことばは8文字以上にしてください。'); return; }
      DB.Emp.setPassword(st.token, q('init').value, a).then(function (r) {
        if (!r || !r.ok) { alertBox(reason(r)); return; }
        return DB.Emp.verify(st.token, a).then(function (v) {
          if (!v || !v.ok) { alertBox(reason(v)); return; }
          remember(v.device_token);
          /* ★記録の画面から来た人は 元の画面へ戻す★（決めさせた所で放り出さない） */
          if (param('back') === 'kiroku') {
            global.location.href = 'kiroku.html?t=' + encodeURIComponent(st.token);
            return;
          }
          closeGate(); after();
        });
      }).catch(function (e) { alertBox('つながりませんでした（' + e.message + '）'); });
    };
    var ver = q('b-verify');
    if (ver) ver.onclick = function () {
      var pw = q('pw').value;
      DB.Emp.verify(st.token, pw).then(function (v) {
        if (!v || !v.ok) { alertBox(reason(v)); return; }
        remember(v.device_token); closeGate(); after();
      }).catch(function (e) { alertBox('つながりませんでした（' + e.message + '）'); });
    };
  }
  function remember(dev) {
    st.device = dev || '';
    if (global.localStorage && st.device) global.localStorage.setItem(devKey(), st.device);
  }

  /* ── ① 打つ ───────────────────────────────────────────────── */
  function startPunch() {
    begin(function () {
      var t = q('t');
      if (t && !t.value) t.value = (DB.nowJst() || '').slice(11, 16);   // ★いまの時刻を入れておく。直せる★
      var link = q('to-kiroku');
      if (link) link.href = 'kiroku.html?t=' + encodeURIComponent(st.token);
      var pairs = [['b-in', 'in', '出勤'], ['b-out', 'out', '退勤'],
        ['b-bin', 'break_in', '休憩に入る'], ['b-bout', 'break_out', '休憩から戻る'],
        ['b-ain', 'away_in', '私用で外出'], ['b-aout', 'away_out', '外出から戻る']];
      pairs.forEach(function (p) {
        var b = q(p[0]);
        if (!b) return;
        b.onclick = function () { push(p[1], p[2], b); };
        /* ★締め切った後は押せない★（押せても倉庫が断るが、押させない方が親切） */
        b.disabled = st.state !== 'open';
      });
      drawNotice();
      var f = q('b-forget');
      if (f) f.onclick = function () {
        if (global.localStorage) global.localStorage.removeItem(devKey());
        st.device = '';
        U.toast('この端末を忘れました。次からあいことばを聞きます。');
      };
    });
  }

  function push(kind, label, btn) {
    var hm = (q('t') || {}).value || (DB.nowJst() || '').slice(11, 16);
    var today = (DB.nowJst() || '').slice(0, 10);
    if (btn) btn.disabled = true;
    DB.Emp.punch(st.token, st.device, st.pw, today + 'T' + hm, kind, 'punch')
      .then(function (r) {
        if (!r || !r.ok) { U.toast(reason(r)); return; }
        U.toast(label + ' ' + hm + ' を残しました');
      })
      .catch(function (e) { U.toast('つながりませんでした（' + e.message + '）'); })
      .then(function () { if (btn) btn.disabled = false; });
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
      drawNotice();
      draw();
    });
  }
  function shift(n) {
    var y = +st.ym.slice(0, 4), m = +st.ym.slice(5, 7) + n;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    st.ym = y + '-' + ('0' + m).slice(-2);
    draw();
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
      if (!r || r.unauth) { box.innerHTML = '<div class="tc-alert">もう一度あいことばを入れてください。</div>'; return; }
      var byDay = {};
      (r.punches || []).forEach(function (p) {
        var day = p.at.slice(0, 10);
        (byDay[day] = byDay[day] || []).push(p);
      });
      var days = Object.keys(byDay).sort();
      if (!days.length) { box.innerHTML = '<div class="tc-note">この月はまだ何も打っていません。</div>'; return; }
      box.innerHTML = days.map(function (day) {
        var rows = byDay[day].map(function (p) {
          return '<div>' + U.esc(p.at.slice(11, 16)) + '　' + U.esc(KIND_LABEL[p.kind] || p.kind)
            + (p.pending ? ' <span class="tc-tag pending">お願い中</span>' : '') + '</div>';
        }).join('');
        return '<div class="tc-card"><div class="tc-cardhead"><b class="num">'
          + U.esc(day.slice(5).replace('-', '/')) + '（' + U.dowOf(day) + '）</b></div>' + rows + '</div>';
      }).join('');
    }).catch(function (e) { U.toast('つながりませんでした（' + e.message + '）'); });
  }

  /** あとから入れる＝★必ずお願い（申請）扱い★。当日打ったものと札で分ける。 */
  function addLater() {
    var day = (d.querySelector('#ad-wrap .tc-date-input') || {}).value || '';
    var hm = (q('at') || {}).value || '';
    var kind = (q('ak') || {}).value || 'in';
    var why = (q('ar') || {}).value || '';
    if (!day || !hm) { U.toast('日と時刻を入れてください'); return; }
    var btn = q('b-add');
    btn.disabled = true;
    DB.Emp.punch(st.token, st.device, st.pw, day + 'T' + hm, kind, 'calendar')
      .then(function (r) {
        if (!r || !r.ok) { U.toast(reason(r)); return; }
        return DB.Emp.fixRequest(st.token, st.device, st.pw, day, null, null, why, [r.id])
          .then(function () { U.toast('お願いを出しました。会社が見てから記録に入ります。'); draw(); });
      })
      .catch(function (e) { U.toast('つながりませんでした（' + e.message + '）'); })
      .then(function () { btn.disabled = false; });
  }

  global.EmpApp = { startPunch: startPunch, startKiroku: startKiroku, KIND_LABEL: KIND_LABEL, _st: st };
})(typeof window !== 'undefined' ? window : globalThis);
