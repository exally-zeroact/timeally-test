/* tc-db.js — ★倉庫との行き来を1か所に集める★（Timeally）
 * =============================================================================
 * ここだけがやること:
 *   ・supabase の client を作る（向き先は js/supa-config.js だけが持つ）
 *   ・★社長のログインは自前★（exally-login.js は使わない・司さん指示）
 *   ・棚の読み書き（★必ず public の窓口(view)ごし★＝部屋を直接指さない）
 *   ・★1000件で黙って切れないように 全部めくって取る★
 *     （前科: 既定の上限で止まって「合計が黙って小さくなる」。#ERROR より先に潰す事故）
 *   ・★時刻の変換はここだけ★（倉庫は timestamptz、計算は JST の壁時計文字列）
 *     lib/tc-calc.js には Date.now() も new Date() も置かない＝毎回同じ答えになる
 *
 * 【利用】window.TcDb
 */
(function (global) {
  'use strict';

  var PAGE = 1000;   // supabase の1回の上限。これ以上は めくって取る
  var JST_OFFSET_MIN = 9 * 60;   // 日本標準時（夏時間が無いので固定でよい）

  var _client = null;
  function client() {
    if (_client) return _client;
    var cfg = global.SUPA;
    if (!cfg || !cfg.url || !cfg.key) throw new Error('接続設定(js/supa-config.js)がありません');
    if (!global.supabase || !global.supabase.createClient) throw new Error('supabase-js を読み込めていません');
    _client = global.supabase.createClient(cfg.url, cfg.key);
    return _client;
  }

  /* ── 時刻 ─────────────────────────────────────────────────────
     倉庫: timestamptz（UTCで持つ）／ 画面と計算: 'YYYY-MM-DDTHH:mm'（JSTの壁時計） */
  function toJst(iso) {
    if (!iso) return null;
    var t = new Date(iso).getTime();
    if (isNaN(t)) return null;
    return new Date(t + JST_OFFSET_MIN * 60000).toISOString().slice(0, 16);
  }
  function fromJst(wall) {
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(wall || ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - JST_OFFSET_MIN * 60000).toISOString();
  }
  /** 今（JSTの壁時計・分まで）。★画面が「今の時刻を入れておく」ためだけに使う★ */
  function nowJst() { return toJst(new Date().toISOString()); }

  /* ── 社長のログイン（自前） ───────────────────────────────── */
  var Auth = {
    signIn: function (email, password) {
      return client().auth.signInWithPassword({ email: email, password: password });
    },
    signUp: function (email, password) {
      return client().auth.signUp({ email: email, password: password });
    },
    signOut: function () { return client().auth.signOut(); },
    user: function () {
      return client().auth.getUser().then(function (r) { return r.data && r.data.user; });
    },
    onChange: function (fn) { return client().auth.onAuthStateChange(fn); },
  };

  /* ── 読み（★全部めくって取る★） ────────────────────────────── */
  function selectAll(table, build) {
    var rows = [], from = 0;
    function step() {
      var q = client().from(table).select('*');
      if (build) q = build(q);
      return q.range(from, from + PAGE - 1).then(function (r) {
        if (r.error) throw new Error(table + ': ' + r.error.message);
        var got = r.data || [];
        rows = rows.concat(got);
        if (got.length < PAGE) return rows;
        from += PAGE;
        return step();
      });
    }
    return step();
  }

  /* ── 会社情報 ──────────────────────────────────────────────── */
  function getCompany() {
    return selectAll('tc_companies').then(function (r) { return r[0] || null; });
  }
  function saveCompany(row) {
    return client().from('tc_companies').upsert(row, { onConflict: 'account_id' }).select()
      .then(function (r) { if (r.error) throw new Error(r.error.message); return (r.data || [])[0]; });
  }

  /* ── 従業員（入口） ───────────────────────────────────────── */
  function listPeople() {
    return selectAll('tc_pub', function (q) { return q.order('employee_id'); });
  }
  function addPerson(p) {
    return client().from('tc_pub').insert(p).select()
      .then(function (r) { if (r.error) throw new Error(r.error.message); return (r.data || [])[0]; });
  }
  function updatePerson(token, patch) {
    return client().from('tc_pub').update(patch).eq('token', token).select()
      .then(function (r) { if (r.error) throw new Error(r.error.message); return (r.data || [])[0]; });
  }

  /* ── 打刻（原本）──────────────────────────────────────────── */
  /** 期間の打刻を取り、★JSTの壁時計に直して★ lib/tc-calc.js に渡せる形で返す */
  function loadPunches(employeeId, fromDate, toDate, opts) {
    opts = opts || {};
    return selectAll('tc_punch', function (q) {
      q = q.eq('employee_id', employeeId).is('voided_at', null)
        .gte('at', fromJst(fromDate + 'T00:00'))
        .lt('at', fromJst(nextDay(toDate) + 'T00:00'))
        .order('at');
      /* ★未承認の後入れは 既定では数えない★（承認するまで確定にしない） */
      if (!opts.includePending) q = q.not('approved_at', 'is', null);
      return q;
    }).then(function (rows) {
      return rows.map(function (r) {
        return { id: r.id, at: toJst(r.at), kind: r.kind, src: r.src, pending: !r.approved_at };
      });
    });
  }
  function nextDay(ymd) {
    var d = new Date(ymd + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  function addPunch(row) {
    return client().from('tc_punch').insert(row).select()
      .then(function (r) { if (r.error) throw new Error(r.error.message); return (r.data || [])[0]; });
  }

  /* ── 直しの申請 ────────────────────────────────────────────── */
  function listFixes(status) {
    return selectAll('tc_fix', function (q) {
      if (status) q = q.eq('status', status);
      return q.order('requested_at', { ascending: false });
    });
  }
  /** 承認する。★社長1人の会社は「自己承認」と残す（承認が無かった事にしない）★ */
  function approveFix(id, byUid, selfApproval) {
    return client().from('tc_fix').update({
      status: 'approved',
      approved_by: selfApproval ? 'self' : byUid,
      approved_at: new Date().toISOString(),
    }).eq('id', id).select().then(function (r) {
      if (r.error) throw new Error(r.error.message);
      var row = (r.data || [])[0];
      if (!row || !row.punch_ids || !row.punch_ids.length) return row;
      /* 申請で入れた打刻を「確定」にする（原本の時刻は1分も動かさない） */
      return client().from('tc_punch').update({ approved_at: new Date().toISOString() })
        .in('id', row.punch_ids).then(function () { return row; });
    });
  }
  function rejectFix(id, byUid) {
    return client().from('tc_fix').update({
      status: 'rejected', approved_by: byUid, approved_at: new Date().toISOString(),
    }).eq('id', id).select().then(function (r) {
      if (r.error) throw new Error(r.error.message); return (r.data || [])[0];
    });
  }

  /* ── 予定（シフト） ───────────────────────────────────────── */
  function loadShifts(employeeId, fromDate, toDate) {
    return selectAll('tc_shift', function (q) {
      return q.eq('employee_id', employeeId).gte('d', fromDate).lte('d', toDate).order('d');
    }).then(function (rows) {
      return rows.map(function (r) {
        return {
          d: r.d, plannedMin: r.planned_min, dayKind: r.day_kind,
          plannedIn: r.planned_in ? String(r.planned_in).slice(0, 5) : null,
          plannedOut: r.planned_out ? String(r.planned_out).slice(0, 5) : null,
        };
      });
    });
  }
  function saveShift(row) {
    return client().from('tc_shift').upsert(row, { onConflict: 'account_id,employee_id,d' }).select()
      .then(function (r) { if (r.error) throw new Error(r.error.message); return (r.data || [])[0]; });
  }

  /* ── 従業員（anon）… ★RPC経由のみ★ ───────────────────────── */
  function rpc(name, args) {
    return client().rpc(name, args).then(function (r) {
      if (r.error) throw new Error(r.error.message);
      return r.data;
    });
  }
  var Emp = {
    auth: function (token, device) { return rpc('tc_auth', { p_token: token, p_device: device }); },
    info: function (token) { return rpc('tc_pub_info', { p_token: token }); },
    setPassword: function (token, init, pw) { return rpc('tc_set_password', { p_token: token, p_init: init, p_pw: pw }); },
    verify: function (token, pw) { return rpc('tc_verify', { p_token: token, p_pw: pw }); },
    punch: function (token, device, pw, wallTime, kind, src) {
      return rpc('tc_punch_add', {
        p_token: token, p_device: device, p_pw: pw,
        p_at: fromJst(wallTime), p_kind: kind, p_src: src || 'punch',
      });
    },
    mine: function (token, device, pw, from, to) {
      return rpc('tc_my_punches', { p_token: token, p_device: device, p_pw: pw, p_from: from, p_to: to })
        .then(function (r) {
          if (!r || r.unauth) return r;
          r.punches = (r.punches || []).map(function (p) {
            return { id: p.id, at: toJst(p.at), kind: p.kind, src: p.src, pending: p.pending };
          });
          return r;
        });
    },
    fixRequest: function (token, device, pw, d, beforeMin, afterMin, reason, punchIds) {
      return rpc('tc_fix_request', {
        p_token: token, p_device: device, p_pw: pw, p_d: d,
        p_before: beforeMin, p_after: afterMin, p_reason: reason, p_punch_ids: punchIds || [],
      });
    },
  };

  global.TcDb = {
    client: client, Auth: Auth, Emp: Emp, rpc: rpc,
    toJst: toJst, fromJst: fromJst, nowJst: nowJst, nextDay: nextDay,
    selectAll: selectAll, PAGE: PAGE,
    getCompany: getCompany, saveCompany: saveCompany,
    listPeople: listPeople, addPerson: addPerson, updatePerson: updatePerson,
    loadPunches: loadPunches, addPunch: addPunch,
    listFixes: listFixes, approveFix: approveFix, rejectFix: rejectFix,
    loadShifts: loadShifts, saveShift: saveShift,
  };
})(typeof window !== 'undefined' ? window : globalThis);
