/* fake-supa.js — 実UIを押すための「倉庫の代わり」（Timeally）
 * =============================================================================
 * ★本物の倉庫は叩かない★（テストで実データを触らない・実配信を叩き続けない）。
 * ただし ★形は本物に合わせる★:
 *   ・from(表).select().eq()… は ★チェーンして then で {data,error} を返す★
 *   ・rpc(名前, 引数) も {data,error}
 *   ・range() を返すので ページめくりの道も通る
 * ★ここで返す中身は「本物の設計図に在る列」だけ★（無い列を返すと、
 *   窓に無い列を読んでも気づけない偽の緑になる）。
 */
'use strict';

function rowsFor(table, seed) {
  var s = seed || {};
  if (table === 'tc_companies') {
    return [{
      account_id: 'u1', name: 'テスト商事', close_day: 31, daily_std_min: 480,
      week_std_min: 2400, week_legal_min: 2400, break_default_min: 60,
      legal_holiday_dow: 0, week_start_dow: 0,
      rounding: s.rounding || 'none',
      round_unit_min: s.roundUnitMin || 1, round_dir: s.roundDir || 'floor', round_scope: s.roundScope || 'day',
      warn_on: !!s.warnOn, sme: true,
      created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    }];
  }
  if (table === 'tc_pub') {
    return [{
      token: '11111111-1111-1111-1111-111111111111', account_id: 'u1',
      employee_id: 'E1', name: '山田 太郎', emp_no: 'A01',
      hire_date: '2024-04-01', hourly_yen: 1200,
      init_code: 'ABCD2345', pw_hash: null, device_tokens: [],
      fail_count: 0, locked_until: null, active: true, created_at: '2026-08-01T00:00:00Z',
    }];
  }
  if (table === 'tc_punch') {
    return [
      { id: 'p1', account_id: 'u1', employee_id: 'E1', at: '2026-08-03T00:00:00Z', kind: 'in', src: 'punch', device: null, approved_at: '2026-08-03T00:00:00Z', voided_at: null, created_at: '2026-08-03T00:00:00Z' },
      { id: 'p2', account_id: 'u1', employee_id: 'E1', at: '2026-08-03T11:00:00Z', kind: 'out', src: 'punch', device: null, approved_at: '2026-08-03T11:00:00Z', voided_at: null, created_at: '2026-08-03T11:00:00Z' },
    ];
  }
  if (table === 'tc_fix') {
    return [{
      id: 'f1', account_id: 'u1', employee_id: 'E1', d: '2026-08-04',
      before_min: null, after_min: null, reason: '打ち忘れ', requested_by: 'employee',
      requested_at: '2026-08-05T00:00:00Z', approved_by: null, approved_at: null,
      status: 'pending', punch_ids: ['p3'],
    }];
  }
  if (table === 'tc_shift') return [];
  return [];
}

function makeQuery(table, calls, seed, saved) {
  var q = {};
  /* ★何を送ったかを取っておく★（押しただけで終わっていないか・中身が正しいかを見る） */
  var keep = function (kind, v) { [].concat(v).forEach(function (row) { saved.push({ table: table, kind: kind, row: row }); }); };
  var chain = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'not', 'in', 'order', 'limit'];
  chain.forEach(function (m) { q[m] = function () { calls.push(table + '.' + m); return q; }; });
  q.range = function () { calls.push(table + '.range'); return q; };
  q.insert = function (v) { calls.push(table + '.insert'); keep('insert', v); q._data = [].concat(v); return q; };
  q.update = function (v) { calls.push(table + '.update'); keep('update', v); q._data = [Object.assign({}, rowsFor(table, seed)[0], v)]; return q; };
  q.upsert = function (v) { calls.push(table + '.upsert'); keep('upsert', v); q._data = [].concat(v); return q; };
  q.then = function (res, rej) {
    /* ★seed.expired=true で「ログインが切れた」を作れる★（401 が返る）
       ＝ 中身の無い画面が出て理由が分からない、を捕まえるため */
    if (seed.expired) {
      return Promise.resolve({ data: null, error: { message: 'JWT expired', status: 401, code: 'PGRST301' } }).then(res, rej);
    }
    var data = q._data || rowsFor(table, seed);
    return Promise.resolve({ data: data, error: null }).then(res, rej);
  };
  q.catch = function (fn) { return q.then(null, fn); };
  return q;
}

function createFake(seed) {
  var calls = [], saved = [];
  seed = seed || {};
  return {
    _calls: calls,
    _saved: saved,
    from: function (t) { calls.push('from:' + t); return makeQuery(t, calls, seed, saved); },
    rpc: function (name, args) {
      calls.push('rpc:' + name);
      var out = { ok: true };
      if (name === 'tc_auth') out = { found: true, name: '山田 太郎', has_password: true, remembered: true, locked: false };
      if (name === 'tc_pub_info') out = { found: true, company: 'テスト商事', name: '山田 太郎' };
      if (name === 'tc_verify') out = { ok: true, device_token: 'dev1', name: '山田 太郎' };
      if (name === 'tc_set_password') out = { ok: true };
      if (name === 'tc_punch_add') out = { ok: true, id: 'p9', pending: args && args.p_src === 'calendar' };
      if (name === 'tc_my_punches') {
        out = {
          name: '山田 太郎',
          punches: [
            { id: 'p1', at: '2026-08-03T00:00:00Z', kind: 'in', src: 'punch', pending: false },
            { id: 'p2', at: '2026-08-03T11:00:00Z', kind: 'out', src: 'punch', pending: false },
            { id: 'p3', at: '2026-08-04T00:30:00Z', kind: 'in', src: 'calendar', pending: true },
          ],
        };
      }
      if (name === 'tc_fix_request') out = { ok: true, id: 'f9' };
      return Promise.resolve({ data: out, error: null });
    },
    auth: {
      /* seed.noUser=true で「まだログインしていない」を作れる（入口へ送るかの検査に使う） */
      getUser: function () {
        calls.push('auth.getUser');
        return Promise.resolve({ data: { user: seed.noUser ? null : { id: 'u1', email: 'a@example.com' } }, error: null });
      },
      signInWithPassword: function () { calls.push('auth.signIn'); return Promise.resolve({ data: {}, error: null }); },
      signUp: function () { calls.push('auth.signUp'); return Promise.resolve({ data: {}, error: null }); },
      signOut: function () { calls.push('auth.signOut'); return Promise.resolve({ error: null }); },
      resetPasswordForEmail: function () { calls.push('auth.reset'); return Promise.resolve({ data: {}, error: null }); },
      onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    },
  };
}

module.exports = { createFake: createFake, rowsFor: rowsFor };
