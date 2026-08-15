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

function rowsFor(table, seed, store) {
  var s = seed || {};
  /* ★締めの記録は「入れた物が読める」ようにする★
     ここを空のまま返すと、確定を押しても状態が変わらず ★押せた気になる緑★ になる。 */
  /* ★seed.closedYm でその月を「確定」にできる★（頭の【 】の文字数が変わるので 紙の幅に効く） */
  if (table === 'tc_close') {
    var base = (store && store.tc_close) || [];
    if (s.closedYm && !base.some(function (r) { return r.action === 'close'; })) {
      return base.concat([{ id: 'seed1', account_id: 'u1', ym: s.closedYm, action: 'close',
        at: '2026-08-01T00:00:00Z', by_uid: 'u1', by_name: 'a@example.com', employee_id: null, reason: '' }]);
    }
    return base;
  }
  if (table === 'tc_companies') {
    return [{
      account_id: 'u1',
      /* ★長い会社名でも頭がはみ出さないか★を測れるようにする（15文字） */
      name: s.longName ? '株式会社ながいなまえ商事' : 'テスト商事',
      close_day: s.closeDay || 31, daily_std_min: 480,
      week_std_min: 2400, week_legal_min: 2400, break_default_min: 60,
      legal_holiday_dow: 0, week_start_dow: 0,
      /* ★mix の時は法定休日を「日曜」に決めた会社にする★
         （決めていない会社だと ★休日・休日の深夜が1つも出ず、試したことにならない★） */
      holiday_mode: s.mix ? 'dow' : 'none',
      rounding: s.rounding || 'none',
      round_unit_min: s.roundUnitMin || 1, round_dir: s.roundDir || 'floor', round_scope: s.roundScope || 'day',
      warn_on: !!s.warnOn, sme: true,
      created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    }];
  }
  if (table === 'tc_pub') {
    /* ★seed.people で人数を増やせる★（全員ぶんを刷った時の枚数を実物で数えるため） */
    if (s.people > 1) {
      var arr = [];
      for (var k = 0; k < s.people; k++) {
        arr.push({
          token: '1111111' + k + '-1111-1111-1111-111111111111', account_id: 'u1',
          employee_id: 'E' + (k + 1),
          name: s.longName ? '長谷川 佐和子' + (k + 1) : (['山田 太郎', '佐藤 花子', '鈴木 一郎'][k] || ('従業員' + k)),
          emp_no: 'A0' + (k + 1), hire_date: '2024-04-01', hourly_yen: 1200,
          init_code: null, pw_hash: null, device_tokens: [],
          fail_count: 0, locked_until: null, active: true, created_at: '2026-08-01T00:00:00Z',
        });
      }
      return arr;
    }
    return [{
      token: '11111111-1111-1111-1111-111111111111', account_id: 'u1',
      employee_id: 'E1', emp_no: 'A01',
      hire_date: '2024-04-01', hourly_yen: 1200,
      /* ★長い氏名でも頭がはみ出さないか★を測れるようにする */
      name: s.longName ? '長谷川 佐和子' : '山田 太郎',
      /* ★seed.pwSet=true … 暗証番号は決めてあるが 帳面には記録が無い人★
         ＝この仕組みを入れる前に決めた人。実際に居る（作らないと検査が素通りする）。 */
      init_code: null, pw_hash: s.pwSet ? '$2a$10$dummydummydummydummydu' : null, device_tokens: [],
      fail_count: 0, locked_until: null, active: true, created_at: '2026-08-01T00:00:00Z',
    }];
  }
  if (table === 'tc_punch') {
    /* ★seed.days を渡すと 1か月ぶんの打刻を作る★（紙が1枚に収まるかを実物で数えるため）
       ★repeat で わざと増やせる★＝2枚になった時の見出しを確かめる用。 */
    if (s.days) {
      var out = [], ym = s.ym || '2026-08';
      var y = Number(ym.slice(0, 4)), mo = Number(ym.slice(5, 7));
      var who = [];
      for (var pi = 0; pi < (s.people || 1); pi++) who.push('E' + (pi + 1));
      /* ★JSTの壁時計で書いて、倉庫に入る形（UTC）へ直す★
         （倉庫は timestamptz。ここでUTCを直に書くと ★9時間ずれた物を試してしまう★） */
      var put = function (id, emp, ymd, hm, kind, nextDay) {
        var t = Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10) + (nextDay ? 1 : 0),
          +hm.slice(0, 2), +hm.slice(3, 5)) - 9 * 3600000;
        var at = new Date(t).toISOString();
        out.push({ id: id, account_id: 'u1', employee_id: emp, at: at, kind: kind, src: 'punch',
          device: null, approved_at: at, voided_at: null, created_at: at });
      };
      who.forEach(function (emp) {
        for (var i = 0; i < s.days; i++) {
          var ymd = new Date(Date.UTC(y, mo - 1, 1 + i)).toISOString().slice(0, 10);
          var dow = new Date(ymd + 'T00:00:00Z').getUTCDay();
          var id = emp + '_' + i;
          /* ★色んな形の日を混ぜる★（一番 幅を食う所を測るため）
             ★9:00〜18:00 が31日 続くのは 一番 幅を食わないデータ★ なので使わない。 */
          if (s.mix && i % 7 === 3) {                       // ★日をまたぐ夜勤★（深夜・休日深夜が出る）
            put(id + 'a', emp, ymd, '22:00', 'in'); put(id + 'b', emp, ymd, '06:00', 'out', true);
          } else if (s.mix && dow === 0) {                  // ★法定休日に出た日★
            put(id + 'a', emp, ymd, '21:30', 'in'); put(id + 'b', emp, ymd, '05:30', 'out', true);
          } else if (s.mix && i % 11 === 5) {               // ★中抜けが在る日★
            put(id + 'a', emp, ymd, '08:45', 'in');
            put(id + 'b', emp, ymd, '14:00', 'away_in'); put(id + 'c', emp, ymd, '15:30', 'away_out');
            put(id + 'd', emp, ymd, '21:10', 'out');
          } else if (s.mix && i % 13 === 7) {               // ★打刻が片方だけ（備考が長く出る）★
            put(id + 'a', emp, ymd, '09:05', 'in');
          } else if (s.mix) {                               // ふつうの日（★合計が3桁時間になる長さ★）
            put(id + 'a', emp, ymd, '08:30', 'in'); put(id + 'b', emp, ymd, '21:10', 'out');
          } else {                                          // ★一番 幅を食わないデータ★（比べる用）
            put(id + 'a', emp, ymd, '09:00', 'in'); put(id + 'b', emp, ymd, '18:00', 'out');
          }
        }
      });
      return out;
    }
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
  if (table === 'tc_shift') {
    /* ★有給・欠勤・社長が直した休憩★を混ぜる（無いと その列を試したことにならない） */
    if (!s.mix) return [];
    var ym2 = s.ym || '2026-08';
    var mk = function (n) { return ym2 + '-' + ('0' + n).slice(-2); };
    return [
      { id: 's1', account_id: 'u1', employee_id: 'E1', d: mk(2), planned_min: null, planned_in: null, planned_out: null, day_kind: 'paid_leave', note: '', break_min: null, break_by: null, break_at: null },
      { id: 's2', account_id: 'u1', employee_id: 'E1', d: mk(10), planned_min: null, planned_in: null, planned_out: null, day_kind: 'absent', note: '', break_min: null, break_by: null, break_at: null },
      /* ★社長が休憩を直した日★（出どころが「直した値」になる） */
      { id: 's3', account_id: 'u1', employee_id: 'E1', d: mk(6), planned_min: null, planned_in: null, planned_out: null, day_kind: 'work', note: '', break_min: 0, break_by: 'u1', break_at: '2026-08-15T01:00:00Z' },
      /* ★遅刻・早退が出る日★（予定より遅く来て 早く帰った） */
      { id: 's4', account_id: 'u1', employee_id: 'E1', d: mk(14), planned_min: 480, planned_in: '08:00', planned_out: '22:00', day_kind: 'work', note: '', break_min: null, break_by: null, break_at: null },
      /* ★月の後半にも置く★＝締め日20（21日〜翌20日）の紙にも 有給・欠勤が載るように
         （前半だけに置くと ★その締めでは1つも出ず、試したことにならない★） */
      { id: 's5', account_id: 'u1', employee_id: 'E1', d: mk(23), planned_min: null, planned_in: null, planned_out: null, day_kind: 'paid_leave', note: '', break_min: null, break_by: null, break_at: null },
      { id: 's6', account_id: 'u1', employee_id: 'E1', d: mk(27), planned_min: null, planned_in: null, planned_out: null, day_kind: 'absent', note: '', break_min: null, break_by: null, break_at: null },
    ];
  }
  return [];
}

