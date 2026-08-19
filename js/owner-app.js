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
  /* ★今日★ … 数える所へ渡すのは ★「今日はまだ働いている」を聞かない為だけ★。
     lib/ は 時計を持たない（毎回 同じ答えになる）ので、画面が渡す。 */
  function todayJst() { return (DB.nowJst() || '').slice(0, 10) || null; }
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

  /** ★うまく行った時は 赤で出さない★（2026-08-16 司さんが本番で止まった）
   *  ＝登録は成功しているのに 赤い箱に出ると ★失敗に見える★。ok=true で緑の箱にする。 */
  function alertBox(id, msg, ok) {
    var el = q(id);
    if (!el) { U.toast(msg); return; }
    el.textContent = msg || '';
    el.className = 'tc-alert' + (ok ? ' ok' : '');
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
    /* ★登録したら そのまま入る★（2026-08-16 司さんが本番の実機で止まった）
       ★確認メールは 来ません★＝倉庫の設定が mailer_autoconfirm=true（指示役が実測）。
       それなのに「メールが届いていたら…」と出していたので ★人が待ってしまった★。
       ⇒ ①言葉を実物に合わせる ②赤で出さない ③★もう一度 打たせない（そのまま入る）★ */
    q('b-new').onclick = function () {
      var email = q('email').value.trim();
      var pw = q('pw').value;
      if (pw.length < 8) { alertBox('alert', 'パスワードは8文字以上にしてください。'); return; }
      DB.Auth.signUp(email, pw).then(function (r) {
        if (r.error) { alertBox('alert', '登録できませんでした（' + r.error.message + '）'); return; }
        alertBox('alert', '登録しました。そのまま中へ入ります。', true);
        /* 入れなかった時だけ ★次に押す物を1つだけ★言う（メールの話はしない） */
        DB.Auth.signIn(email, pw).then(function (s) {
          if (s.error) { alertBox('alert', '登録しました。そのまま「入る」を押してください。', true); return; }
          global.location.href = 'index.html';
        });
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
      /* ★押した時だけ 出す物★（既定で使う人の画面を短くする・2026-08-16） */
      q('b-round-ex').onclick = function () {
        var ex = q('round-example');
        ex.hidden = !ex.hidden;
        q('b-round-ex').textContent = ex.hidden ? '例を見る' : '例を閉じる';
      };
      q('b-warn-more').onclick = function () {
        var rest = q('round-warn-rest');
        rest.hidden = !rest.hidden;
        q('b-warn-more').textContent = rest.hidden ? 'くわしく' : '閉じる';
      };
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
      drawHireAsk();
      return drawFixes(r[2] || []);
    }).then(drawSummary).then(drawMust5)
      .catch(failed('読めませんでした'));
  }

  function coOpts() {
    var c = st.company || {};
    return {
      dailyStdMin: c.daily_std_min, weekLegalMin: c.week_legal_min, closeDay: c.close_day,
      /* ★休憩の既定★（2026-08-15）… ここで渡さないと ★会社の設定が効かない★
         （前は誰も使っていなかったので、渡し忘れても気づけなかった） */
      breakDefaultMin: c.break_default_min,
      rounding: c.rounding, roundUnitMin: c.round_unit_min, roundDir: c.round_dir, roundScope: c.round_scope,
      holidayMode: c.holiday_mode, legalHolidayDow: c.legal_holiday_dow,
      holidayCycleStart: c.holiday_cycle_start,
      weekStartDow: c.week_start_dow,
      sme: c.sme,
    };
  }

  /* ★箱は2つ★（指示役 2026-08-18 夜「1つの箱に もう入った物と まだの物が混ざっている」）
       ①「直した記録」  … ★もう入っている★＝★押す物を出さない★（誰が・いつ・何を だけ）
       ②「まだ入っていません」… ★承認前の古い分だけ★＝［入れる］［入れない］
     ★どちらも 0件なら 見出しごと出さない★（もう無い物のボタンを見せない）。
     ★件数は 見出しに出す★（どちらの箱の話か 数で分かるように）。
     ＝2026-08-18 司さんの決まり「自分の打刻は自分で直せる」により、
       従業員は もう「お願い」を出さない（その場で入る）＝②は 古い分だけ。 */
  function drawFixes(fixes) {
    var box = q('fixes'), head = q('fixes-head');
    var pbox = q('pend'), phead = q('pend-head');
    if (!box || !pbox) return Promise.resolve();
    var pending = fixes.filter(function (f) { return f.status === 'pending'; });
    var done = fixes.filter(function (f) { return f.status !== 'pending'; }).slice(0, 20);

    /* ①もう入っている分＝★ボタンを出さない★（数える前に描いてよい＝数字はもう決まっている） */
    if (head) { head.hidden = !done.length; head.textContent = '直した記録（' + done.length + '件）'; }
    box.innerHTML = done.map(function (f) {
      return '<div class="tc-card"><div class="tc-cardhead"><b>' + U.esc(nameOf(f.employee_id)) + '</b>'
        + ' <span class="num">' + U.esc(f.d) + '</span>'
        + '<span class="tc-tag">' + (f.status !== 'approved' ? '入れなかった'
          : (f.requested_by === 'employee' && f.approved_by === 'employee') ? '本人が直した' : '入れた')
        + '</span>'
        + '</div><div>' + (f.before_min == null ? '' : '元は ' + f.before_min + '分 → ' + f.after_min + '分')
        + (f.reason ? '　理由: ' + U.esc(f.reason) : '') + '</div></div>';
    }).join('');

    /* ②まだ入っていない分 */
    if (phead) { phead.hidden = !pending.length; phead.textContent = 'まだ入っていません（' + pending.length + '件）'; }
    if (!pending.length) { pbox.innerHTML = ''; return Promise.resolve(); }

    /* 入れる前に「今どうなっていて、入れると何分になるか」を実際に数えて見せる */
    return Promise.all(pending.map(function (f) {
      return Promise.all([
        DB.loadPunches(f.employee_id, f.d, f.d, { includePending: false }),
        DB.loadPunches(f.employee_id, f.d, f.d, { includePending: true }),
      ]).then(function (p) {
        /* ★「この1本は使わない」古い分★（2026-08-18）＝入れると その打刻が外れる。
           ★外した姿で数えないと「元は0分 → 入れると0分」と出て 何も変わらないように見える★
           （実際に変わるのは そこ）。★数えるのは いつもの summarize 1本のまま★。 */
        var kill = f.void_ids || [];
        var after = p[1].filter(function (x) { return kill.indexOf(x.id) < 0; });
        var b4 = one(p[0], f.d), af = one(after, f.d);
        f._before = b4.workMin;
        f._after = af.workMin;
        /* ★数字が動かない直しも在る★（2026-08-18 実配信で見た）
           ＝まだ退勤が入っていない日の「時刻の直し」は 前も後も0分。
           ★0→0 と出すと「何も起きない」に見える★ので、何が起きるのかを言う。 */
        f._same = (b4.workMin === af.workMin);
        f._open = !!(af.incomplete || af.undecided);
        return f;
      }).catch(function () { f._before = null; f._after = null; return f; });
    })).then(function (rows) {
      pbox.innerHTML = rows.map(function (f) {
        var name = nameOf(f.employee_id);
        return '<div class="tc-card pending"><div class="tc-cardhead">'
          + '<b>' + U.esc(name) + '</b> <span class="num">' + U.esc(f.d) + '</span>'
          + '<span class="tc-tag pending">まだ入っていません</span><span class="tc-spacer"></span>'
          + '<button class="tc-btn" type="button" data-ok="' + U.esc(f.id) + '">入れる</button>'
          + '<button class="tc-btn danger" type="button" data-ng="' + U.esc(f.id) + '">入れない</button>'
          + '</div><div>'
          + (f._before == null ? '（数えられませんでした）'
            : !f._same ? '元は ' + f._before + '分 → 入れると ' + f._after + '分'
              : f._open ? '数字は変わりません（この日は まだ退勤が入っていません）'
                : '数字は変わりません（時刻の直し）')
          + (f.reason ? '　理由: ' + U.esc(f.reason) : '') + '</div></div>';
      }).join('');

      Array.prototype.forEach.call(pbox.querySelectorAll('[data-ok]'), function (b) {
        b.onclick = function () {
          var f = rows.filter(function (x) { return x.id === b.getAttribute('data-ok'); })[0];
          /* ★社長1人の会社は「自分で入れた」と残す（誰がやったかを消さない）★ */
          var self = f && f.requested_by === 'owner';
          DB.client().from('tc_fix').update({ before_min: f._before, after_min: f._after })
            .eq('id', f.id).then(function () {
              return DB.approveFix(f.id, st.user.id, self);
            }).then(function () { U.toast('入れました'); reload(); })
            .catch(failed('できませんでした'));
        };
      });
      Array.prototype.forEach.call(pbox.querySelectorAll('[data-ng]'), function (b) {
        b.onclick = function () {
          DB.rejectFix(b.getAttribute('data-ng'), st.user.id)
            .then(function () { U.toast('入れませんでした'); reload(); })
            .catch(failed('できませんでした'));
        };
      });
    });
  }

  function one(punches, day) {
    var s = global.TcCalc.summarize({ ym: day.slice(0, 7), punches: punches, shifts: [], fixes: [], company: coOpts(), today: todayJst() });
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
          ym: st.ym, punches: r[0], shifts: r[1], fixes: [], today: todayJst(),
          company: Object.assign(coOpts(), { hourlyYen: p.hourly_yen, personHolidayDow: p.legal_holiday_dow }),
        });
        return { p: p, s: s };
      });
    })).then(function (rows) {
      /* ★1つも打刻が無い月に 0:00 が並ぶ表を黙って出さない★（2026-08-16 司さん）
         ＝入れたばかりの会社は ★必ずこの姿から始まる★。何をすればよいかを1行で言う。 */
      var anyPunch = rows.some(function (x) { return x.s.month.shukkin > 0 || x.s.month.workedMin > 0; });
      if (!anyPunch) {
        box.innerHTML = '<div class="tc-note">' + U.esc(st.ym.replace('-', '年') + '月')
          + ' は まだ打刻がありません。従業員が入口のリンクから打つと、ここに出ます。</div>';
        return;
      }
      /* ★割増が要る時数を 一覧にも出す★（うち60超＝50%・うち休日の深夜＝60%）
         ★0の人は空欄★（出ている人だけ目立たせる） */
      /* ★「気づき」の列は 2026-08-15 に外した★（司さんの決定）
         ＝★列が1つ減って 1画面に入る件数が増える★ */
      box.innerHTML = '<div class="tc-tablewrap"><table class="tc"><thead><tr>'
        + '<th class="l">氏名</th><th>出勤</th><th>実労働</th><th>時間外</th><th>うち60超</th>'
        + '<th>深夜</th><th>休日</th><th>うち休日の深夜</th></tr></thead><tbody>'
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
            + '<td class="num">' + z(m.holidayNightMin) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(failed('数えられませんでした'));
  }

  /* ── ★入社日を 1人ずつ聞く★（2026-08-19 指示役④-①） ─────────────────
     ＝★入社日が空の人が 18人中14人★（実測）。空のままだと ★8割の人の有給が数えられない★。
     ★聞いてあげる。埋めさせない★（全アプリの決まり）:
       ・★別の画面を作らない★（従業員の画面の中で1問だけ）
       ・★1問ごと保存★／★答えたら その場で結果（残り）を返す★
       ・★空のままでも進める★（「あとで」）／★全員 入っていれば 箱ごと出さない★ */
  var hireSkip = {};        /* 「あとで」を押した人（この画面を開いている間だけ後ろに回す） */
  function hireLeft() {
    return st.people.filter(function (p) { return !p.hire_date && !hireSkip[p.token]; });
  }
  function drawHireAsk() {
    var box = q('hire-ask');
    if (!box) return;
    var yet = st.people.filter(function (p) { return !p.hire_date; });
    var list = hireLeft();
    if (!list.length) {
      box.hidden = true; box.innerHTML = '';
      return;
    }
    box.hidden = false;
    var p = list[0];
    box.innerHTML = '<div class="tc-card"><div class="tc-cardhead">'
      + '<b>' + U.esc(p.name || p.employee_id) + '</b>さんの入社日は？'
      + '<span class="tc-spacer"></span>'
      + '<span class="num">入社日が入っていない人 ' + yet.length + '人／' + st.people.length + '人</span>'
      + '</div>'
      + '<div class="tc-note">有給の残りを数えるのに使います。分かる時だけで大丈夫です。</div>'
      + '<div id="hire-field"></div>'
      + '<p><button class="tc-btn" id="b-hire-save" type="button">決める</button>'
      + ' <button class="tc-btn quiet" id="b-hire-later" type="button">あとで</button></p>'
      + '<div class="tc-note" id="hire-result" hidden></div></div>';
    q('hire-field').innerHTML = U.dateField('', 'OwnerApp._hirePreview()');
    q('b-hire-later').onclick = function () { hireSkip[p.token] = true; drawHireAsk(); };
    q('b-hire-save').onclick = function () { saveHire(p); };
    hirePreview();
  }
  function hireInput() {
    var f = q('hire-field');
    return (f && f.querySelector('.tc-date-input')) || null;
  }
  /** ★答えたら その場で返す★（保存する前に「その日なら こうなります」を見せる） */
  function hirePreview() {
    var el = q('hire-result'), inp = hireInput();
    if (!el || !inp) return;
    var v = inp.value;
    if (!v) { el.hidden = true; el.textContent = ''; return; }
    var y = global.TcLaw.yukyuLeft({ hireDate: v, today: todayJst(), takenDays: [] });
    el.hidden = false;
    el.textContent = y.ok
      ? 'この日なら 有給の残り ' + y.leftDays + '日（付与 ' + y.grantDays + ' ＋ 繰越 ' + y.carryDays + '）'
      : y.why;
  }
  function saveHire(p) {
    var inp = hireInput();
    if (!inp || !inp.value) { U.toast('入社日を選んでください'); return; }
    DB.updatePerson(p.token, { hire_date: inp.value })
      .then(function () { U.toast((p.name || '') + 'さんの入社日を入れました'); reload(); })
      .catch(failed('入れられませんでした'));
  }

  /* ── ★年5日★（2026-08-19 指示役④-②） ─────────────────────────
     ★10日以上 付いた人だけ★に「あと◯日（期限 ◯年◯月◯日）」を出す。
     ★判定は lib/tc-yukyu.js の1か所★（画面で日数を書かない＝法定の数を直書きしない）。
     ★0人なら 見出しごと出さない★。 */
  function drawMust5() {
    var box = q('must5'), head = q('must5-head');
    if (!box) return Promise.resolve();
    if (!st.people.length) { box.innerHTML = ''; if (head) head.hidden = true; return Promise.resolve(); }
    /* ★繰越（前の1年）まで見るので 2年ぶん読む★／★全員ぶんを1回で読む★ */
    var to = todayJst();
    var from = (Number(to.slice(0, 4)) - 2) + to.slice(4);
    return DB.loadShiftsAll(from, to).then(function (rows) {
      var byEmp = {};
      rows.filter(function (x) { return x.dayKind === 'paid_leave'; })
        .forEach(function (x) { (byEmp[x.employeeId] = byEmp[x.employeeId] || []).push(x.d); });
      var hit = st.people.map(function (p) {
        return { p: p, m: global.TcLaw.must5State({
          hireDate: p.hire_date || null, today: to, takenDays: byEmp[p.employee_id] || [],
        }) };
      }).filter(function (x) { return x.m.target && x.m.needDays > 0; });
      if (head) { head.hidden = !hit.length; head.textContent = '年5日（' + hit.length + '人）'; }
      box.innerHTML = hit.map(function (x) {
        return '<div class="tc-card"><div class="tc-cardhead">'
          + '<b>' + U.esc(x.p.name || x.p.employee_id) + '</b>'
          + '<span class="tc-spacer"></span>'
          + '<span class="tc-tag pending">あと ' + x.m.needDays + '日</span></div>'
          + '<div>期限 ' + U.esc(jpDate(x.m.byDate)) + '（いま ' + x.m.usedDays + '日）</div></div>';
      }).join('');
    }).catch(function () { /* 読めなくても 他の表示は止めない */ });
  }
  function jpDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? (+m[1]) + '年' + (+m[2]) + '月' + (+m[3]) + '日' : String(iso || '');
  }

  /* ── ② 従業員（入口の発行・QR） ─────────────────────────────── */
  /** ★従業員は 1人1行★（2026-08-16 司さん「増えるとごちゃごちゃ」）
   *  前は 1人に 194px 使っていて ★390×844 の画面に2人しか入らなかった★（実測）。
   *  ＝20人の会社では ★画面が20倍★になる。
   *  ⇒ ★氏名＋状態＋「>」だけ★を並べ、★押した人の分だけ★中を開く。
   *    長いURLは ★出さずに「リンクをコピー」1つ★（読ませる物ではないため）。 */
  var peopleFilter = 'all';
  function drawPeople() {
    var box = q('people'), head = q('people-count'), tabs = q('people-filter');
    if (!box) return;
    if (!st.people.length) {
      if (head) head.textContent = '';
      if (tabs) tabs.hidden = true;
      box.innerHTML = '<div class="tc-note">まだ登録がありません。下の「追加する」から1人ずつ作ります。</div>';
      return;
    }
    var yet = st.people.filter(function (p) { return !p.pw_hash; }).length;
    if (head) {
      /* ★何の状態かが 一目で分かる言葉にする★（2026-08-16 司さん「ぜんぶとかまだって何」）
         ＝この画面で見たいのは ★その人が もう打てるのか★の1点。 */
      head.textContent = '従業員 ' + st.people.length + '人'
        + (yet ? '（うち ' + yet + '人は まだ打てません）' : '（全員 打てます）');
    }
    if (tabs) {
      tabs.hidden = false;
      Array.prototype.forEach.call(tabs.querySelectorAll('[data-filter]'), function (b) {
        var on = b.getAttribute('data-filter') === peopleFilter;
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        b.onclick = function () { peopleFilter = b.getAttribute('data-filter'); drawPeople(); };
      });
    }
    var list = st.people.filter(function (p) { return peopleFilter === 'yet' ? !p.pw_hash : true; });
    if (!list.length) {
      box.innerHTML = '<div class="tc-note">まだ打てない人はいません（全員 暗証番号を決めています）。</div>';
      return;
    }
    box.innerHTML = list.map(function (p) {
      var t = U.esc(p.token);
      return '<div class="tc-row">'
        + '<button class="tc-rowhead" type="button" data-open="' + t + '" aria-expanded="false">'
        + '<span class="tc-rowname">' + U.esc(p.name || p.employee_id) + '</span>'
        + (p.pw_hash ? '<span class="tc-tag">打てます</span>'
          : '<span class="tc-tag pending">まだ打てません</span>')
        + '<span class="tc-chev">›</span></button>'
        + '<div class="tc-rowbody" id="row-' + t + '" hidden>'
        + '<div class="tc-tabs">'
        + '<button class="tc-btn sub" type="button" data-copy="' + t + '">リンクをコピー</button>'
        + '<button class="tc-btn sub" type="button" data-qr="' + t + '">QRを出す</button>'
        + '<button class="tc-btn sub" type="button" data-re="' + t + '">入口を作り直す</button>'
        + '</div>'
        /* ★いつ決めたかを出す★（身に覚えの無い日時なら 社長が気づける）
           秘密を1つに減らした分の埋め合わせ（司さん 2026-08-15） */
        + '<div class="tc-when">' + U.esc(pinHistoryOf(p)) + '</div>'
        + '<div id="qr-' + t + '"></div></div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-open]'), function (b) {
      b.onclick = function () {
        var body = q('row-' + b.getAttribute('data-open'));
        body.hidden = !body.hidden;
        b.setAttribute('aria-expanded', body.hidden ? 'false' : 'true');
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-copy]'), function (b) {
      b.onclick = function () { copyLink(b.getAttribute('data-copy')); };
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-qr]'), function (b) {
      b.onclick = function () { showQr(b.getAttribute('data-qr')); };
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-re]'), function (b) {
      b.onclick = function () { reissue(b.getAttribute('data-re')); };
    });
  }
  /** ★リンクは「見せる物」ではなく「渡す物」★＝コピーだけできればよい。
   *  ★コピーできない機械でも 行き止まりにしない★（できなければ その場に出す）。 */
  function copyLink(token) {
    var url = linkFor(token);
    var nav = global.navigator;
    if (nav && nav.clipboard && nav.clipboard.writeText) {
      nav.clipboard.writeText(url).then(function () { U.toast('リンクをコピーしました'); },
        function () { showLink(token, url); });
      return;
    }
    showLink(token, url);
  }
  function showLink(token, url) {
    var box = q('qr-' + token);
    if (!box) { U.toast(url); return; }
    box.innerHTML = '<div class="tc-note" style="word-break:break-all">' + U.esc(url) + '</div>';
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
    if (f.id === 'c-break' || f.id === 'c-daily') drawBreakLaw();
  }

  /** ★休憩の既定が 法律で必要な分を下回っていないか★（会社情報のその場で言う・2026-08-15）
      ★黙って引き上げない★＝数字は会社が入れた物のまま使う。ここは言うだけ。
      法定の線は lib/tc-law.js が持つ（説明文に数字を直書きしない）。 */
  function drawBreakLaw() {
    var box = q('c-break-law');
    if (!box) return;
    var std = readField(HOUR_FIELDS[0]), brk = readField(HOUR_FIELDS[2]);
    if (std.min == null || brk.min == null) { box.hidden = true; box.textContent = ''; return; }
    var r = global.TcLaw.breakDefaultCheck(std.min, brk.min);
    box.hidden = !r.short;
    box.textContent = r.short
      ? '休憩の既定（' + brk.min + '分）が、法律で必要な分（' + r.need + '分）を下回っています。'
        + '1日の所定どおり働くと拘束 ' + U.minToHm(r.spanMin) + ' になるためです。'
        + '会社の決まりを直してください（数字は勝手に変えていません）'
      : '';
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
      var ovText = mode === 'per_person'
        ? '会社の決まりを ' + n2 + '人が上書きしています（従業員の欄で決めます）'
        : (n2 ? '※ ' + n2 + '人に人ごとの指定が残っています（この決め方では使いません）' : '');
      /* ★中身が空なら 箱ごと消す★（.tc-note には枠が付いているので
         ★文字を空にしただけでは 空の枠が残る★＝2026-08-15 実機で また出た） */
      ov.textContent = ovText;
      ov.hidden = !ovText;
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

    /* ★2行に収める★（2026-08-16 司さん「分かりにくい」・390pxで実測して3行だった） */
    var n = q('round-note');
    /* ★「見せ方」ではない★（2026-08-16 司さん）＝ここで決めるのは
       ★会社の決まり（賃金を数える時の丸め方）★。打った時刻の原本は消えない、という話は
       ★決まりの説明として★書く（「見せ方だけ」と言い切らない）。 */
    if (n) n.textContent = '会社の決まりとして、賃金を数える時の丸め方を決めます。打った時刻そのもの（原本）は1分単位で残ります。';

    var law = LAW.roundingLegality(r);
    var a = q('round-warn'), head = q('round-warn-head'), rest = q('round-warn-rest');
    if (a && head && rest) {
      if (law.ok) {
        a.hidden = true; head.textContent = ''; rest.textContent = '';
      } else {
        a.hidden = false;
        /* ★頭の1行＝結論だけ★／★続き＝理由と法律★（押すと出る） */
        head.textContent = law.code === 'day_cut'
          ? 'これは法律の上ではできない扱いです。'
          : '認められている形とは違います。';
        rest.textContent = law.code === 'day_cut'
          ? '　1日ごとに、一定時間に満たない労働時間を'
            + '一律に切り捨てて その分の賃金を払わないのは 労働基準法違反になります'
            + '（労働時間は1分単位が原則）。選ぶことはできますが、'
            + '切り捨てた時間と金額を 集計の画面に必ず出します。'
          : '　1か月の合計に当てる形で認められているのは、'
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
      q('who').onchange = function () { st.who = q('who').value; st.dayIdx = null; drawShukei(); };
      q('b-print').onclick = function () { doPrint(false); };
      /* ★紙のとおりに見る★（刷らずに A4横のまま見せる・指で広げて読める） */
      q('b-preview').onclick = function () { doPrint(true); };
      q('b-printall').onclick = doPrintAll;
      q('b-csv').onclick = doCsvDaily;
      q('b-kyuyo').onclick = doCsvMonthly;
      q('b-xlsx').onclick = doXlsx;
      /* ★休憩を日ごとに直す★（押させる。打たせない） */
      Array.prototype.forEach.call(d.querySelectorAll('[data-bm]'), function (b) {
        b.onclick = function () {
          var v = b.getAttribute('data-bm');
          saveDayBreak(v === '' ? null : Number(v));
        };
      });
      q('brk-day').onchange = drawBreakNote;
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
    st.dayIdx = null;   /* ★月を変えたら 開いていた日は閉じる★（同じ番号の別の日を開かない） */
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
    /* ★有給の残りは「付けた日」を数えて出す★（2026-08-19・倉庫に残り日数の列は作らない）
       ＝繰越は前の1年ぶんまで（時効2年）なので、★2年ぶん読む★。 */
    var wide = { from: (Number(per.from.slice(0, 4)) - 2) + per.from.slice(4), to: per.to };
    Promise.all([
      DB.loadPunches(p.employee_id, per.from, per.to),
      DB.loadShifts(p.employee_id, per.from, per.to),
      DB.listFixes('approved'),
      DB.loadShifts(p.employee_id, wide.from, wide.to),
    ]).then(function (r) {
      st.yukyu = global.TcLaw.yukyuLeft({
        hireDate: p.hire_date || null, today: todayJst(),
        takenDays: (r[3] || []).filter(function (x) { return x.dayKind === 'paid_leave'; })
          .map(function (x) { return x.d; }),
      });
      st.sum = global.TcCalc.summarize({
        ym: st.ym, punches: r[0], shifts: r[1], today: todayJst(),
        fixes: (r[2] || []).filter(function (f) { return f.employee_id === p.employee_id; })
          .map(function (f) {
            return { d: f.d, beforeMin: f.before_min, afterMin: f.after_min, reason: f.reason,
              status: f.status, requestedBy: f.requested_by, approvedBy: f.approved_by };
          }),
        company: Object.assign(coOpts(), {
          hourlyYen: p.hourly_yen, grantDays: grantDaysOf(p), personHolidayDow: p.legal_holiday_dow,
        }),
      });
      renderTables(p);
      fillBreakDays();
      /* ★押した後も 同じ日を開いたままにする★（押すたびに箱が閉じると 残りが読めない） */
      if (st.dayIdx != null && st.sum && st.sum.days && st.sum.days[st.dayIdx]) drawDayBox(st.dayIdx);
    }).catch(failed('数えられませんでした'));
  }

  /* ── 休憩を日ごとに直す ─────────────────────────────────────
     ★休憩は押させず 会社の既定を引く★（2026-08-15）。
     ただし ★本当に休憩が取れなかった日★は在るので、ここで直せる。
     ★誰が・いつ 直したかを残す★（後で「なぜこの日だけ違うのか」が言える）。 */
  var BREAK_SRC_WORD = { punch: '打刻から', fixed: '直した値', default: '会社の既定から', none: '（6時間以下なので引きません）' };

  function fillBreakDays() {
    var sel = q('brk-day');
    if (!sel || !st.sum) return;
    var keep = sel.value;
    var list = st.sum.days.filter(function (x) { return x.workMin > 0 || x.breakMin > 0; });
    sel.innerHTML = list.map(function (x) {
      return '<option value="' + U.esc(x.d) + '">' + U.esc(x.d.slice(5).replace('-', '/'))
        + '（' + U.dowOf(x.d) + '）</option>';
    }).join('');
    if (keep && list.some(function (x) { return x.d === keep; })) sel.value = keep;
    drawBreakNote();
  }

  function drawBreakNote() {
    var el = q('brknote'), sel = q('brk-day');
    if (!el || !st.sum) return;
    var day = (st.sum.days || []).filter(function (x) { return x.d === (sel && sel.value); })[0];
    if (!day) { el.textContent = 'この月は 直せる日がありません。'; el.hidden = false; return; }
    el.hidden = false;
    el.textContent = day.d + '　拘束 ' + U.minToHm(day.spanMin) + '／休憩 ' + day.breakMin + '分'
      + '（' + (BREAK_SRC_WORD[day.breakSrc] || day.breakSrc) + '）'
      + '／実労働 ' + U.minToHm(day.workMin);

    /* ★直した日を1か所にまとめて出す★（どの日を触ったか 後から分かる） */
    var fixed = (st.sum.days || []).filter(function (x) { return x.breakSrc === 'fixed'; });
    var box = q('brkfixed');
    if (box) {
      box.hidden = !fixed.length;
      box.textContent = fixed.length
        ? '直した日: ' + fixed.map(function (x) {
          return x.d.slice(5).replace('-', '/') + ' ' + x.breakMin + '分'
            + (x.breakAt ? '（' + (DB.toJst(x.breakAt) || '').replace('T', ' ') + '）' : '');
        }).join('　')
        : '';
    }
  }

  function saveDayBreak(minOrNull) {
    var sel = q('brk-day');
    var p = personOf(st.who);
    if (!p || !sel || !sel.value) { U.toast('先に日を選んでください'); return; }
    /* ★確定した月は 数字を動かさない★（可否は締めの1か所から聞く） */
    var c = st.close || closeState();
    if (c.state === 'closed') { U.toast(c.why.requestFix); return; }
    DB.saveDayBreak(st.user.id, p.employee_id, sel.value, minOrNull, st.user.id)
      .then(function () {
        U.toast(minOrNull == null ? sel.value + ' を会社の既定にもどしました'
          : sel.value + ' の休憩を ' + minOrNull + '分にしました');
        drawShukei();
      })
      .catch(failed('直せませんでした'));
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
            ym: st.ym, punches: r[0], shifts: r[1], fixes: [], today: todayJst(),
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

  /* ★日ごとの表の作り（2026-08-15 司さんの指摘で作り直した）★
     ・★日付に年は要らない★（期間は見出しに1回 出る）。★月をまたぐ締めの時だけ 月を出す★
     ・★列ごとに幅を決める★（%で合計100）＝17列が中身に関係なく並ぶのをやめる
     ・★見出しは2段★（何の仲間か 一目で分かる）
     ・★0なら空欄★（遅刻・早退・有給・欠勤・深夜・休日・中抜け）。★実労働は0でも出す★
     ・★土日と法定休日に薄い網★（紙のCSSだけ。画面の色は増やさない）
     ・★一番下に合計行★（月計と突き合わせられる）
     ※ ★CSVは触っていない★（機械が読む物なので 年つきの日付・0は0のまま） */
  /* ★揃えの決まり（2026-08-15 司さんの指摘・全アプリ共通）★
       ★数字（金額・時間・件数）＝ 右★（桁が縦に揃う）
       ★言葉（名前・備考）      ＝ 左★
       ★日付                    ＝ 右★（数字だから。「8/14」も右で揃う）
       ★1文字の列（曜日）        ＝ 中央★
       ★見出しは 中身と同じ揃え★／★中央を使ってよいのは「1文字の列」だけ★
     a: 省略＝右 / 'l' / 'c'
     ★有給・欠勤は「件数」なので右★（1文字に見えるが 合計行では 2 のような数になる。
      ★上下の桁が縦に揃う方を採る★） */
  /* g … ★仲間の名前★（1段目の見出しと同じ）。
     ★スマホでは 仲間ごと まるごと隠す★（2026-08-16 司さん「横スクロールせずに見せられないか」）
     ＝1列ずつ隠すと ★1段目の見出しの colspan と数が合わなくなって 表がずれる★。
     ★仲間ごとなら 何列 隠しても 2段の見出しが崩れない★。
     紙（A4横）では ★17列 全部 出す★（隠すのは 狭い画面だけ）。 */
  var DAILY_COLS = [
    { k: '日付', w: 4, g: 'hi' }, { k: '曜日', w: 3, a: 'c', g: 'hi' },
    { k: '出勤', w: 6, g: 'da' }, { k: '退勤', w: 6, g: 'da' },
    { k: '休憩', w: 5, g: 'hk' }, { k: '中抜け', w: 5, z: true, g: 'hk' },
    { k: '実労働', w: 7, g: 'jr' },
    /* ★所定超は0が並びやすい★ので0なら空欄（所定内と法定外残業は 0にも意味がある＝出す） */
    { k: '所定内', w: 6, g: 'uw' }, { k: '所定超', w: 6, z: true, g: 'uw' }, { k: '法定外残業', w: 7, g: 'uw' },
    { k: '深夜', w: 6, z: true, g: 'wm' }, { k: '休日', w: 6, z: true, g: 'wm' },
    { k: '遅刻', w: 5, z: true, g: 'st' }, { k: '早退', w: 5, z: true, g: 'st' },
    { k: '有給', w: 4, z: true, g: 'st' }, { k: '欠勤', w: 4, z: true, g: 'st' },
    { k: '備考', w: 15, a: 'l', g: 'bk' },
  ];
  /* ★狭い画面で出す仲間★（日・打刻・実労働＝5列）。他は「紙のとおりに見る」で全部 見える */
  var PHONE_GROUPS = ['hi', 'da', 'jr'];
  /** ★中身の揃えを決めるのは この1本だけ★（中身も合計行も ここから取る＝食い違わない） */
  function alignOf(c) { return c.a === 'l' ? 'l' : c.a === 'c' ? 'c' : 'num'; }
  /** ★見出し（列の名前）は 中身に関係なく 中央★（2026-08-15 司さんの指摘で訂正）
      ＝★表の見出しは中央が普通★。★またがる見出しも中央★なので 2段とも揃う。
      ※数字の列は ★等幅のまま★（見出しの字も同じ書体で並ぶ） */
  function headAlignOf(c) { return alignOf(c) === 'num' ? 'c num' : 'c'; }
  /* 1段目の見出し（何の仲間か）。colspan の合計は 17 */
  var DAILY_GROUPS = [['日', 2, 'hi'], ['打刻', 2, 'da'], ['引いた分', 2, 'hk'], ['実労働', 1, 'jr'],
    ['内訳', 3, 'uw'], ['割増', 2, 'wm'], ['その他', 4, 'st'], ['備考', 1, 'bk']];
  /* 1列だけの仲間（1段目に縦2行で置くので、2段目には出さない） */
  var SOLO = DAILY_GROUPS.filter(function (g) { return g[1] === 1; }).map(function (g) { return g[0]; });

  /** ★日付は年を出さない★。月をまたぐ締めの時だけ 月を出す（またがない月に月は出さない） */
  function dayLabel(d, crossMonth) {
    return crossMonth ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : String(+d.slice(8, 10));
  }
  var blank = function (v) { return v === '0:00' || v === '' || v === 0 || v == null ? '' : v; };

  /** ★1日ぶんの「描く文字」を作るのは この1本だけ★
   *  表（17列）も 紙も ★カレンダー★も、★ここが返した同じ文字★を並べる。
   *  ＝別々に作ると ★表とカレンダーで数字が食い違う★（それを起こさない作りにする）。 */
  function dayValues(d, crossMonth) {
    var CSV = global.TcCsv;
    return [
      dayLabel(d.d, crossMonth), U.DOW[d.dow],
      d.inAt ? d.inAt.slice(11) : '', d.outAt ? d.outAt.slice(11) : '',
      CSV.hhmm(d.breakMin), CSV.hhmm(d.awayMin), CSV.hhmm(d.workMin),
      CSV.hhmm(d.stdMin), CSV.hhmm(d.overStdMin), CSV.hhmm(d.otMin),
      CSV.hhmm(d.nightMin), CSV.hhmm(d.holidayMin),
      d.lateMin == null ? '' : CSV.hhmm(d.lateMin),
      d.earlyMin == null ? '' : CSV.hhmm(d.earlyMin),
      d.dayKind === 'paid_leave' ? '1' : '', d.dayKind === 'absent' ? '1' : '',
      CSV.note(d),
    ];
  }

  /** ★日ごとの表の中身を作るのは1本だけ★（画面も紙も同じ物を見る）
      ★見出しは <thead> に入れる★＝紙が2枚になった時に ★2枚目にも見出しが出る★ */
  function dailyInner(s) {
    var CSV = global.TcCsv;
    var crossMonth = s.period.from.slice(0, 7) !== s.period.to.slice(0, 7);
    var sum = { 休憩: 0, 中抜け: 0, 実労働: 0, 所定内: 0, 所定超: 0, 法定外残業: 0, 深夜: 0, 休日: 0,
      遅刻: 0, 早退: 0 };

    var body = (s.days || []).map(function (d) {
      sum['休憩'] += d.breakMin; sum['中抜け'] += d.awayMin; sum['実労働'] += d.workMin;
      sum['所定内'] += d.stdMin; sum['所定超'] += d.overStdMin; sum['法定外残業'] += d.otMin;
      sum['深夜'] += d.nightMin; sum['休日'] += d.holidayMin;
      sum['遅刻'] += (d.lateMin || 0); sum['早退'] += (d.earlyMin || 0);
      var v = dayValues(d, crossMonth);
      /* ★打刻が1つも無い日は 数字を全部 空欄にする★（2026-08-15 指示役の指摘）
         ＝有給・欠勤の日に 0:00 が4つ並んで読みにくかった。印（有給1／欠勤1）だけ残す。
         ★打刻が在って結果が0の日は 0:00 のまま★（＝★数えた結果の0★。
         空欄にすると「まだ数えていない」に見える）。 */
      var noPunch = !d.inAt && !d.outAt;
      /* ★土日と法定休日は薄い網★（紙で見分けが付く。画面のCSSには足さない） */
      var cls = d.isLegalHoliday || d.dow === 0 || d.dow === 6 ? ' class="rest"' : '';
      return '<tr' + cls + '>' + DAILY_COLS.map(function (c, i) {
        var t = v[i];
        if (noPunch && c.k !== '日付' && c.k !== '曜日' && c.k !== '有給' && c.k !== '欠勤' && c.k !== '備考') t = '';
        return '<td class="' + alignOf(c) + ' g-' + c.g + '">' + U.esc(c.z ? blank(t) : t) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    return '<colgroup>' + DAILY_COLS.map(function (c) {
      return '<col class="g-' + c.g + '" style="width:' + c.w + '%">';
    }).join('') + '</colgroup>'
      + '<thead>'
      /* ★1列だけの仲間は 上下に同じ字を2回 出さない★（縦につなげる） */
      /* ★1列だけの仲間は その列と同じ揃え★（縦につなぐので 見出しと中身が同じ列になる）
         ★何列かにまたがる見出しは 中央★＝「どれか1列の中身」ではないので この決まりの外
         （検査も またぐ見出しは数えない） */
      + '<tr>' + DAILY_GROUPS.map(function (g) {
        if (g[1] !== 1) return '<th colspan="' + g[1] + '" class="grp g-' + g[2] + '">' + U.esc(g[0]) + '</th>';
        var col = DAILY_COLS.filter(function (c) { return c.k === g[0]; })[0] || {};
        return '<th rowspan="2" class="' + headAlignOf(col) + ' g-' + g[2] + '">' + U.esc(g[0]) + '</th>';
      }).join('') + '</tr>'
      /* ★見出しは中央★（表の見出しは中央が普通・2026-08-15 訂正） */
      + '<tr>' + DAILY_COLS.filter(function (c) { return SOLO.indexOf(c.k) < 0; }).map(function (c) {
        return '<th class="' + headAlignOf(c) + ' g-' + c.g + '">' + U.esc(c.k) + '</th>';
      }).join('') + '</tr>'
      + '</thead><tbody>' + body + '</tbody>'
      /* ★合計行★（日ごとの表だけで 月計と突き合わせられる） */
      /* ★遅刻・早退も足す★（給与で控除に使う数字なのに、どこにも合計が無かった）
         ★有給・欠勤は「日数」＝件数で数える★（時間ではない） */
      /* ★合計行も 上の列と同じ揃え★（桁が縦にぴったり重なる） */
      + '<tfoot><tr><th class="l" colspan="4">合計</th>'
      + DAILY_COLS.slice(4).map(function (c) {
        var a = ' class="' + alignOf(c) + ' g-' + c.g + '"';
        if (c.k === '有給') return '<td' + a + '>' + U.esc(s.month.yukyu || '') + '</td>';
        if (c.k === '欠勤') return '<td' + a + '>' + U.esc(s.month.kekkin || '') + '</td>';
        if (sum[c.k] == null) return '<td' + a + '></td>';
        return '<td' + a + '>' + U.esc(c.z && !sum[c.k] ? '' : CSV.hhmm(sum[c.k])) + '</td>';
      }).join('') + '</tr></tfoot>';
  }

  /** ★カレンダー（締め期間）★ 2026-08-17 司さんの決定
   *  ・★暦月ではなく 締め期間★（締め日の翌日 〜 締め日）。★締め日が いつも最後のマス★
   *  ・★曜日は日〜土の7列で固定★／★期間の外のマスは 空・薄く・押せない★
   *  ・★1つのマスに出すのは「1つの値」＋「地の網」＋「締めの線」まで★（重ねない）
   *  ・★印は3つ＋締め日★
   *      ？＝打刻が片方だけ（直さないと数字が出ない）／有・欠＝有給・欠勤／
   *      網＝休み（★濃い網＝法定休日／薄い網＝土日★＝35%が付く日を見分ける）／締＝締め日
   *  ・★数字は 表と同じ dayValues() から取る★（作り直さない）
   */
  function calInner(s) {
    var days = s.days || [];
    if (!days.length) return '';
    var crossMonth = s.period.from.slice(0, 7) !== s.period.to.slice(0, 7);
    var head = U.DOW.map(function (w, i) {
      return '<div class="cal-h' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + w + '</div>';
    }).join('');
    /* ★先頭の空きマス★（1日目の曜日ぶん・押せない） */
    var cells = [];
    for (var i = 0; i < days[0].dow; i++) cells.push('<div class="cal-c out"></div>');
    days.forEach(function (d, idx) {
      var v = dayValues(d, crossMonth);
      /* ★打刻が片方だけ★／★同じ時刻に出勤と退勤が並んで決められない★ … どちらも「？」
         ★決められない日を「−（打刻なし）」に見せない★（打刻は在る。決まっていないだけ） */
      var half = (!!d.inAt) !== (!!d.outAt) || d.undecided;
      var main = half ? '？'
        : d.dayKind === 'paid_leave' ? '有'
          : d.dayKind === 'absent' ? '欠'
            : (d.inAt || d.outAt) ? v[6]            /* 実労働（表と同じ文字） */
              : '−';
      /* ★月は「またぐ時」だけ、しかも 期間の頭と 月が変わる日だけ★（7/21・8/1）
         ＝7列のマスに毎日 月を書くと 数字が読めない。紙は今までどおり全部に月を出す。 */
      var newMonth = idx > 0 && d.d.slice(5, 7) !== days[idx - 1].d.slice(5, 7);
      var label = (crossMonth && (idx === 0 || newMonth))
        ? (+d.d.slice(5, 7)) + '/' + (+d.d.slice(8, 10)) : String(+d.d.slice(8, 10));
      var cls = 'cal-c';
      if (d.isLegalHoliday) cls += ' rest-h';        /* ★濃い網＝法定休日★ */
      else if (d.dow === 0 || d.dow === 6) cls += ' rest-w'; /* ★薄い網＝土日★ */
      if (half) cls += ' fix';
      if (newMonth) cls += ' newmonth';
      if (idx === days.length - 1) cls += ' shime';
      return cells.push('<button type="button" class="' + cls + '" data-day="' + idx + '"'
        + ' aria-selected="false">'
        + '<span class="d">' + U.esc(label) + '</span>'
        + '<span class="h' + (main === '−' ? ' none' : '') + '">' + U.esc(main) + '</span>'
        + (idx === days.length - 1 ? '<span class="sh">締</span>' : '')
        + '</button>');
    });
    return '<div class="cal-g head">' + head + '</div><div class="cal-g">' + cells.join('') + '</div>';
  }

  /** ★その日の結論を1行★（2026-08-18 指示役）
   *  ★「08/17 は 08:00〜17:03（実労働 8:03）として数えます」★ を必ず出す。
   *  ★決められない日は「決められません」と 理由まで出す★
   *    ＝勝手に0にしない・黙って空にしない（★空になって合計が黙って小さくなる★を作らない）。
   *  ★言葉は lib/tc-clean.js が持つ★（従業員の画面と同じ文＝食い違わない）。
   *  ★長さを足すのは 社長の画面だけ★（従業員には時刻しか出さない）。 */
  function dayLine(d) {
    var CL = global.TcClean, CSV = global.TcCsv;
    var info = {
      undecided: d.undecided, asks: d.asks || [],
      pairs: d.inAt ? [{ inAt: d.inAt, outAt: d.outAt }] : [],
    };
    var s = CL.daySentence(info, d.d);
    if (!d.undecided && d.inAt && d.outAt) {
      /* ★前の空白ごと差し替える★（残すと「18:00 （実労働…」と 1つ空きが出る＝実配信で見た） */
      s = s.replace(' として記録します', '（実労働 ' + CSV.hhmm(d.workMin) + '）として数えます');
    }
    var more = (d.asks || []).filter(function (a) { return a.type !== 'both'; })
      .map(function (a) { return a.text; }).join(' / ');
    return '<div class="tc-note' + (d.undecided ? ' warn' : '') + '">' + U.esc(s)
      + (more ? '<br>' + U.esc(more) : '')
      + ((d.asks || []).length ? '<br>本人が自分の画面で答えると、その場で直ります。' : '')
      + (d.merged ? '<br>' + U.esc('同じ時刻を2回 押した打刻が ' + d.merged + '本あります（数えていません・記録は残っています）') : '')
      + '</div>';
  }

  /** ★押した日の中身★（★17項目を 仲間ごと・1カラム・ラベル左/値右★）
   *  ★どの列も見られる／その日に無い物は出さない★（値が1つも無い仲間は 見出しごと出さない）
   *  ★実労働だけは いつも出す★（0でも その日の答え） */
  function drawDayBox(idx) {
    var box = q('cal-day');
    var s = st.sum;
    if (!box || !s || !s.days || !s.days[idx]) return;
    var d = s.days[idx];
    var crossMonth = s.period.from.slice(0, 7) !== s.period.to.slice(0, 7);
    var v = dayValues(d, crossMonth);
    /* ★表・紙と同じ見せ方にする★（2026-08-17）
       ＝打刻が1つも無い日は 表では数字を空欄にしている。ここだけ 0:00 を出すと
       ★同じ日の同じ項目が 画面によって違う★事になる。★実労働は「−」★（マスと同じ字）。 */
    var noPunch = !d.inAt && !d.outAt;
    if (noPunch) {
      DAILY_COLS.forEach(function (c, i) {
        if (c.k === '日付' || c.k === '曜日' || c.k === '有給' || c.k === '欠勤' || c.k === '備考') return;
        v[i] = c.k === '実労働' ? '−' : '';
      });
    }
    var at = 0, html = '';
    DAILY_GROUPS.forEach(function (g) {
      var cols = DAILY_COLS.slice(at, at + g[1]);
      at += g[1];
      if (g[2] === 'hi') return;                     /* 日付・曜日は 見出しに出す */
      /* ★出す／出さないの決まりは 表と同じ物を使う★（2026-08-17 見張りが食い違いを捕まえた）
         ＝表は「0にも意味がある列（所定内・法定外残業・実労働）」を 0:00 のまま出している。
         ここで独自に「0:00は消す」とすると ★同じ日の同じ項目が 画面によって違う★。
         ⇒ ★c.z（0なら空欄にしてよい列）★ だけを 0で落とす。 */
      var lines = cols.map(function (c) {
        return { k: c.k, z: c.z, v: v[DAILY_COLS.indexOf(c)] };
      }).filter(function (x) {
        if (x.k === '実労働') return true;           /* ★実労働は いつも出す★ */
        return (x.z ? blank(x.v) : x.v) !== '';
      });
      if (!lines.length) return;                     /* ★空の仲間は 見出しごと出さない★ */
      html += '<div class="day-g">' + U.esc(g[0]) + '</div>'
        + lines.map(function (x) {
          return '<div class="day-l"><span class="k">' + U.esc(x.k) + '</span>'
            + '<span class="v">' + U.esc(x.v) + '</span></div>';
        }).join('');
    });
    box.innerHTML = '<div class="day-h">' + U.esc(v[0]) + '（' + U.esc(v[1]) + '）'
      + (d.isLegalHoliday ? '　法定休日' : '') + '</div>' + dayLine(d) + html + yukyuInner(d);
    box.hidden = false;
    st.dayIdx = idx;
    var yb = box.querySelector('[data-yk]');
    if (yb) yb.onclick = function () { saveDayKind(d.d, yb.getAttribute('data-yk')); };
    Array.prototype.forEach.call(q('cal').querySelectorAll('[data-day]'), function (b) {
      b.setAttribute('aria-selected', String(Number(b.getAttribute('data-day')) === idx));
    });
  }

  /* ── ★有給を 付ける／外す★（2026-08-19 司さんの決まりの続き） ─────────────
     ★新しい画面を作らない★＝日を押した箱に 押す物を1つだけ足す。
     ★今の状態で押せる物しか出さない★（有給の日は「やめる」だけ・そうでない日は「にする」だけ）。
     ★締めた後は出さない★（理由は締めの1か所から聞く＝2画面で答えが割れない）。
     ★残りは その場で返す★（付与＋繰越−使った の3つを そのまま見せる）。 */
  function yukyuInner(d) {
    var y = st.yukyu || { ok: false, why: '' };
    var isY = d.dayKind === 'paid_leave';
    var c = st.close || closeState();
    /* ★他の仲間と同じ形（見出し＋行）で出す★＝説明文だけの箱を作らない */
    var line = y.ok
      ? y.leftDays + '日（付与 ' + y.grantDays + ' ＋ 繰越 ' + y.carryDays
        + ' − 使った ' + y.usedDays + '）'
      : 'まだ数えられません（' + y.why + '）';
    var btn = c.state === 'closed'
      ? '<div class="tc-note">' + U.esc(c.why.requestFix) + '</div>'
      : '<button class="tc-btn' + (isY ? ' danger' : '') + '" type="button" data-yk="'
        + (isY ? 'work' : 'paid_leave') + '">' + (isY ? '有給をやめる' : '有給にする') + '</button>';
    return '<div class="day-g">有給</div>'
      + (isY ? '<div class="day-l"><span class="k">この日</span><span class="v">有給です</span></div>' : '')
      + '<div class="day-l"><span class="k">残り</span><span class="v">' + U.esc(line) + '</span></div>'
      + btn;
  }

  function saveDayKind(day, kind) {
    var p = personOf(st.who);
    if (!p) { U.toast('先に人を選んでください'); return; }
    var c = st.close || closeState();
    if (c.state === 'closed') { U.toast(c.why.requestFix); return; }
    DB.saveDayKind(st.user.id, p.employee_id, day, kind, st.user.id)
      .then(function () {
        U.toast(kind === 'paid_leave' ? day + ' を有給にしました' : day + ' の有給をやめました');
        return drawShukei();
      })
      .catch(failed('できませんでした'));
  }

  function renderTables(p) {
    var s = st.sum;
    q('daily').innerHTML = dailyInner(s);
    /* ★狭い画面はカレンダー・広い画面は17列の表★（★同じ数字から作る★・CSSで出し分ける） */
    var cal = q('cal');
    if (cal) {
      cal.innerHTML = calInner(s);
      q('cal-day').hidden = true;
      Array.prototype.forEach.call(cal.querySelectorAll('[data-day]'), function (b) {
        b.onclick = function () { drawDayBox(Number(b.getAttribute('data-day'))); };
      });
    }

    /* ★割増の内訳を全部 出す★（社長が「なぜこれが残業でないのか」を説明できるように）
       ★総労働 ＝ 所定内 ＋ 所定超 ＋ 時間外 ＋ 休日★（深夜は上乗せなので足さない）
       率は ★LAW の数から作る★（説明文に直書きしない） */
    st.totalRows = totalRowsOf(p, s);
    q('total').innerHTML = st.totalRows.map(function (r) { return tr(r[0], r[1]); }).join('');
    drawUndecided(s);
    drawCutBox(s);
    U.nameHint(q('namehint'), fileName(p, 'csv'));
  }

  /** ★月計の中身は1か所で作る★（画面も紙も 同じ配列を見る＝食い違わない）
      率は ★LAW の数から作る★（説明文に直書きしない） */
  function totalRowsOf(p, s) {
    var LAW = global.TcLaw, pc = function (r) { return Math.round(r * 100) + '%'; };
    var m2 = s.month;
    /* ★ラベルの頭に空白を入れない★（2026-08-15 司さんの指摘）
       ＝紙では月計を3列に並べるので、★字下げした列だけ内側に寄って見える★。
       ★頭がそろうと目で追える★。上下の関係は「うち…」という言葉で分かる。 */
    return [
      ['出勤日数', String(m2.shukkin)],
      ['総労働', U.minToHm(m2.workedMin)],
      ['所定内', U.minToHm(m2.stdMin)],
      ['所定超（割増なし）', U.minToHm(m2.overStdMin)],
      ['時間外（' + pc(LAW.rateOf('ot')) + '）', U.minToHm(m2.otMin)],
      ['うち月60時間超（' + pc(LAW.rateOf('ot60')) + '）', U.minToHm(m2.ot60Min)],
      ['休日（' + pc(LAW.rateOf('holiday')) + '）', U.minToHm(m2.holidayMin)],
      ['深夜（' + pc(LAW.rateOf('night')) + '・上乗せ）', U.minToHm(m2.nightMin)],
      ['うち休日の深夜（' + pc(LAW.rateOf('holiday_night')) + '）', U.minToHm(m2.holidayNightMin)],
      /* ★遅刻・早退は 割増の箱と分けて置く★（率の話ではないので混ぜない）
         ★給与で控除に使う数字★なので、月の合計をここで出す（2026-08-15） */
      ['遅刻', U.minToHm(m2.lateMin)],
      ['早退', U.minToHm(m2.earlyMin)],
      ['有給消化', String(m2.yukyu)],
      ['有給残', String(yukyuLeft(p, s))],
      ['欠勤', String(m2.kekkin)],
    ];
  }

  /* ★決められない日は 給与へ渡す前に言う★（2026-08-18 指示役）
     ＝★合計が小さいのに 理由が分からない★を作らない。日にちまで出して カレンダーへ誘導する。
     ★中身が無い時は 箱ごと出さない★（空の赤い枠を見せない）。 */
  function drawUndecided(s) {
    var box = q('undecided');
    if (!box) return;
    var bad = (s.days || []).filter(function (d) { return d.undecided; });
    if (!bad.length) { box.hidden = true; box.textContent = ''; return; }
    box.hidden = false;
    box.textContent = '決められない日が ' + bad.length + '日あります（'
      + bad.map(function (d) { return (+d.d.slice(5, 7)) + '/' + (+d.d.slice(8, 10)); }).join('・')
      + '）。同じ時刻に出勤と退勤が並んでいます。本人が自分の記録の画面で答えると、'
      + 'その場で直ります。この日は まだ数えていません。';
  }

  /* ★切り捨てた時間と金額は必ず出す（黙って消さない）★ */
  function drawCutBox(s) {
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
  }

  /* ★「気づき」の箱は 2026-08-15 に丸ごと外した★（司さんの決定）
     ＝★誰も見ない物になっていた★。lib/tc-calc.js の countWarnings ごと消してある。
     ★残した物★: 紙の備考（その日に何が起きたか）／休憩の既定が法定を下回る赤（会社情報）／
                 丸めの適法性・法定休日の説明（会社情報）。 */
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

  /** ★1人ぶんの紙を組み立てる（1人＝A4横1枚）★
      ・★紙の頭は1行★（会社名・氏名・期間・状態・出した日を詰める）
        ＝見出し／小見出し／脚注の3か所に分けると それだけで約50px 使う
      ・★月計は横に4つ並べる★（3列だと5行ぶん＝四辺20mmの綴じ代を入れると1枚に収まらない）
      ・★どう絞り込んだかは刷らない★（対象の人と期間と状態だけ）
      ・★1人が2枚に割れない★ように、続けて刷る時は 人の頭で改ページする */
  function paperOf(p, s, dailyHtml, rows, pageBreak) {
    var c = st.close || closeState();
    var col = Math.ceil(rows.length / 4);
    var groups = [];
    for (var i = 0; i < rows.length; i += col) groups.push(rows.slice(i, i + col));
    return '<section' + (pageBreak ? ' style="break-before:page;page-break-before:always"' : '') + '>'
      + '<h1>' + U.esc((st.company || {}).name || '') + '　勤務表'
      + '<span class="sub">' + U.esc(p.name || p.employee_id) + '　'
      + U.esc(s.period.from) + ' 〜 ' + U.esc(s.period.to) + '　【' + U.esc(c.label) + '】'
      + (c.state === 'closed' ? '' : '　※この数字はまだ動きます')
      + '　出した日: ' + U.esc((DB.nowJst() || '').replace('T', ' ')) + '</span></h1>'
      + dailyHtml.replace('class="tc"', '')
      + '<div class="paper-sum">'
      + groups.filter(function (g) { return g.length; }).map(function (g) {
        return '<table>' + g.map(function (r) { return tr(r[0], r[1]); }).join('') + '</table>';
      }).join('')
      + '</div>'
      + '</section>';
  }

  /* 印刷 … ★紙だけの新しい窓で刷る／中身が0枚なら開かない★
     ★紙に「どう絞り込んだか」は刷らない★（対象の人と期間だけ書く） */
  function doPrint(preview) {
    var p = personOf(st.who);
    if (!p || !st.sum) { U.toast('先に対象を選んでください'); return; }
    var s = st.sum;
    /* ★紙にも状態を刷る★（確定前の紙が「確定」の顔で回ると、後で数字が動いた時に食い違う）
       ★これは「どう絞り込んだか」ではなく「この数字が動くかどうか」なので刷ってよい★ */
    var body = paperOf(p, s, q('daily').outerHTML, st.totalRows);
    /* ★見せる物と刷る物は 同じ body★（作り方を分けない＝ズレようがない） */
    U.printPaper(fileName(p, 'pdf').replace(/\.pdf$/, ''), body, { preview: preview === true });
  }

  /** ★全員ぶんを1回で刷る★（月末に10人ぶん10回 押さなくてよい）
      ★1人1枚で続けて出る／1人が2枚に割れない★（人の頭で改ページする） */
  function doPrintAll() {
    if (!st.people.length) { U.toast('従業員がいません'); return; }
    allMonth().then(function (rows) {
      var body = rows.map(function (x, i) {
        return paperOf(x.p, x.s, '<table>' + dailyInner(x.s) + '</table>', totalRowsOf(x.p, x.s), i > 0);
      }).join('');
      var name = global.TcName.build({
        kind: '勤務表', company: (st.company || {}).name, ym: st.ym, count: rows.length, stamp: stamp(),
      }, 'pdf').replace(/\.pdf$/, '');
      U.printPaper(name, body);
    }).catch(failed('作れませんでした'));
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
    _holNote: drawHolidayNote, _hirePreview: hirePreview,
  };
})(typeof window !== 'undefined' ? window : globalThis);
