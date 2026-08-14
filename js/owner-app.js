/* owner-app.js — ★社長の画面（一覧／集計・印刷／会社情報／従業員／ログイン）★（Timeally）
 * =============================================================================
 * ★数えるのは lib/tc-calc.js の summarize() 1本だけ★
 *   画面・印刷・CSV・Excel・気づき の全部が ★同じ返り値★ を見る。
 *   2か所で潰すと必ず数字が食い違う（前科あり）。ここには足し算を書かない。
 *
 * ★ここにだけ出す物★: 実労働・所定内・所定超・法定外残業・深夜・休日・遅刻・早退・
 *   丸め・切り捨てた時間と金額・気づき。★従業員の画面には1つも出さない★
 *
 * 【利用】window.OwnerApp
 */
(function (global) {
  'use strict';

  var d = global.document;
  var U = global.TcUi, DB = global.TcDb;
  var st = { user: null, company: null, people: [], ym: '', who: '', sum: null };

  function q(id) { return d.getElementById(id); }
  function pad2(n) { return ('0' + n).slice(-2); }
  function thisYm() { return (DB.nowJst() || '2026-01').slice(0, 7); }
  function stamp() { return (DB.nowJst() || '').replace(/[-T:]/g, '').slice(0, 13).replace(/^(\d{8})(\d{4})$/, '$1_$2'); }

  /** ★ログインが切れていたら 入口へ送る★
   *  送らないと ★中身の無い画面が出て 理由が分からない★（実配信で踏んだ：
   *  倉庫は401を返しているのに、画面は「0件」に見えていた）。
   *  @returns true なら もうこの先を続けない */
  function bailIfLoggedOut(e) {
    if (!e || !DB.isAuthError(e)) return false;
    global.location.replace('login.html');
    return true;
  }
  function failed(msg) {
    return function (e) {
      if (bailIfLoggedOut(e)) return;
      U.toast(msg + '（' + e.message + '）');
    };
  }

  function alertBox(id, msg) {
    var el = q(id);
    if (!el) { U.toast(msg); return; }
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  /* ── ログイン（★自前★） ──────────────────────────────────── */
  function startLogin() {
    q('b-in').onclick = function () {
      DB.Auth.signIn(q('email').value.trim(), q('pw').value).then(function (r) {
        if (r.error) { alertBox('alert', '入れませんでした（' + r.error.message + '）'); return; }
        global.location.href = 'index.html';
      });
    };
    q('b-new').onclick = function () {
      var pw = q('pw').value;
      if (pw.length < 8) { alertBox('alert', 'パスワードは8文字以上にしてください。'); return; }
      DB.Auth.signUp(q('email').value.trim(), pw).then(function (r) {
        if (r.error) { alertBox('alert', '登録できませんでした（' + r.error.message + '）'); return; }
        alertBox('alert', '登録しました。メールが届いていたら中のリンクを押してください。');
      });
    };
    q('b-reset').onclick = function () {
      var email = q('email').value.trim();
      if (!email) { alertBox('alert', 'メールアドレスを入れてください。'); return; }
      /* ★戻り先は「今いる場所」＝許可リストに入っていないと別のアプリへ飛ぶ★
         （前科: 許可リストに無くて 請求書アプリへ流れた） */
      var back = global.location.href.replace(/[^/]*$/, 'login.html');
      DB.client().auth.resetPasswordForEmail(email, { redirectTo: back }).then(function (r) {
        alertBox('alert', r.error ? '送れませんでした（' + r.error.message + '）'
          : 'メールを送りました。届かないときは会社の管理者にお伝えください。');
      });
    };
  }

  /** ログインしていなければ ★そのままログイン画面へ送る★。していれば after()
   *  ★「ログインへ」をもう1回押させない★＝社長が覚えるURLは
   *    https://…/（root）の1つだけで済む。押す物が増えると URL も増えて見える。 */
  function needUser(after) {
    DB.Auth.user().then(function (u) {
      if (!u) { global.location.replace('login.html'); return; }
      st.user = u;
      q('main').hidden = false;
      after();
    }).catch(failed('つながりませんでした'));
  }

  /* ── ① 一覧 ───────────────────────────────────────────────── */
  function startIndex() {
    needUser(function () {
      st.ym = thisYm();
      bindTabs();
      /* ★出るは1回 確認する★（タブと間違えて押した＝実機で踏んだ）
         ★白紙のダイアログを開かない★。画面の中で聞く */
      q('b-signout').onclick = function () {
        var box = q('signout-ask');
        q('signout-ask-text').textContent = 'ログアウトしますか？　もう一度ログインが要ります。';
        box.hidden = false;
        if (box.scrollIntoView) box.scrollIntoView({ block: 'nearest' });
      };
      q('b-signout-no').onclick = function () { q('signout-ask').hidden = true; };
      q('b-signout-yes').onclick = function () {
        DB.Auth.signOut().then(function () { global.location.href = 'login.html'; });
      };
      q('b-prev').onclick = function () { shiftYm(-1); };
      q('b-next').onclick = function () { shiftYm(1); };
      q('b-addperson').onclick = addPerson;
      q('b-savecompany').onclick = saveCompany;
      ['c-round', 'c-runit', 'c-rdir', 'c-rscope'].forEach(function (id) {
        var el = q(id); if (el) el.onchange = drawRoundNote;
      });
      ['c-holmode', 'c-holiday'].forEach(function (id) {
        var el = q(id); if (el) el.onchange = drawHolidayNote;
      });
      var hw = q('p-hire-wrap');
      if (hw) hw.innerHTML = U.dateField('', '');
      reload();
    });
  }

  function bindTabs() {
    var tabs = [['tab-list', 'pane-list'], ['tab-people', 'pane-people'], ['tab-company', 'pane-company']];
    tabs.forEach(function (t) {
      q(t[0]).onclick = function () {
        tabs.forEach(function (x) {
          q(x[0]).setAttribute('aria-selected', String(x[0] === t[0]));
          q(x[1]).hidden = x[0] !== t[0];
        });
      };
    });
  }
  function shiftYm(n) {
    var y = +st.ym.slice(0, 4), m = +st.ym.slice(5, 7) + n;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    st.ym = y + '-' + pad2(m);
    reload();
  }

  function reload() {
    var lab = q('ymlabel');
    if (lab) lab.textContent = st.ym.replace('-', '年') + '月';
    Promise.all([DB.getCompany(), DB.listPeople(), DB.listFixes(), DB.listPinLog()]).then(function (r) {
      st.company = r[0] || {};
      st.people = r[1] || [];
      st.pinLog = r[3] || [];
      fillCompany();
      drawPeople();
      return drawFixes(r[2] || []);
    }).then(drawSummary)
      .catch(failed('読めませんでした'));
  }

  function coOpts() {
    var c = st.company || {};
    return {
      dailyStdMin: c.daily_std_min, weekLegalMin: c.week_legal_min, closeDay: c.close_day,
      rounding: c.rounding, roundUnitMin: c.round_unit_min, roundDir: c.round_dir, roundScope: c.round_scope,
      holidayMode: c.holiday_mode, legalHolidayDow: c.legal_holiday_dow,
      holidayCycleStart: c.holiday_cycle_start,
      weekStartDow: c.week_start_dow,
      sme: c.sme, warnOn: c.warn_on,
    };
  }

  /* 直しのお願い（★未承認が上★）。★元は何分→何分★ を出してから承認する */
  function drawFixes(fixes) {
    var box = q('fixes');
    if (!box) return Promise.resolve();
    var pending = fixes.filter(function (f) { return f.status === 'pending'; });
    var done = fixes.filter(function (f) { return f.status !== 'pending'; }).slice(0, 20);
    if (!pending.length && !done.length) { box.innerHTML = '<div class="tc-note">お願いはありません。</div>'; return Promise.resolve(); }

    /* 承認する前に「今どうなっていて、承認すると何分になるか」を実際に数えて見せる */
    return Promise.all(pending.map(function (f) {
      return Promise.all([
        DB.loadPunches(f.employee_id, f.d, f.d, { includePending: false }),
        DB.loadPunches(f.employee_id, f.d, f.d, { includePending: true }),
      ]).then(function (p) {
        var before = one(p[0], f.d).workMin, after = one(p[1], f.d).workMin;
        f._before = before; f._after = after;
        return f;
      }).catch(function () { f._before = null; f._after = null; return f; });
    })).then(function (rows) {
      box.innerHTML = rows.map(function (f) {
        var name = nameOf(f.employee_id);
        return '<div class="tc-card pending"><div class="tc-cardhead">'
          + '<b>' + U.esc(name) + '</b> <span class="num">' + U.esc(f.d) + '</span>'
          + '<span class="tc-tag pending">未承認</span><span class="tc-spacer"></span>'
          + '<button class="tc-btn" type="button" data-ok="' + U.esc(f.id) + '">承認する</button>'
          + '<button class="tc-btn danger" type="button" data-ng="' + U.esc(f.id) + '">戻す</button>'
          + '</div><div>'
          + (f._before == null ? '（数えられませんでした）'
            : '元は ' + f._before + '分 → 承認すると ' + f._after + '分')
          + (f.reason ? '　理由: ' + U.esc(f.reason) : '') + '</div></div>';
      }).join('') + done.map(function (f) {
        return '<div class="tc-card"><div class="tc-cardhead"><b>' + U.esc(nameOf(f.employee_id)) + '</b>'
          + ' <span class="num">' + U.esc(f.d) + '</span>'
          + '<span class="tc-tag">' + (f.status === 'approved' ? '承認済' : '戻した') + '</span>'
          + (f.approved_by === 'self' ? '<span class="tc-tag">自己承認</span>' : '')
          + '</div><div>' + (f.before_min == null ? '' : '元は ' + f.before_min + '分 → ' + f.after_min + '分')
          + (f.reason ? '　理由: ' + U.esc(f.reason) : '') + '</div></div>';
      }).join('');

      Array.prototype.forEach.call(box.querySelectorAll('[data-ok]'), function (b) {
        b.onclick = function () {
          var f = rows.filter(function (x) { return x.id === b.getAttribute('data-ok'); })[0];
          /* ★社長1人の会社は「自己承認」と残す（承認が無かった事にしない）★ */
          var self = f && f.requested_by === 'owner';
          DB.client().from('tc_fix').update({ before_min: f._before, after_min: f._after })
            .eq('id', f.id).then(function () {
              return DB.approveFix(f.id, st.user.id, self);
            }).then(function () { U.toast('承認しました'); reload(); })
            .catch(failed('できませんでした'));
        };
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-ng]'), function (b) {
        b.onclick = function () {
          DB.rejectFix(b.getAttribute('data-ng'), st.user.id)
            .then(function () { U.toast('戻しました'); reload(); })
            .catch(failed('できませんでした'));
        };
      });
    });
  }

  function one(punches, day) {
    var s = global.TcCalc.summarize({ ym: day.slice(0, 7), punches: punches, shifts: [], fixes: [], company: coOpts() });
    return s.days.filter(function (x) { return x.d === day; })[0] || { workMin: 0 };
  }
  function nameOf(empId) {
    var p = st.people.filter(function (x) { return x.employee_id === empId; })[0];
    return p ? (p.name || p.employee_id) : empId;
  }

  /* 今月の人ごとの合計（★summarize の返り値だけを見る★） */
  function drawSummary() {
    var box = q('people-summary');
    if (!box) return;
    if (!st.people.length) { box.innerHTML = '<div class="tc-note">まだ従業員がいません。「従業員」から追加してください。</div>'; return; }
    var per = global.TcCalc.period(st.ym, (st.company && st.company.close_day) || 31);
    Promise.all(st.people.map(function (p) {
      return Promise.all([
        DB.loadPunches(p.employee_id, per.from, per.to),
        DB.loadShifts(p.employee_id, per.from, per.to),
      ]).then(function (r) {
        var s = global.TcCalc.summarize({
          ym: st.ym, punches: r[0], shifts: r[1], fixes: [],
          company: Object.assign(coOpts(), { hourlyYen: p.hourly_yen, personHolidayDow: p.legal_holiday_dow }),
        });
        return { p: p, s: s };
      });
    })).then(function (rows) {
      /* ★割増が要る時数を 一覧にも出す★（うち60超＝50%・うち休日の深夜＝60%）
         ★0の人は空欄★（出ている人だけ目立たせる） */
      box.innerHTML = '<div class="tc-tablewrap"><table class="tc"><tr>'
        + '<th class="l">氏名</th><th>出勤</th><th>実労働</th><th>時間外</th><th>うち60超</th>'
        + '<th>深夜</th><th>休日</th><th>うち休日の深夜</th><th>気づき</th></tr>'
        + rows.map(function (x) {
          var m = x.s.month;
          var z = function (v) { return v ? U.minToHm(v) : ''; };
          return '<tr><td class="l">' + U.esc(x.p.name || x.p.employee_id) + '</td>'
            + '<td class="num">' + m.shukkin + '</td>'
            + '<td class="num">' + U.minToHm(m.workedMin) + '</td>'
            + '<td class="num">' + U.minToHm(m.otMin) + '</td>'
            + '<td class="num' + (m.ot60Min ? ' warn' : '') + '">' + z(m.ot60Min) + '</td>'
            + '<td class="num">' + U.minToHm(m.nightMin) + '</td>'
            + '<td class="num">' + U.minToHm(m.holidayMin) + '</td>'
            + '<td class="num">' + z(m.holidayNightMin) + '</td>'
            + '<td class="num' + (x.s.warnings.length ? ' warn' : '') + '">' + x.s.warnings.length + '</td></tr>';
        }).join('') + '</table></div>';
    }).catch(failed('数えられませんでした'));
  }

  /* ── ② 従業員（入口の発行・QR） ─────────────────────────────── */
  function drawPeople() {
    var box = q('people');
    if (!box) return;
    if (!st.people.length) { box.innerHTML = '<div class="tc-note">まだ登録がありません。</div>'; return; }
    box.innerHTML = st.people.map(function (p) {
      var url = linkFor(p.token);
      return '<div class="tc-card"><div class="tc-cardhead"><b>' + U.esc(p.name || p.employee_id) + '</b>'
        + (p.pw_hash ? '<span class="tc-tag">暗証番号あり</span>' : '<span class="tc-tag pending">まだ決めていません</span>')
        + '<span class="tc-spacer"></span>'
        + '<button class="tc-btn sub" type="button" data-qr="' + U.esc(p.token) + '">QRを出す</button>'
        + '<button class="tc-btn sub" type="button" data-re="' + U.esc(p.token) + '">入口を作り直す</button>'
        + '</div>'
        + '<div style="word-break:break-all">' + U.esc(url) + '</div>'
        /* ★いつ決めたかを出す★（身に覚えの無い日時なら 社長が気づける）
           秘密を1つに減らした分の埋め合わせ（司さん 2026-08-15） */
        + '<div class="tc-when">' + U.esc(pinHistoryOf(p)) + '</div>'
        + '<div id="qr-' + U.esc(p.token) + '"></div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-qr]'), function (b) {
      b.onclick = function () { showQr(b.getAttribute('data-qr')); };
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-re]'), function (b) {
      b.onclick = function () { reissue(b.getAttribute('data-re')); };
    });
  }
  function linkFor(token) {
    return global.location.href.replace(/[^/]*$/, '') + 'punch.html?t=' + token;
  }

  /** ★暗証番号を「いつ決めたか／いつ作り直したか」★（帳面から読む・消えない）
      ★札(暗証番号あり/まだ)と同じ物から判定する★
      ＝ 2026-08-15 に踏んだ: 帳面だけ見ていたら、同じカードの中で
      「暗証番号あり」と「まだ決めていません」が ★同時に出た★（この仕組みより前に決めた人）。 */
  function pinHistoryOf(p) {
    var rows = (st.pinLog || []).filter(function (r) { return r.employee_id === p.employee_id; });
    if (!rows.length) {
      return p.pw_hash
        ? 'いつ決めたかの記録はありません（この仕組みを入れる前に決めた人です）'
        : 'まだ暗証番号を決めていません';
    }
    var last = rows[rows.length - 1];
    var when = (DB.toJst(last.at) || '').replace('T', ' ');
    var word = last.action === 'pin_reissue' ? '入口を作り直しました' : '暗証番号を決めました';
    return when + '　' + word + (rows.length > 1 ? '（これまで ' + rows.length + '回）' : '');
  }
  function showQr(token) {
    var box = q('qr-' + token);
    if (!box) return;
    if (!global.qrcode) { U.toast('QRの部品を読み込めていません'); return; }
    var qr = global.qrcode(0, 'M');
    qr.addData(linkFor(token));
    qr.make();
    box.innerHTML = qr.createImgTag(4, 8);
  }
  /* ★「最初のあいことば」(init_code) はもう作らない★（2026-08-15 司さんの指摘）
     ＝リンクと同じ口で渡す物なので 守りが増えていなかった。従業員の秘密は暗証番号1つだけ。 */
  function addPerson() {
    var name = q('p-name').value.trim();
    if (!name) { U.toast('氏名を入れてください（給与に渡すときに要ります）'); return; }
    var no = q('p-no').value.trim();
    /* ★押す前に止める★（倉庫でも止まるが、待たせてから断るより先に言う）
       ★空は止めない★＝従業員番号を使っていない会社が実際にある。重なりだけ止める。 */
    if (no && (st.people || []).some(function (p) { return (p.emp_no || '').trim() === no; })) {
      U.toast('この従業員番号は もう使われています（' + no + '）'); q('p-no').focus(); return;
    }
    /* ★同じ氏名は 止めずに知らせる★（同姓同名は本当にある）。
       ただし ★給与の受け口は氏名で人を見分ける★ので、黙って通すと後で取り違える。 */
    var same = (st.people || []).filter(function (p) { return (p.name || '').trim() === name; }).length;
    var hire = (d.querySelector('#p-hire-wrap .tc-date-input') || {}).value || null;
    var yen = q('p-yen').value === '' ? null : Number(q('p-yen').value);
    var pHol = (q('p-hol') || {}).value;
    DB.addPerson({
      account_id: st.user.id,
      employee_id: 'E' + Date.now().toString(36),
      name: name, emp_no: no || null,
      hire_date: hire, hourly_yen: yen,
      /* ★人ごとの法定休日★（空なら会社の決まりに従う） */
      legal_holiday_dow: pHol === '' || pHol == null ? null : Number(pHol),
    }).then(function () {
      U.toast(same ? '入口を作りました（同じ氏名の人が ' + same + '人います。給与は氏名で見分けるので、従業員番号を入れてください）'
        : '入口を作りました');
      q('p-name').value = ''; q('p-no').value = ''; q('p-yen').value = '';
      reload();
    }).catch(function (e) {
      /* ★倉庫が断った時も 人の言葉に直す★（23505＝一意に当たった） */
      if (e && (e.code === '23505' || /duplicate key|already exists/i.test(String(e.message || '')))) {
        U.toast(/emp_no/.test(String(e.message || ''))
          ? 'この従業員番号は もう使われています（' + no + '）'
          : 'この人は もう作られています');
        return;
      }
      failed('作れませんでした')(e);
    });
  }
  /** ★入口を作り直す★＝暗証番号と 覚えた端末を消し、もう一度 決められる状態に戻す。
      ★やった事は帳面に残す★（消さない・上書きしない）＝身に覚えを後から確かめられる。 */
  function reissue(token) {
    var p = (st.people || []).filter(function (x) { return x.token === token; })[0] || {};
    DB.updatePerson(token, { init_code: null, pw_hash: null, device_tokens: [], fail_count: 0, locked_until: null })
      .then(function () {
        return DB.addCloseLog({
          account_id: st.user.id, ym: st.ym, action: 'pin_reissue',
          by_uid: st.user.id, by_name: st.user.email || '',
          employee_id: p.employee_id || '', reason: '',
        });
      })
      .then(function () { U.toast('入口を作り直しました。この人はもう一度 暗証番号を決めます。'); reload(); })
      .catch(failed('できませんでした'));
  }

  /* ── ③ 会社情報 ───────────────────────────────────────────── */
  /* ★入れるのは「時間」・中で持つのは「分」★（司さん 2026-08-14）
     欄の下に「＝◯分」を出す＝★入れた瞬間に、中でどう持つかが見える★ */
  var HOUR_FIELDS = [
    { id: 'c-daily', col: 'daily_std_min', def: 480, maxMin: 24 * 60, label: '1日の所定' },
    { id: 'c-week', col: 'week_std_min', def: 2400, maxMin: 24 * 7 * 60, label: '1週の所定' },
    { id: 'c-break', col: 'break_default_min', def: 60, maxMin: 24 * 60, label: '休憩の既定' },
  ];
  /* ★単位は打たせず 押させる★（2026-08-15 実機）
     スマホの数字キーボードでは ★「分」も「時」も打てない★。
     前の案内「単位を付けてください」は ★その画面で実行できない指示★だった。
     ⇒ 欄の横に「時間」「分」のボタン。数字だけ打てばよい。★既定は「時間」★
     ⇒ 文字で単位を書く道は残す（PCで "45分" "8:30"）。★人に要求はしない★ */
  function unitOf(f) {
    var m = q(f.id + '-m');
    return m && m.getAttribute('aria-selected') === 'true' ? 'minute' : 'hour';
  }
  function setUnit(f, unit) {
    var h = q(f.id + '-h'), m = q(f.id + '-m');
    if (h) h.setAttribute('aria-selected', String(unit !== 'minute'));
    if (m) m.setAttribute('aria-selected', String(unit === 'minute'));
  }
  /** 欄の中身を ★選んでいる単位で★ 読む。
   *  ただし ★文字で単位が書いてあれば そちらが勝つ★（"45分" "8:30" "8時間30分"） */
  function readField(f) {
    var Hs = global.TcHours;
    var text = String((q(f.id) || {}).value || '');
    var written = Hs.unitOf(text);                 // hour / minute / hm / null
    var unit = unitOf(f);
    if (written === 'hour' && unit === 'minute') text = text + '分';   // 数字だけ＋「分」ボタン
    return Hs.read(text, { maxMin: f.maxMin });
  }
  var HOUR_EXAMPLE = '数字だけ入れて、右の「時間」か「分」を押してください';
  function drawHourHint(f) {
    var el = q(f.id + '-hint');
    if (!el) return;
    var Hs = global.TcHours;
    var r = readField(f);
    if (r.error === 'empty') { el.textContent = f.label + 'を入れてください（' + HOUR_EXAMPLE + '）'; return; }
    if (r.error === 'unreadable') { el.textContent = '読めません。' + HOUR_EXAMPLE; return; }
    if (r.error === 'too_big') {
      /* ★止めた本当の理由を言う★（「大きすぎます」だけだと 何が長いのか分からない） */
      el.textContent = Hs.toText(r.read) + '時間（' + r.read + '分）と読みました。'
        + f.label + 'は ' + Hs.toText(f.maxMin) + '時間までです。'
        + '分で入れたい時は 右の「分」を押してください';
      return;
    }
    var extra = '';
    /* ★軽く1つ★ 休憩が1日の所定を超えていたら赤くする */
    if (f.id === 'c-break') {
      var day = readField(HOUR_FIELDS[0]);
      if (day.min != null && r.min > day.min) extra = '　1日の所定より長いです';
    }
    el.textContent = '＝ ' + r.min + '分（中ではこの分数で数えます）' + extra;
    el.className = extra ? 'tc-alert' : 'tc-note';
  }

  function fillCompany() {
    var c = st.company || {};
    var set = function (id, v) { var el = q(id); if (el) el.value = v == null ? '' : v; };
    set('c-name', c.name); set('c-close', c.close_day == null ? 31 : c.close_day);
    HOUR_FIELDS.forEach(function (f) {
      var min = c[f.col] == null ? f.def : c[f.col];
      /* ★読みやすい方の単位で出す★（ちょうどの時間は「時間」／端数は「分」）
         45分を "0:45" と出すより「45」＋「分」の方が読める */
      if (min % 60 === 0) { set(f.id, String(min / 60)); setUnit(f, 'hour'); }
      else { set(f.id, String(min)); setUnit(f, 'minute'); }
      var el = q(f.id);
      if (el && !el._wired) { el._wired = true; el.oninput = function () { drawHourHint(f); }; }
      ['h', 'm'].forEach(function (k) {
        var b = q(f.id + '-' + k);
        if (b && !b._wired) {
          b._wired = true;
          b.onclick = function () { setUnit(f, b.getAttribute('data-unit')); drawHourHint(f); };
        }
      });
      drawHourHint(f);
    });
    /* ★新しい会社の既定は「決めていない」★（勝手に日曜を法定休日にしない） */
    set('c-holmode', c.holiday_mode || 'none');
    set('c-holiday', c.legal_holiday_dow == null ? -1 : c.legal_holiday_dow);
    var cw = q('c-holcycle-wrap');
    if (cw && !cw._wired) { cw._wired = true; cw.innerHTML = U.dateField(c.holiday_cycle_start || '', 'OwnerApp._holNote()'); }
    drawHolidayNote();

    /* 単位の選択肢は lib から作る（画面に数字を書き並べない） */
    var unitSel = q('c-runit');
    if (unitSel && !unitSel.options.length) {
      unitSel.innerHTML = global.TcLaw.ROUND_UNITS.map(function (u) {
        return '<option value="' + u + '">' + (u === 1 ? '1分（丸めない）' : u + '分') + '</option>';
      }).join('');
    }
    /* ★古い設定 daily30 は「自分で決める（30分・切り捨て・日ごと）」と同じ物★
       画面ではそちらに寄せる（保存すると custom になる。数え方は1分も変わらない） */
    var mode = c.rounding || 'none';
    var r = global.TcCalc.normalizeRound(c ? {
      rounding: mode, roundUnitMin: c.round_unit_min, roundDir: c.round_dir, roundScope: c.round_scope,
    } : {});
    set('c-round', mode === 'daily30' ? 'custom' : mode);
    set('c-runit', r.unitMin); set('c-rdir', r.dir); set('c-rscope', r.scope);

    var w = q('c-warn'); if (w) w.checked = !!c.warn_on;
    var cn = q('coname'); if (cn) cn.textContent = c.name || '';
    drawRoundNote();
  }

  /* ★法定休日は「週に1日」が定義そのもの★（労基法35条：毎週少なくとも1日 か 4週4日）
     土日休みでも ★法定休日は1日／もう1日は所定休日（法定外）★＝割増が違う。
     ★特定する義務は無い★（「明確にするのが望ましい」まで）ので、
     ★決めていない会社に アプリが勝手に日曜を決めない★。決めていない間は休日の割増を付けない。 */
  function holCycleValue() {
    var el = d.querySelector('#c-holcycle-wrap .tc-date-input');
    return el ? el.value : '';
  }
  function drawHolidayNote() {
    var n = q('holiday-note'), a = q('holiday-warn');
    var mode = (q('c-holmode') || {}).value || 'none';
    var dow = Number((q('c-holiday') || {}).value);
    if (q('hol-dow')) q('hol-dow').hidden = !(mode === 'dow' || mode === 'per_person');
    if (q('hol-cycle')) q('hol-cycle').hidden = mode !== 'w4d4';

    if (n) {
      n.textContent = '法定休日は「毎週 少なくとも1日」または「4週間を通じて4日以上」です。'
        + '週休2日の会社でも、もう1日は所定休日（法定外）になります。'
        + '祝日は法定休日ではありません（会社が決める所定休日です）。';
    }
    /* 人ごとに上書きしている人が何人 居るか（★黙って散らからせない★） */
    var ov = q('hol-override');
    if (ov) {
      var n2 = (st.people || []).filter(function (p) { return p.legal_holiday_dow != null; }).length;
      ov.textContent = mode === 'per_person'
        ? '会社の決まりを ' + n2 + '人が上書きしています（従業員の欄で決めます）'
        : (n2 ? '※ ' + n2 + '人に人ごとの指定が残っています（この決め方では使いません）' : '');
    }
    if (!a) return;
    a.hidden = true;
    if (mode === 'none') {
      a.hidden = false;
      a.textContent = '法定休日を決めていないので、休日の割増は付けていません　'
        + '就業規則で決めて、ここで選んでください。'
        + '（決めていない状態でこちらが勝手に曜日を決めると、会社が決めていない事を'
        + 'アプリが決めてしまうため、付けていません）';
    } else if ((mode === 'dow' || mode === 'per_person') && dow < 0) {
      a.hidden = false;
      a.textContent = '曜日が未選択です　選ぶまで 休日の割増は付きません。';
    } else if (mode === 'w4d4') {
      a.hidden = false;
      a.textContent = holCycleValue()
        ? '割増になる日が 働き方で動きます　4週に4日の休みが確保できなくなった日から先の'
          + '休日労働が 法定休日労働になります。36協定と割増の管理にご注意ください。'
        : '4週間の起算日を入れてください　入れるまで この決め方では保存できません'
          + '（就業規則等で起算日を明らかにする必要があります）。';
    }
  }

  /** 画面で選んでいる丸め方 */
  function pickedRound() {
    var mode = (q('c-round') || {}).value || 'none';
    return global.TcCalc.normalizeRound({
      rounding: mode,
      roundUnitMin: Number((q('c-runit') || {}).value || 1),
      roundDir: (q('c-rdir') || {}).value || 'floor',
      roundScope: (q('c-rscope') || {}).value || 'day',
    });
  }
  /* ★率や分数を説明文に直書きしない★（lib/tc-law.js の数から作る＝年度で取り残されない）
     ★止めない。選ばせる。ただし黙って選ばせない。★ */
  function drawRoundNote() {
    var LAW = global.TcLaw;
    var mode = (q('c-round') || {}).value || 'none';
    var r = pickedRound();
    var custom = q('round-custom');
    if (custom) custom.hidden = mode !== 'custom';

    var n = q('round-note');
    if (n) {
      n.textContent = '打った時刻そのもの（原本）は、どれを選んでも1分単位のまま残ります。'
        + '変わるのは 集計の見せ方だけです。';
    }

    var law = LAW.roundingLegality(r);
    var a = q('round-warn');
    if (a) {
      if (law.ok) { a.hidden = true; a.textContent = ''; } else {
        a.hidden = false;
        a.textContent = law.code === 'day_cut'
          ? 'これは法律の上ではできない扱いです　1日ごとに、一定時間に満たない労働時間を'
            + '一律に切り捨てて その分の賃金を払わないのは 労働基準法違反になります'
            + '（労働時間は1分単位が原則）。選ぶことはできますが、'
            + '切り捨てた時間と金額を 集計の画面に必ず出します。'
          : '認められている形とは違います　1か月の合計に当てる形で認められているのは、'
            + '1時間未満の端数を ' + LAW.MONTH_FRACTION_HALF_MIN + '分で分ける物'
            + '（' + LAW.MONTH_FRACTION_HALF_MIN + '分未満は切り捨て・'
            + LAW.MONTH_FRACTION_HALF_MIN + '分以上は切り上げ）だけです。'
            + '切り捨てだけ、単位が違う、はその形から外れます。';
      }
    }

    /* ★言葉ではなく 実際の数で見せる★（同じ関数で数えた結果を出す） */
    var ex = q('round-example');
    if (ex) {
      var C = global.TcCalc;
      var samples = [29, 30, 31, 59, 60, 61];
      var line = samples.map(function (m) { return m + '→' + C.adjust(m, r.unitMin, r.dir); }).join('分 / ') + '分';
      ex.textContent = (law.code === 'legal_month' ? 'これは認められている形です（' : '')
        + (r.unitMin <= 1 ? '丸めません（1分単位のまま）'
          : (r.scope === 'day' ? '日ごとの実労働' : '1か月の 時間外・深夜・休日 それぞれの合計')
            + 'に当てます')
        + (law.code === 'legal_month' ? '）' : '')
        + (r.unitMin <= 1 ? '' : '　例: ' + line);
    }
  }

  function saveCompany() {
    /* ★時間で入れて 分で持つ★。読めない欄が1つでもあれば ★保存しない★（黙って0にしない） */
    var vals = {}, bad = [];
    HOUR_FIELDS.forEach(function (f) {
      var r = readField(f);
      if (r.error) bad.push(f.label);
      else vals[f.col] = r.min;
    });
    if (bad.length) { U.toast(bad.join('・') + ' を読めません（' + HOUR_EXAMPLE + '）'); return; }

    /* ★4週4日制は 起算日が無いと保存させない★（空のまま使わせない） */
    var mode = q('c-holmode').value;
    if (mode === 'w4d4' && !holCycleValue()) {
      U.toast('4週4日制は「4週間の起算日」が要ります（就業規則で決めた日を入れてください）');
      return;
    }

    var rmode = q('c-round').value;
    var r2 = pickedRound();
    DB.saveCompany(Object.assign({
      account_id: st.user.id,
      name: q('c-name').value.trim(),
      close_day: Number(q('c-close').value) || 31,
      holiday_mode: mode,
      holiday_cycle_start: holCycleValue() || null,
      /* ★-1（決めていない）を 0（日）に落とさない★（|| だと -1 も 0 も消える） */
      legal_holiday_dow: Number(q('c-holiday').value),
      rounding: rmode,
      round_unit_min: r2.unitMin,
      round_dir: r2.dir,
      round_scope: r2.scope,
      warn_on: !!q('c-warn').checked,
      updated_at: new Date().toISOString(),
    }, vals)).then(function () { U.toast('保存しました'); reload(); })
      .catch(failed('保存できませんでした'));
  }

  /* ── ④ 集計・印刷 ─────────────────────────────────────────── */
  function startShukei() {
    needUser(function () {
      st.ym = thisYm();
      q('b-prev').onclick = function () { shiftYm2(-1); };
      q('b-next').onclick = function () { shiftYm2(1); };
      q('who').onchange = function () { st.who = q('who').value; drawShukei(); };
      q('b-print').onclick = doPrint;
      q('b-csv').onclick = doCsvDaily;
      q('b-kyuyo').onclick = doCsvMonthly;
      q('b-xlsx').onclick = doXlsx;
      q('b-close').onclick = function () { askClose('close'); };
      q('b-reopen').onclick = function () { askClose('reopen'); };
      q('b-cancel').onclick = function () { st.ask = null; drawClose(); };
      q('b-do').onclick = doClose;
      Promise.all([DB.getCompany(), DB.listPeople()]).then(function (r) {
        st.company = r[0] || {};
        st.people = r[1] || [];
        q('who').innerHTML = st.people.map(function (p) {
          return '<option value="' + U.esc(p.employee_id) + '">' + U.esc(p.name || p.employee_id) + '</option>';
        }).join('');
        st.who = st.people.length ? st.people[0].employee_id : '';
        drawShukei();
      }).catch(failed('読めませんでした'));
    });
  }
  function shiftYm2(n) {
    var y = +st.ym.slice(0, 4), m = +st.ym.slice(5, 7) + n;
    if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
    st.ym = y + '-' + pad2(m);
    drawShukei();
  }

  function personOf(id) { return st.people.filter(function (p) { return p.employee_id === id; })[0] || null; }

  function drawShukei() {
    q('ymlabel').textContent = st.ym.replace('-', '年') + '月';
    var p = personOf(st.who);
    if (!p) {
      q('daily').innerHTML = ''; q('total').innerHTML = '';
      q('period').textContent = '従業員がいません。';
      return;
    }
    var per = global.TcCalc.period(st.ym, (st.company && st.company.close_day) || 31);
    q('period').textContent = '対象: ' + per.from + ' 〜 ' + per.to;
    DB.listCloseLog(st.ym).then(function (log) { st.closeLog = log || []; drawClose(); })
      .catch(failed('締めの記録を読めませんでした'));
    Promise.all([
      DB.loadPunches(p.employee_id, per.from, per.to),
      DB.loadShifts(p.employee_id, per.from, per.to),
      DB.listFixes('approved'),
    ]).then(function (r) {
      st.sum = global.TcCalc.summarize({
        ym: st.ym, punches: r[0], shifts: r[1],
        fixes: (r[2] || []).filter(function (f) { return f.employee_id === p.employee_id; })
          .map(function (f) { return { d: f.d, beforeMin: f.before_min, afterMin: f.after_min, reason: f.reason, status: f.status }; }),
        company: Object.assign(coOpts(), {
          hourlyYen: p.hourly_yen, grantDays: grantDaysOf(p), personHolidayDow: p.legal_holiday_dow,
        }),
      });
      renderTables(p);
    }).catch(failed('数えられませんでした'));
  }

  /* ── 締め（受付中／締め待ち／確定） ─────────────────────────────
     ★状態を決めるのは lib/tc-close.js の1本だけ★。
     ここは ★受け取って塗るだけ★（画面で if を書かない＝2画面で答えが割れない）。 */
  function closeState() {
    return global.TcClose.stateOf({
      ym: st.ym,
      closeDay: (st.company && st.company.close_day) || 31,
      today: (DB.nowJst() || '').slice(0, 10),
      log: st.closeLog || [],
    });
  }

  function drawClose() {
    var box = q('closebox');
    if (!box) return;
    if (!st.company) { box.hidden = true; return; }
    var c = closeState();
    st.close = c;
    box.hidden = false;

    q('cstate').textContent = c.label;
    q('cstate').className = 'tc-state ' + c.tone;
    q('cwhen').textContent = c.state === 'closed'
      ? '確定: ' + jstOf(c.closedAt)
      : (c.reopenedAt ? '解除: ' + jstOf(c.reopenedAt) : c.periodFrom + ' 〜 ' + c.periodTo);

    /* ★なぜ押せないか／なぜ気をつけるかは 1か所(why)から出す★ */
    var why = q('cwhy');
    var msg = '', warn = false;
    if (st.ask === 'reopen') { msg = c.why.reopen || '解除すると 数字がまた動きます'; warn = !!c.exportedAt; }
    else if (st.ask === 'close') { msg = 'この月の数字を止めます。後から直すには 解除が要ります'; }
    else if (c.state === 'closed') { msg = c.why.requestFix; }
    else if (c.state === 'pending') { msg = c.why.exportCsv; warn = !!c.why.exportCsv && !!closeRowExists(); }
    else { msg = c.why.close; }
    why.textContent = msg || '';
    why.className = 'tc-why' + (warn ? ' warn' : '');

    q('b-close').hidden = !c.can.close;
    q('b-reopen').hidden = !c.can.reopen;
    q('cpanel').hidden = !st.ask;
    q('b-do').textContent = st.ask === 'reopen' ? '解除を記録して実行' : '確定を記録して実行';
    q('creason').placeholder = st.ask === 'reopen'
      ? '例: 打刻漏れが見つかったため' : '例: 8月分として給与へ渡すため（空でも可）';

    /* ★記録は消さない＝全部そのまま出す★ */
    q('chist').innerHTML = c.history.length
      ? c.history.slice().reverse().map(function (r) {
        return '<span class="tc-histrow">' + U.esc(jstOf(r.at)) + '　'
          + U.esc(global.TcClose.describe(r)) + (r.by_name ? '　' + U.esc(r.by_name) : '') + '</span>';
      }).join('')
      : '';

    /* ★渡す口は 確定していない限り閉じる★（古い数字を配らない） */
    ['b-csv', 'b-kyuyo', 'b-xlsx'].forEach(function (id) {
      var b = q(id);
      if (!b) return;
      b.disabled = !c.can.exportCsv;
      b.title = c.can.exportCsv ? '' : c.why.exportCsv;
    });
  }
  function closeRowExists() { return (st.closeLog || []).some(function (r) { return r.action === 'close'; }); }
  function jstOf(iso) { var v = DB.toJst(iso); return v ? v.replace('T', ' ') : ''; }

  function askClose(kind) {
    st.ask = kind;
    drawClose();
    var el = q('creason');
    el.value = '';
    el.focus();
  }

  function doClose() {
    var kind = st.ask;
    if (!kind) return;
    var reason = (q('creason').value || '').trim();
    if (kind === 'reopen') {
      /* ★止める線は lib/tc-close.js が持つ★（画面で長さを決めない） */
      var v = global.TcClose.canReopen({ reason: reason });
      if (!v.ok) { U.toast(v.msg); q('creason').focus(); return; }
    }
    q('b-do').disabled = true;
    var whoNow = null;
    DB.Auth.user().then(function (u) {
      whoNow = u;
      /* 確定の時だけ ★その時の数字を焼き付ける★（後で食い違いに気づける） */
      return kind === 'close' ? snapshot() : null;
    }).then(function (snap) {
      return DB.addCloseLog({
        account_id: whoNow.id, ym: st.ym, action: kind, by_uid: whoNow.id,
        by_name: whoNow.email || '', reason: reason, snapshot: snap,
      });
    }).then(function () {
      st.ask = null;
      q('b-do').disabled = false;
      U.toast(kind === 'close' ? st.ym + ' を確定しました' : st.ym + ' の確定を解除しました（記録に残ります）');
      return DB.listCloseLog(st.ym).then(function (log) { st.closeLog = log || []; drawClose(); });
    }).catch(function (e) { q('b-do').disabled = false; failed('記録できませんでした')(e); });
  }

  /** ★確定した時の数字★（人数・合計）。後で人が増えても「渡した時はこうだった」が残る */
  function snapshot() {
    return allMonth().then(function (rows) {
      return {
        at_ym: st.ym, people: rows.length,
        rows: rows.map(function (x) {
          return {
            id: x.p.employee_id, name: x.p.name || '',
            worked: x.s.month.workedMin, ot: x.s.month.otMin,
            night: x.s.month.nightMin, holiday: x.s.month.holidayMin,
          };
        }),
      };
    });
  }

  /** ★全員の月計を作るのは この1本だけ★（CSV・Excel・焼き付けが同じ数字になる） */
  function allMonth() {
    var per = global.TcCalc.period(st.ym, (st.company && st.company.close_day) || 31);
    return Promise.all(st.people.map(function (p) {
      return Promise.all([
        DB.loadPunches(p.employee_id, per.from, per.to),
        DB.loadShifts(p.employee_id, per.from, per.to),
      ]).then(function (r) {
        return {
          p: p,
          s: global.TcCalc.summarize({
            ym: st.ym, punches: r[0], shifts: r[1], fixes: [],
            company: Object.assign(coOpts(), { hourlyYen: p.hourly_yen, personHolidayDow: p.legal_holiday_dow }),
          }),
        };
      });
    }));
  }

  /** ★渡す前に必ず通す門★（確定していない月の数字を外へ出さない） */
  function gateExport() {
    var c = st.close || closeState();
    if (c.can.exportCsv) return true;
    U.toast(c.why.exportCsv);
    return false;
  }
  /** 渡した事を記録に残す（★「もう給与へ渡しています」を出すため★） */
  function noteExport() {
    return DB.Auth.user().then(function (u) {
      return DB.addCloseLog({ account_id: u.id, ym: st.ym, action: 'export', by_uid: u.id, by_name: u.email || '' });
    }).then(function () {
      return DB.listCloseLog(st.ym).then(function (log) { st.closeLog = log || []; drawClose(); });
    }).catch(function () { /* 記録できなくても 渡した物は渡した。画面は止めない */ });
  }

  function grantDaysOf(p) {
    if (!p.hire_date) return null;
    var a = new Date(p.hire_date + 'T00:00:00Z'), b = new Date(st.ym + '-01T00:00:00Z');
    var months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    return global.TcLaw.yukyuGrantDays(months);
  }

  function renderTables(p) {
    var s = st.sum;
    var CSV = global.TcCsv;
    var head = CSV.DAILY_HEADERS;
    var aoa = CSV.dailyAoa(s);
    q('daily').innerHTML = '<tr>' + head.map(function (h, i) {
      return '<th class="' + (i <= 1 || i === head.length - 1 ? 'l' : '') + '">' + U.esc(h) + '</th>';
    }).join('') + '</tr>'
      + aoa.slice(1).map(function (row) {
        return '<tr>' + row.map(function (c, i) {
          return '<td class="' + (i <= 1 || i === row.length - 1 ? 'l' : 'num') + '">' + U.esc(c) + '</td>';
        }).join('') + '</tr>';
      }).join('');

    /* ★割増の内訳を全部 出す★（社長が「なぜこれが残業でないのか」を説明できるように）
       ★総労働 ＝ 所定内 ＋ 所定超 ＋ 時間外 ＋ 休日★（深夜は上乗せなので足さない）
       率は ★LAW の数から作る★（説明文に直書きしない） */
    var LAW = global.TcLaw, pc = function (r) { return Math.round(r * 100) + '%'; };
    var m2 = s.month;
    q('total').innerHTML = ''
      + tr('出勤日数', m2.shukkin)
      + tr('総労働', U.minToHm(m2.workedMin))
      + tr('　所定内', U.minToHm(m2.stdMin))
      + tr('　所定超（割増なし）', U.minToHm(m2.overStdMin))
      + tr('　時間外（' + pc(LAW.rateOf('ot')) + '）', U.minToHm(m2.otMin))
      + tr('　　うち月60時間超（' + pc(LAW.rateOf('ot60')) + '）', U.minToHm(m2.ot60Min))
      + tr('　休日（' + pc(LAW.rateOf('holiday')) + '）', U.minToHm(m2.holidayMin))
      + tr('深夜（' + pc(LAW.rateOf('night')) + '・上乗せ）', U.minToHm(m2.nightMin))
      + tr('　うち休日の深夜（' + pc(LAW.rateOf('holiday_night')) + '）', U.minToHm(m2.holidayNightMin))
      + tr('有給消化', m2.yukyu) + tr('有給残', yukyuLeft(p, s)) + tr('欠勤', m2.kekkin);

    /* ★切り捨てた時間と金額は必ず出す（黙って消さない）★ */
    var box = q('cutbox');
    var cut = s.cut;
    if (s.round.unitMin <= 1 || (!cut.workedMin && !cut.otMin && !cut.nightMin && !cut.holidayMin)) {
      box.hidden = true;
    } else {
      box.hidden = false;
      box.textContent = '丸めで動いた分: 実労働 ' + U.minToHm(cut.workedMin)
        + ' / 時間外 ' + U.minToHm(cut.otMin)
        + ' / 深夜 ' + U.minToHm(cut.nightMin)
        + ' / 休日 ' + U.minToHm(cut.holidayMin)
        + '　金額: ' + (cut.yen == null ? '時給が未設定です' : cut.yen.toLocaleString('ja-JP') + '円');
    }

    var w = q('warns');
    var on = st.company && st.company.warn_on;
    if (!s.warnings.length) {
      w.innerHTML = '<div class="tc-note">気づきはありません。</div>';
    } else if (!on) {
      w.innerHTML = '<div class="tc-note">気づきが ' + s.warnings.length
        + ' 件あります（会社情報で「気づきを出す」を入れると中身が出ます）。</div>';
    } else {
      w.innerHTML = s.warnings.map(function (x) {
        return '<div class="tc-alert">' + U.esc(x.detail) + '</div>';
      }).join('');
    }

    U.nameHint(q('namehint'), fileName(p, 'csv'));
  }
  function tr(k, v) { return '<tr><th class="l">' + U.esc(k) + '</th><td class="num">' + U.esc(v) + '</td></tr>'; }
  function yukyuLeft(p, s) {
    var g = grantDaysOf(p);
    if (g == null) return '入社日が未設定';
    return Math.max(0, g - s.month.yukyu);
  }

  function fileName(p, ext) {
    return global.TcName.build({
      kind: '勤怠', company: (st.company || {}).name, person: p ? (p.name || p.employee_id) : '',
      ym: st.ym, stamp: stamp(),
    }, ext);
  }

  /* 印刷 … ★紙だけの新しい窓で刷る／中身が0枚なら開かない★
     ★紙に「どう絞り込んだか」は刷らない★（対象の人と期間だけ書く） */
  function doPrint() {
    var p = personOf(st.who);
    if (!p || !st.sum) { U.toast('先に対象を選んでください'); return; }
    var s = st.sum;
    /* ★紙にも状態を刷る★（確定前の紙が「確定」の顔で回ると、後で数字が動いた時に食い違う）
       ★これは「どう絞り込んだか」ではなく「この数字が動くかどうか」なので刷ってよい★ */
    var c = st.close || closeState();
    var body = '<h1>' + U.esc((st.company || {}).name || '') + '　勤務表</h1>'
      + '<span class="sub">' + U.esc(p.name || p.employee_id) + '　'
      + U.esc(s.period.from) + ' 〜 ' + U.esc(s.period.to) + '　【' + U.esc(c.label) + '】'
      + (c.state === 'closed' ? '' : '　※この数字はまだ動きます') + '</span>'
      + q('daily').outerHTML.replace('class="tc"', '')
      + '<h1 style="margin-top:8px">月計</h1>' + q('total').outerHTML.replace('class="tc"', '');
    U.printPaper(fileName(p, 'pdf').replace(/\.pdf$/, ''), body);
  }

  function doCsvDaily() {
    var p = personOf(st.who);
    if (!p || !st.sum) { U.toast('先に対象を選んでください'); return; }
    if (!gateExport()) return;
    U.deliverText(global.TcCsv.dailyCsv(st.sum), fileName(p, 'csv'));
    noteExport();
  }

  /** ★給与への受け口（全員・1人1行）★ 氏名が空の人がいたら先に知らせる */
  function doCsvMonthly() {
    if (!gateExport()) return;
    var noName = st.people.filter(function (p) { return !(p.name || '').trim(); });
    if (noName.length) { U.toast('氏名が未入力の人が ' + noName.length + '人います（受け取る側で消えます）'); }
    allMonth().then(function (rows) {
      var out = rows.map(function (x) { return { no: x.p.emp_no || '', name: x.p.name, month: x.s.month }; });
      var name = global.TcName.build({
        kind: '勤怠', company: (st.company || {}).name, ym: st.ym, count: out.length, stamp: stamp(),
      }, 'csv');
      U.deliverText(global.TcCsv.monthlyCsv(out), name);
      noteExport();
    }).catch(failed('作れませんでした'));
  }

  /** Excel … ★渡し口は file-out.js だけ★。部品は押した時にだけ読む（軽くしておく） */
  function doXlsx() {
    if (!gateExport()) return;
    load('lib/xlsx.full.min.js').then(function () {
      return allMonth();
    }).then(function (rows) {
      var X = global.XLSX;
      var wb = X.utils.book_new();
      var head = global.TcCsv.MONTHLY_HEADERS;
      var aoa = [head].concat(rows.map(function (x) {
        var m = x.s.month;
        return [x.p.emp_no || '', x.p.name || '', m.shukkin, m.kekkin, m.yukyu,
          global.TcCsv.hhmm(m.workedMin), global.TcCsv.hhmm(m.otMin), global.TcCsv.hhmm(m.ot60Min || 0),
          global.TcCsv.hhmm(m.nightMin), global.TcCsv.hhmm(m.holidayMin), global.TcCsv.hhmm(m.holidayNightMin || 0)];
      }));
      var ws = X.utils.aoa_to_sheet(aoa);
      /* ★列幅を付けないと 相手の画面で ######## になる★（前科あり）＝見出しの数だけ用意する */
      ws['!cols'] = head.map(function (h) { return { wch: Math.max(10, h.length * 2 + 2) }; });
      X.utils.book_append_sheet(wb, ws, '月計');
      rows.forEach(function (x) {
        var d2 = X.utils.aoa_to_sheet(global.TcCsv.dailyAoa(x.s));
        d2['!cols'] = global.TcCsv.DAILY_HEADERS.map(function () { return { wch: 10 }; });
        X.utils.book_append_sheet(wb, d2, String(x.p.name || x.p.employee_id).slice(0, 28));
      });
      var out = X.write(wb, { bookType: 'xlsx', type: 'array' });
      var name = global.TcName.build({
        kind: '勤怠', company: (st.company || {}).name, ym: st.ym, count: rows.length, stamp: stamp(),
      }, 'xlsx');
      return global.FileOut.deliver(out, name).then(function () {
        U.toast('「' + name + '」を保存しました');
        return noteExport();
      });
    }).catch(failed('作れませんでした'));
  }

  var _loaded = {};
  function load(src) {
    if (_loaded[src]) return _loaded[src];
    _loaded[src] = new Promise(function (res, rej) {
      var s = d.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = function () { rej(new Error(src + ' を読み込めません')); };
      d.body.appendChild(s);
    });
    return _loaded[src];
  }

  global.OwnerApp = {
    startLogin: startLogin, startIndex: startIndex, startShukei: startShukei,
    _st: st, _grantDaysOf: grantDaysOf, _fileName: fileName, _pinHistoryOf: pinHistoryOf,
    _holNote: drawHolidayNote,
  };
})(typeof window !== 'undefined' ? window : globalThis);