function makeQuery(table, calls, seed, saved, store) {
  var q = {};
  /* ★何を送ったかを取っておく★（押しただけで終わっていないか・中身が正しいかを見る） */
  var keep = function (kind, v) { [].concat(v).forEach(function (row) { saved.push({ table: table, kind: kind, row: row }); }); };
  var chain = ['select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'not', 'in', 'order', 'limit'];
  chain.forEach(function (m) { q[m] = function () { calls.push(table + '.' + m); return q; }; });
  q.range = function () { calls.push(table + '.range'); return q; };
  q.insert = function (v) {
    calls.push(table + '.insert'); keep('insert', v);
    q._data = [].concat(v);
    /* ★追記だけの帳面は 本当に積む★（次に読んだ時に出てこないと 状態が変わらない） */
    if (table === 'tc_close' && store) {
      [].concat(v).forEach(function (row, i) {
        store.tc_close.push(Object.assign({ id: 'c' + (store.tc_close.length + i + 1), at: store.clock() }, row));
      });
    }
    return q;
  };
  q.update = function (v) { calls.push(table + '.update'); keep('update', v); q._data = [Object.assign({}, rowsFor(table, seed, store)[0], v)]; return q; };
  q.upsert = function (v) { calls.push(table + '.upsert'); keep('upsert', v); q._data = [].concat(v); return q; };
  q.then = function (res, rej) {
    /* ★seed.expired=true で「ログインが切れた」を作れる★（401 が返る）
       ＝ 中身の無い画面が出て理由が分からない、を捕まえるため */
    if (seed.expired) {
      return Promise.resolve({ data: null, error: { message: 'JWT expired', status: 401, code: 'PGRST301' } }).then(res, rej);
    }
    var data = q._data || rowsFor(table, seed, store);
    return Promise.resolve({ data: data, error: null }).then(res, rej);
  };
  q.catch = function (fn) { return q.then(null, fn); };
  return q;
}

function createFake(seed) {
  var calls = [], saved = [];
  seed = seed || {};
  /* ★足した順に時刻が進む時計★（同じ時刻だと「確定と解除のどちらが新しいか」が決まらない） */
  var tick = 0;
  var store = {
    tc_close: (seed.closeLog || []).slice(),
    clock: function () { tick++; return '2026-08-15T' + ('0' + (9 + tick)).slice(-2) + ':00:00Z'; },
  };
  return {
    _calls: calls,
    _saved: saved,
    _store: store,
    from: function (t) { calls.push('from:' + t); return makeQuery(t, calls, seed, saved, store); },
    rpc: function (name, args) {
      calls.push('rpc:' + name);
      var out = { ok: true };
      /* seed.noPassword=true … まだ暗証番号を決めていない人
         ★seed.forgotten=true … 暗証番号は決めてあるが 端末を忘れた人★
           ＝この形でしか出ない不具合がある（2026-08-15 実機で 空の箱が出たのが これ）。
             作らないと ★見張りが空振りする★ ので、必ず1枚 開く。 */
      if (name === 'tc_auth') {
        out = {
          found: true, name: '山田 太郎', locked: false,
          has_password: !seed.noPassword,
          remembered: !seed.noPassword && !seed.forgotten,
        };
      }
      /* ★notice は倉庫が作る文★（画面が組み立てない）。seed.empClosed=true で締め切った後を作る */
      if (name === 'tc_pub_info') {
        out = { found: true, company: 'テスト商事', name: '山田 太郎', state: 'open', ym: '2026-08', notice: '' };
        if (seed.empClosed) { out.state = 'closed'; out.notice = '7月は締め切りました。直しは会社へ言ってください'; out.ym = '2026-07'; }
      }
      if (name === 'tc_verify') out = { ok: true, device_token: 'dev1', name: '山田 太郎' };
      /* ★倉庫でも桁を見る★ので、代わりの物も同じ線で断る（画面だけ通る偽の緑を作らない） */
      if (name === 'tc_pin_set') {
        out = /^[0-9]{4,6}$/.test(String((args && args.p_pin) || ''))
          ? { ok: true, device_token: 'dev1', name: '山田 太郎' }
          : { ok: false, bad_pin: true };
      }
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
