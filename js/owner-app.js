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
    }).catch(function (e) { U.toast('つながりませんでした（' + e.message + '）'); });
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
      var hol = q('c-holiday'); if (hol) hol.onchange = drawHolidayNote;
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
    Promise.all([DB.getCompany(), DB.listPeople(), DB.listFixes()]).then(function (r) {
      st.company = r[0] || {};
      st.people = r[1] || [];
      fillCompany();
      drawPeople();
      return drawFixes(r[2] || []);
    }).then(drawSummary)
      .catch(function (e) { U.toast('読めませんでした（' + e.message + '）'); });
  }

  function coOpts() {
    var c = st.company || {};
    return {
      dailyStdMin: c.daily_std_min, weekLegalMin: c.week_legal_min, closeDay: c.close_day,
      rounding: c.rounding, roundUnitMin: c.round_unit_min, roundDir: c.round_dir, roundScope: c.round_scope,
      legalHolidayDow: c.legal_holiday_dow, weekStartDow: c.week_start_dow,
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
            .catch(function (e) { U.toast('できませんでした（' + e.message + '）'); });
        };
      });
      Array.prototype.forEach.call(box.querySelectorAll('[data-ng]'), function (b) {
        b.onclick = function () {
          DB.rejectFix(b.getAttribute('data-ng'), st.user.id)
            .then(function () { U.toast('戻しました'); reload(); })
            .catch(function (e) { U.toast('できませんでした（' + e.message + '）'); });
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
          company: Object.assign(coOpts(), { hourlyYen: p.hourly_yen }),
        });
        return { p: p, s: s };
      });
    })).then(function (rows) {
      box.innerHTML = '<div class="tc-tablewrap"><table class="tc"><tr>'
        + '<th class="l">氏名</th><th>出勤</th><th>実労働</th><th>法定外残業</th><th>深夜</th><th>休日</th><th>気づき</th></tr>'
        + rows.map(function (x) {
          return '<tr><td class="l">' + U.esc(x.p.name || x.p.employee_id) + '</td>'
            + '<td class="num">' + x.s.month.shukkin + '</td>'
            + '<td class="num">' + U.minToHm(x.s.month.workedMin) + '</td>'
            + '<td class="num">' + U.minToHm(x.s.month.otMin) + '</td>'
            + '<td class="num">' + U.minToHm(x.s.month.nightMin) + '</td>'
            + '<td class="num">' + U.minToHm(x.s.month.holidayMin) + '</td>'
            + '<td class="num' + (x.s.warnings.length ? ' warn' : '') + '">' + x.s.warnings.length + '</td></tr>';
        }).join('') + '</table></div>';
    }).catch(function (e) { U.toast('数えられませんでした（' + e.message + '）'); });
  }

  /* ── ② 従業員（入口の発行・QR） ─────────────────────────────── */
  function drawPeople() {
    var box = q('people');
    if (!box) return;
    if (!st.people.length) { box.innerHTML = '<div class="tc-note">まだ登録がありません。</div>'; return; }
    box.innerHTML = st.people.map(function (p) {
      var url = linkFor(p.token);
      return '<div class="tc-card"><div class="tc-cardhead"><b>' + U.esc(p.name || p.employee_id) + '</b>'
        + (p.pw_hash ? '<span class="tc-tag">設定済</span>' : '<span class="tc-tag pending">未設定</span>')
        + '<span class="tc-spacer"></span>'
        + '<button class="tc-btn sub" type="button" data-qr="' + U.esc(p.token) + '">QRを出す</button>'
        + '<button class="tc-btn sub" type="button" data-re="' + U.esc(p.token) + '">入口を作り直す</button>'
        + '</div>'
        + '<div style="word-break:break-all">' + U.esc(url) + '</div>'
        + (p.init_code ? '<div>最初のあいことば: <b class="num">' + U.esc(p.init_code) + '</b></div>' : '')
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
  function showQr(token) {
    var box = q('qr-' + token);
    if (!box) return;
    if (!global.qrcode) { U.toast('QRの部品を読み込めていません'); return; }
    var qr = global.qrcode(0, 'M');
    qr.addData(linkFor(token));
    qr.make();
    box.innerHTML = qr.createImgTag(4, 8);
  }
  function newCode() {
    var s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', out = '';   // 見間違えやすい文字は入れない
    var a = new Uint8Array(8);
    (global.crypto || {}).getRandomValues ? global.crypto.getRandomValues(a) : a.set([1, 2, 3, 4, 5, 6, 7, 8]);
    for (var i = 0; i < 8; i++) out += s[a[i] % s.length];
    return out;
  }
  function addPerson() {
    var name = q('p-name').value.trim();
    if (!name) { U.toast('氏名を入れてください（給与に渡すときに要ります）'); return; }
    var hire = (d.querySelector('#p-hire-wrap .tc-date-input') || {}).value || null;
    var yen = q('p-yen').value === '' ? null : Number(q('p-yen').value);
    DB.addPerson({
      account_id: st.user.id,
      employee_id: 'E' + Date.now().toString(36),
      name: name, emp_no: q('p-no').value.trim() || null,
      hire_date: hire, hourly_yen: yen, init_code: newCode(),
    }).then(function () { U.toast('入口を作りました'); q('p-name').value = ''; q('p-no').value = ''; q('p-yen').value = ''; reload(); })
      .catch(function (e) { U.toast('作れませんでした（' + e.message + '）'); });
  }
  function reissue(token) {
    DB.updatePerson(token, { init_code: newCode(), pw_hash: null, device_tokens: [], fail_count: 0, locked_until: null })
      .then(function () { U.toast('入口を作り直しました。新しいあいことばを渡してください。'); reload(); })
      .catch(function (e) { U.toast('できませんでした（' + e.message + '）'); });
  }

  /* ── ③ 会社情報 ───────────────────────────────────────────── */
  /* ★入れるのは「時間」・中で持つのは「分」★（司さん 2026-08-14）
     欄の下に「＝◯分」を出す＝★入れた瞬間に、中でどう持つかが見える★ */
  var HOUR_FIELDS = [
    { id: 'c-daily', col: 'daily_std_min', def: 480, maxMin: 24 * 60, label: '1日の所定' },
    { id: 'c-week', col: 'week_std_min', def: 2400, maxMin: 24 * 7 * 60, label: '1週の所定' },
    { id: 'c-break', col: 'break_default_min', def: 60, maxMin: 24 * 60, label: '休憩の既定' },
  ];
  var HOUR_EXAMPLE = '例: 8 ／ 7.5 ／ 8:30 ／ 45分';
  function drawHourHint(f) {
    var el = q(f.id + '-hint');
    if (!el) return;
    var Hs = global.TcHours;
    var r = Hs.read(q(f.id).value, { maxMin: f.maxMin });
    if (r.error === 'empty') { el.textContent = f.label + 'を入れてください（' + HOUR_EXAMPLE + '）'; return; }
    if (r.error === 'unreadable') { el.textContent = '読めません（' + HOUR_EXAMPLE + '）'; return; }
    if (r.error === 'too_big') {
      /* ★止めた本当の理由を言う★（「大きすぎます」だけだと 何が長いのか分からない） */
      el.textContent = Hs.toText(r.read) + '時間（' + r.read + '分）と読みました。'
        + f.label + 'は ' + Hs.toText(f.maxMin) + '時間までです。'
        + '分で入れたい時は「45分」のように単位を付けてください。';
      return;
    }
    el.textContent = '＝ ' + r.min + '分（中ではこの分数で数えます）';
  }

  function fillCompany() {
    var c = st.company || {};
    var set = function (id, v) { var el = q(id); if (el) el.value = v == null ? '' : v; };
    set('c-name', c.name); set('c-close', c.close_day == null ? 31 : c.close_day);
    HOUR_FIELDS.forEach(function (f) {
      set(f.id, global.TcHours.toText(c[f.col] == null ? f.def : c[f.col]));
      var el = q(f.id);
      if (el && !el._wired) { el._wired = true; el.oninput = function () { drawHourHint(f); }; }
      drawHourHint(f);
    });
    /* ★新しい会社の既定は「決めていない」★（勝手に日曜を法定休日にしない） */
    set('c-holiday', c.legal_holiday_dow == null ? -1 : c.legal_holiday_dow);
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
  function drawHolidayNote() {
    var n = q('holiday-note'), a = q('holiday-warn');
    var v = Number((q('c-holiday') || {}).value);
    if (n) {
      n.textContent = '法定休日は「週に1日」です。週休2日の会社でも、'
        + 'もう1日は所定休日（法定外）になります。'
        + '今は「毎週1日」の会社向けです（4週4日の決め方はまだ入れていません）。';
    }
    if (!a) return;
    if (v < 0) {
      a.hidden = false;
      a.textContent = '★法定休日を決めていないので、休日の割増は付けていません★　'
        + '就業規則で決めて、ここで選んでください。'
        + '（決めていない状態でこちらが勝手に曜日を決めると、会社が決めていない事を'
        + 'アプリが決めてしまうため、付けていません）';
    } else {
      a.hidden = true;
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
          ? '★これは法律の上ではできない扱いです★　1日ごとに、一定時間に満たない労働時間を'
            + '一律に切り捨てて その分の賃金を払わないのは 労働基準法違反になります'
            + '（労働時間は1分単位が原則）。選ぶことはできますが、'
            + '切り捨てた時間と金額を 集計の画面に必ず出します。'
          : '★認められている形とは違います★　1か月の合計に当てる形で認められているのは、'
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
      ex.textContent = (law.code === 'legal_month' ? '★これは認められている形です★（' : '')
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
      var r = global.TcHours.read(q(f.id).value, { maxMin: f.maxMin });
      if (r.error) bad.push(f.label);
      else vals[f.col] = r.min;
    });
    if (bad.length) { U.toast(bad.join('・') + ' を読めません（例: 8 / 7.5 / 8:30）'); return; }

    var mode = q('c-round').value;
    var r2 = pickedRound();
    DB.saveCompany(Object.assign({
      account_id: st.user.id,
      name: q('c-name').value.trim(),
      close_day: Number(q('c-close').value) || 31,
      /* ★-1（決めていない）を 0（日）に落とさない★（|| だと -1 も 0 も消える） */
      legal_holiday_dow: Number(q('c-holiday').value),
      rounding: mode,
      round_unit_min: r2.unitMin,
      round_dir: r2.dir,
      round_scope: r2.scope,
      warn_on: !!q('c-warn').checked,
      updated_at: new Date().toISOString(),
    }, vals)).then(function () { U.toast('保存しました'); reload(); })
      .catch(function (e) { U.toast('保存できませんでした（' + e.message + '）'); });
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
      Promise.all([DB.getCompany(), DB.listPeople()]).then(function (r) {
        st.company = r[0] || {};
        st.people = r[1] || [];
        q('who').innerHTML = st.people.map(function (p) {
          return '<option value="' + U.esc(p.employee_id) + '">' + U.esc(p.name || p.employee_id) + '</option>';
        }).join('');
        st.who = st.people.length ? st.people[0].employee_id : '';
        drawShukei();
      }).catch(function (e) { U.toast('読めませんでした（' + e.message + '）'); });
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
    Promise.all([
      DB.loadPunches(p.employee_id, per.from, per.to),
      DB.loadShifts(p.employee_id, per.from, per.to),
      DB.listFixes('approved'),
    ]).then(function (r) {
      st.sum = global.TcCalc.summarize({
        ym: st.ym, punches: r[0], shifts: r[1],
        fixes: (r[2] || []).filter(function (f) { return f.employee_id === p.employee_id; })
          .map(function (f) { return { d: f.d, beforeMin: f.before_min, afterMin: f.after_min, reason: f.reason, status: f.status }; }),
        company: Object.assign(coOpts(), { hourlyYen: p.hourly_yen, grantDays: grantDaysOf(p) }),
      });
      renderTables(p);
    }).catch(function (e) { U.toast('数えられませんでした（' + e.message + '）'); });
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

    q('total').innerHTML = ''
      + tr('出勤日数', s.month.shukkin) + tr('総労働', U.minToHm(s.month.workedMin))
      + tr('時間外合計', U.minToHm(s.month.otMin)) + tr('うち月60時間超', U.minToHm(s.month.ot60Min))
      + tr('深夜', U.minToHm(s.month.nightMin)) + tr('休日', U.minToHm(s.month.holidayMin))
      + tr('有給消化', s.month.yukyu) + tr('有給残', yukyuLeft(p, s)) + tr('欠勤', s.month.kekkin);

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
    var body = '<h1>' + U.esc((st.company || {}).name || '') + '　勤務表</h1>'
      + '<span class="sub">' + U.esc(p.name || p.employee_id) + '　'
      + U.esc(s.period.from) + ' 〜 ' + U.esc(s.period.to) + '</span>'
      + q('daily').outerHTML.replace('class="tc"', '')
      + '<h1 style="margin-top:8px">月計</h1>' + q('total').outerHTML.replace('class="tc"', '');
    U.printPaper(fileName(p, 'pdf').replace(/\.pdf$/, ''), body);
  }

  function doCsvDaily() {
    var p = personOf(st.who);
    if (!p || !st.sum) { U.toast('先に対象を選んでください'); return; }
    U.deliverText(global.TcCsv.dailyCsv(st.sum), fileName(p, 'csv'));
  }

  /** ★給与への受け口（全員・1人1行）★ 氏名が空の人がいたら先に知らせる */
  function doCsvMonthly() {
    var per = global.TcCalc.period(st.ym, (st.company && st.company.close_day) || 31);
    var noName = st.people.filter(function (p) { return !(p.name || '').trim(); });
    if (noName.length) { U.toast('氏名が未入力の人が ' + noName.length + '人います（受け取る側で消えます）'); }
    Promise.all(st.people.map(function (p) {
      return Promise.all([
        DB.loadPunches(p.employee_id, per.from, per.to),
        DB.loadShifts(p.employee_id, per.from, per.to),
      ]).then(function (r) {
        var s = global.TcCalc.summarize({
          ym: st.ym, punches: r[0], shifts: r[1], fixes: [],
          company: Object.assign(coOpts(), { hourlyYen: p.hourly_yen }),
        });
        return { no: p.emp_no || '', name: p.name, month: s.month };
      });
    })).then(function (rows) {
      var name = global.TcName.build({
        kind: '勤怠', company: (st.company || {}).name, ym: st.ym, count: rows.length, stamp: stamp(),
      }, 'csv');
      U.deliverText(global.TcCsv.monthlyCsv(rows), name);
    }).catch(function (e) { U.toast('作れませんでした（' + e.message + '）'); });
  }

  /** Excel … ★渡し口は file-out.js だけ★。部品は押した時にだけ読む（軽くしておく） */
  function doXlsx() {
    load('lib/xlsx.full.min.js').then(function () {
      var per = global.TcCalc.period(st.ym, (st.company && st.company.close_day) || 31);
      return Promise.all(st.people.map(function (p) {
        return Promise.all([
          DB.loadPunches(p.employee_id, per.from, per.to),
          DB.loadShifts(p.employee_id, per.from, per.to),
        ]).then(function (r) {
          var s = global.TcCalc.summarize({
            ym: st.ym, punches: r[0], shifts: r[1], fixes: [],
            company: Object.assign(coOpts(), { hourlyYen: p.hourly_yen }),
          });
          return { p: p, s: s };
        });
      }));
    }).then(function (rows) {
      var X = global.XLSX;
      var wb = X.utils.book_new();
      var head = global.TcCsv.MONTHLY_HEADERS;
      var aoa = [head].concat(rows.map(function (x) {
        var m = x.s.month;
        return [x.p.emp_no || '', x.p.name || '', m.shukkin, m.kekkin, m.yukyu,
          global.TcCsv.hhmm(m.workedMin), global.TcCsv.hhmm(m.otMin),
          global.TcCsv.hhmm(m.nightMin), global.TcCsv.hhmm(m.holidayMin)];
      }));
      var ws = X.utils.aoa_to_sheet(aoa);
      /* ★列幅を付けないと 相手の画面で ######## になる★（前科あり） */
      ws['!cols'] = [{ wch: 12 }, { wch: 18 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];
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
      return global.FileOut.deliver(out, name).then(function () { U.toast('「' + name + '」を保存しました'); });
    }).catch(function (e) { U.toast('作れませんでした（' + e.message + '）'); });
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
    _st: st, _newCode: newCode, _grantDaysOf: grantDaysOf, _fileName: fileName,
  };
})(typeof window !== 'undefined' ? window : globalThis);
