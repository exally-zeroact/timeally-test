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

  /* ── ① 打つ ───────────────────────────────────────────────── */
  function startPunch() {
    begin(function () {
      var t = q('t');
      if (t && !t.value) t.value = (DB.nowJst() || '').slice(11, 16);   // ★いまの時刻を入れておく。直せる★
      var link = q('to-kiroku');
      if (link) link.href = 'kiroku.html?t=' + encodeURIComponent(st.token);
      /* ★休憩は押させない★（2026-08-15）。集計の側で 会社の既定を引く。
         ★倉庫は break_in / break_out を今も受け取る★＝★過去の打刻が読めなくなると困る★ため。 */
      var pairs = [['b-in', 'in', '出勤'], ['b-out', 'out', '退勤'],
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
        U.toast('この端末を忘れました。次から暗証番号を聞きます。');
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
  /* ── ★おかしい所は 画面が先に言う★（2026-08-18 司さんの実機の形） ──────
     ★聞いてあげる。埋めさせない★＝空欄を出して打ち直させず、★押すだけで決まる★。
     ★何がおかしいか の判定と 文は lib/tc-clean.js が1か所で持つ★
     （社長の画面・数える所と ★同じ物★を見る＝食い違わない）。
     ★1問ごとに保存★（最後まで行かないと保存されない、を作らない）。
     ★出した物は「お願い中」の札が付き、会社が見てから記録に入る★（今までの作りと同じ）。 */
  var _asks = [];                                   // 画面に出している質問（押した時に引く）

  function askHtml(a, n, res) {
    var head = '<div class="tc-askq">' + U.esc(a.text) + '</div>';
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
      /* ★「今 退勤にする」は 今日の分だけ★（前の日に「今」を入れると 日をまたぐ形になる） */
      rows = (a.soft ? btn('ask' + n + '-now', '今 退勤にする', '') : '')
        + '<span class="tc-askpick"><input type="time" step="60" id="ask' + n + '-t" />'
        + btn('ask' + n + '-pick', 'この時刻に退勤', '') + '</span>'
        + btn('ask' + n + '-drop', 'この出勤を取り消す', '');
    } else {
      rows = '<span class="tc-askpick"><input type="time" step="60" id="ask' + n + '-t" />'
        + btn('ask' + n + '-pick', 'この時刻に出勤', '') + '</span>'
        + btn('ask' + n + '-drop', 'この退勤を取り消す', '');
    }
    return '<div class="tc-ask">' + head + '<div class="tc-askrow">' + rows + '</div></div>';
  }

  /** ★お願いを1つ出す★（入れる打刻 と 使わない打刻 を まとめて1件で出す） */
  function sendAsk(d, why, addKind, addWall, voidIds) {
    var done = function () { U.toast('お願いを出しました。会社が見てから記録に入ります。'); draw(); };
    var ng = function (e) { U.toast('つながりませんでした（' + e.message + '）'); };
    if (!addKind) {
      return DB.Emp.fixRequest(st.token, st.device, st.pw, d, null, null, why, [], voidIds || [])
        .then(function (r) { if (!r || !r.ok) { U.toast(reason(r)); return; } done(); }, ng);
    }
    return DB.Emp.punch(st.token, st.device, st.pw, addWall, addKind, 'calendar')
      .then(function (r) {
        if (!r || !r.ok) { U.toast(reason(r)); return; }
        return DB.Emp.fixRequest(st.token, st.device, st.pw, d, null, null, why, [r.id], voidIds || [])
          .then(function (f) { if (!f || !f.ok) { U.toast(reason(f)); return; } done(); });
      }, ng);
  }

  function bindAsks() {
    _asks.forEach(function (a, n) {
      var K = global.TcClean.KIND_LABEL;
      var on = function (suffix, fn) {
        var b = q('ask' + n + '-' + suffix);
        if (b) b.onclick = fn;
      };
      var pick = function () { return (q('ask' + n + '-t') || {}).value || ''; };
      if (a.type === 'both') {
        on('in', function () {
          sendAsk(a.d, a.hm + ' は ' + K.in + 'でした（' + K.out + 'は使いません）', null, null, [a.outId]);
        });
        on('out', function () {
          sendAsk(a.d, a.hm + ' は ' + K.out + 'でした（' + K.in + 'は使いません）', null, null, [a.inId]);
        });
      } else if (a.type === 'open-in') {
        on('now', function () {
          var hm = (DB.nowJst() || '').slice(11, 16);
          sendAsk(a.d, a.hm + ' の' + K.in + 'に ' + hm + ' の' + K.out + 'を入れました', 'out', a.d + 'T' + hm, []);
        });
        on('pick', function () {
          var hm = pick();
          if (!hm) { U.toast('時刻を選んでください'); return; }
          sendAsk(a.d, a.hm + ' の' + K.in + 'に ' + hm + ' の' + K.out + 'を入れました', 'out', a.d + 'T' + hm, []);
        });
        on('drop', function () {
          sendAsk(a.d, a.hm + ' の' + K.in + 'を取り消しました', null, null, [a.id]);
        });
      } else {
        on('pick', function () {
          var hm = pick();
          if (!hm) { U.toast('時刻を選んでください'); return; }
          sendAsk(a.d, a.hm + ' の' + K.out + 'に ' + hm + ' の' + K.in + 'を入れました', 'in', a.d + 'T' + hm, []);
        });
        on('drop', function () {
          sendAsk(a.d, a.hm + ' の' + K.out + 'を取り消しました', null, null, [a.id]);
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
      var res = global.TcClean.clean(r.punches || [], { today: (DB.nowJst() || '').slice(0, 10) });
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
          return '<div' + (merged ? ' class="tc-dim"' : '') + '>'
            + U.esc(p.at.slice(11, 16)) + '　' + U.esc(KIND_LABEL[p.kind] || p.kind)
            + (p.pending ? ' <span class="tc-tag pending">お願い中</span>' : '')
            + (merged ? ' <span class="tc-tag">同じ打刻としてまとめました</span>' : '')
            + '</div>';
        }).join('');
        /* ★その日の結論を1行★（★決められない日は 決められないと出す★・時刻だけ） */
        var line = '<div class="tc-note' + (info.undecided ? ' warn' : '') + '">'
          + U.esc(global.TcClean.daySentence(info, day)) + '</div>';
        var qs = (info.asks || []).map(function (a) {
          return askHtml(a, _asks.indexOf(a), res);
        }).join('');
        return '<div class="tc-card' + (qs ? ' ask' : '') + '"><div class="tc-cardhead"><b class="num">'
          + U.esc(day.slice(5).replace('-', '/')) + '（' + U.dowOf(day) + '）</b></div>'
          + rows + line + qs + '</div>';
      }).join('');
      bindAsks();
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
