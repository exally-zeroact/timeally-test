/* tc-close.test.mjs — ★締め日が来た後（受付中／締め待ち／確定）★（Timeally）
 * =============================================================================
 * ★テストを先に書いた★（指示役 2026-08-15）。ここが合格の線。
 *
 * ★3つの状態を決めるのは1本だけ★（画面ごとに if を書かない）
 *   受付中   … 締め日より前。打刻できる・直せる
 *   締め待ち … 締め日は過ぎたが まだ確定していない。
 *              ★打刻はできない／直しの申請は出せる／社長に「確定する」が出る★
 *   確定     … 数字が動かない。CSV/Excel/紙は確定した数字。
 *              ★直しの申請が来たら 解除しないと直せない★
 * ★「押せるか」と「なぜ押せないか」を 同じ1か所から返す★
 *
 * ★解除は 黙ってさせない★
 *   社長だけ／★いつ・誰が・なぜ を残す（消さない・上書きしない＝追記だけ）★／
 *   ★「もう給与へ渡しています」と出す（止めはしない）★／
 *   ★解除したら もう一度 確定するまで CSV を出せない★
 *
 * 使い方: node tests/tc-close.test.mjs
 *         node tests/tc-close.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const CL = require_(path.join(ROOT, 'lib/tc-close.js'));
const C = require_(path.join(ROOT, 'lib/tc-calc.js'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

/* 追記だけの記録（新しい順でも古い順でも同じ答えになる事も見る） */
const L = (action, at, by, reason) => ({ action: action, at: at, by_uid: by || 'u1', reason: reason || '' });

console.log('\n[締め] 受付中／締め待ち／確定');

/* ── ① 3つの状態 ─────────────────────────────────────────────── */
T('★締め日より前は「受付中」＝打刻できる・直せる・まだ確定できない', () => {
  const s = CL.stateOf({ ym: '2026-08', closeDay: 31, today: '2026-08-15', log: [] });
  eq(s.state, 'open');
  eq(s.periodTo, '2026-08-31');
  eq(s.can.punch, true); eq(s.can.requestFix, true);
  eq(s.can.close, false); eq(s.can.reopen, false); eq(s.can.exportCsv, false);
  ok(/締め日/.test(s.why.close), 'なぜ確定できないかを言っていない: ' + s.why.close);
});

T('★締め日を過ぎたら「締め待ち」＝打刻はできない・直しの申請は出せる・確定できる', () => {
  const s = CL.stateOf({ ym: '2026-07', closeDay: 31, today: '2026-08-15', log: [] });
  eq(s.state, 'pending');
  eq(s.periodTo, '2026-07-31');
  eq(s.can.punch, false, '締め日を過ぎても打刻できてしまう');
  ok(/締め日/.test(s.why.punch), 'なぜ打てないかを言っていない: ' + s.why.punch);
  eq(s.can.requestFix, true, '締め待ちで直しの申請まで止めている');
  eq(s.can.close, true);
  eq(s.can.exportCsv, false, '確定していないのにCSVを出せる');
});

T('★確定したら「確定」＝数字が動かない・CSVを出せる・直せない', () => {
  const s = CL.stateOf({ ym: '2026-07', closeDay: 31, today: '2026-08-15',
    log: [L('close', '2026-08-01T10:00:00Z', 'u1')] });
  eq(s.state, 'closed');
  eq(s.can.punch, false); eq(s.can.requestFix, false);
  eq(s.can.close, false); eq(s.can.reopen, true); eq(s.can.exportCsv, true);
  ok(/解除/.test(s.why.requestFix), '「解除しないと直せない」と言っていない: ' + s.why.requestFix);
  eq(s.closedAt, '2026-08-01T10:00:00Z');
  eq(s.closedBy, 'u1');
});

T('★締め日の当日は まだ「受付中」（等号の境目）', () => {
  eq(CL.stateOf({ ym: '2026-08', closeDay: 20, today: '2026-08-20', log: [] }).state, 'open', '締め日当日');
  eq(CL.stateOf({ ym: '2026-08', closeDay: 20, today: '2026-08-21', log: [] }).state, 'pending', '締め日の翌日');
});

/* ── ② 解除（黙ってさせない） ────────────────────────────────── */
T('★解除したら「締め待ち」に戻る（確定し直すまで CSV は出せない）', () => {
  const s = CL.stateOf({ ym: '2026-07', closeDay: 31, today: '2026-08-15', log: [
    L('close', '2026-08-01T10:00:00Z', 'u1'),
    L('reopen', '2026-08-05T09:00:00Z', 'u1', '打刻漏れが出たため'),
  ] });
  eq(s.state, 'pending');
  eq(s.can.exportCsv, false, '★解除したのに古い数字を配れてしまう★');
  eq(s.can.requestFix, true, '解除したのに直せない');
  eq(s.reopenedAt, '2026-08-05T09:00:00Z');
  eq(s.reopenReason, '打刻漏れが出たため');
});

T('★★もう給与へ渡した月かどうかを覚えている（止めはしない・出すだけ）★★', () => {
  const s = CL.stateOf({ ym: '2026-07', closeDay: 31, today: '2026-08-15', log: [
    L('close', '2026-08-01T10:00:00Z', 'u1'),
    L('export', '2026-08-02T11:00:00Z', 'u1'),
  ] });
  eq(s.exportedAt, '2026-08-02T11:00:00Z');
  eq(s.can.reopen, true, '★渡した後でも解除は止めない★');
  ok(/給与/.test(s.why.reopen), '「もう給与へ渡しています」と出していない: ' + s.why.reopen);
});

T('★解除には理由が要る（空では受け付けない）', () => {
  eq(CL.canReopen({ reason: '' }).ok, false);
  eq(CL.canReopen({ reason: '　' }).ok, false, '空白だけも受け付けない');
  eq(CL.canReopen({ reason: '打刻漏れ' }).ok, true);
});

T('★記録は追記だけ（並び順が逆でも同じ答え・古い行を消さない）', () => {
  const rows = [L('close', '2026-08-01T10:00:00Z'), L('reopen', '2026-08-05T09:00:00Z', 'u1', 'x'),
    L('close', '2026-08-06T09:00:00Z')];
  const a = CL.stateOf({ ym: '2026-07', closeDay: 31, today: '2026-08-15', log: rows });
  const b = CL.stateOf({ ym: '2026-07', closeDay: 31, today: '2026-08-15', log: rows.slice().reverse() });
  eq(a.state, 'closed'); eq(b.state, 'closed', '並び順で答えが変わる');
  eq(a.closedAt, '2026-08-06T09:00:00Z', '一番新しい確定を見ていない');
  eq(CL.historyOf(rows).length, 3, '記録が消えている');
});

/* ── ③ 締め日の境界（実物で測る） ───────────────────────────── */
T('★★締め日20 → 7/21〜8/20★★', () => {
  const p = C.period('2026-08', 20);
  eq(p.from, '2026-07-21'); eq(p.to, '2026-08-20');
});

T('★★締め日31（末日）→ 2月は 2/1〜2/28、閏年は 2/29★★', () => {
  eq(JSON.stringify(C.period('2026-02', 31)), JSON.stringify({ ym: '2026-02', from: '2026-02-01', to: '2026-02-28' }));
  eq(JSON.stringify(C.period('2024-02', 31)), JSON.stringify({ ym: '2024-02', from: '2024-02-01', to: '2024-02-29' }), '閏年');
});

T('★★締め日30 → 2月は末日に寄せる★★', () => {
  const p = C.period('2026-02', 30);
  eq(p.to, '2026-02-28', '2月の締め日30は末日');
  eq(p.from, '2026-01-31', '前の月の31日から');
  eq(C.period('2024-02', 30).to, '2024-02-29', '閏年は29日');
});

T('★日をまたぐ勤務は「出勤日」の締めに入る（8/20 22:00〜8/21 6:00 は 8/20締め）', () => {
  const ps = [{ at: '2026-08-20T22:00', kind: 'in', src: 'punch' },
    { at: '2026-08-21T06:00', kind: 'out', src: 'punch' }];
  const aug = C.summarize({ ym: '2026-08', punches: ps, shifts: [], fixes: [], company: { closeDay: 20 } });
  const sep = C.summarize({ ym: '2026-09', punches: ps, shifts: [], fixes: [], company: { closeDay: 20 } });
  eq(aug.month.workedMin, 480, '★8/20締めに入っていない★');
  eq(sep.month.workedMin, 0, '★次の締めにも数えている（二重）★');
});

T('★境界の日に打刻が1件だけの月でも合う', () => {
  const ps = [{ at: '2026-08-20T09:00', kind: 'in', src: 'punch' },
    { at: '2026-08-20T17:00', kind: 'out', src: 'punch' }];
  const s = C.summarize({ ym: '2026-08', punches: ps, shifts: [], fixes: [], company: { closeDay: 20 } });
  eq(s.month.workedMin, 480);
  eq(s.month.shukkin, 1);
  eq(s.days.length, 31, '7/21〜8/20 は31日');
});

/* ── ④ 恒等式（1分でも違えば赤） ────────────────────────────── */
T('★★締めた月の合計 ＝ 日ごとの合計（1分でも違えば赤）★★', () => {
  const ps = [];
  for (let i = 0; i < 40; i++) {
    const d = C.addDays('2026-07-15', i);
    ps.push({ at: d + 'T08:30', kind: 'in', src: 'punch' },
      { at: d + 'T12:00', kind: 'break_in', src: 'punch' },
      { at: d + 'T13:00', kind: 'break_out', src: 'punch' },
      { at: d + 'T19:10', kind: 'out', src: 'punch' });
  }
  [20, 25, 31].forEach(function (cd) {
    const s = C.summarize({ ym: '2026-08', punches: ps, shifts: [], fixes: [],
      company: { closeDay: cd, holidayMode: 'dow', legalHolidayDow: 0 } });
    const sum = s.days.reduce(function (a, d) {
      return { w: a.w + d.workMin, o: a.o + d.otMin, n: a.n + d.nightMin, h: a.h + d.holidayMin };
    }, { w: 0, o: 0, n: 0, h: 0 });
    eq(s.month.workedMin, sum.w, '締め日' + cd + ': 実労働');
    eq(s.month.nightMin, sum.n, '締め日' + cd + ': 深夜');
    eq(s.month.holidayMin, sum.h, '締め日' + cd + ': 休日');
    /* 時間外は月の丸めが入り得るので、丸め無しの時だけ日ごとと一致する */
    eq(s.month.otMin, sum.o, '締め日' + cd + ': 時間外');
  });
});

/* ── ⑤ 従業員に見せる物（決まりを崩さない） ─────────────────── */
T('★従業員に返す文は「締め切りました」だけ（割増・丸めの話を混ぜない）', () => {
  const msg = CL.employeeNotice({ ym: '2026-07', state: 'closed' });
  ok(/締め切/.test(msg), '締め切ったと言っていない: ' + msg);
  ok(/会社/.test(msg), '直しの出し先を言っていない');
  ['割増', '丸め', '切り捨て', '残業', '深夜', '実労働', '金額'].forEach(function (w) {
    ok(msg.indexOf(w) < 0, '★' + w + ' が入っている★: ' + msg);
  });
  eq(CL.employeeNotice({ ym: '2026-08', state: 'open' }), '', '受付中は何も出さない');
});

T('★★従業員に見せる文が「倉庫(SQL)」と「画面(JS)」で同じ★★', () => {
  /* ★同じ文を2か所に書くと必ずズレる★ので、SQL の作り方をここで再現して1文字ずつ比べる。
     SQL: ltrim(right(v_ym,2),'0') || '月は締め切りました。直しは会社へ言ってください' */
  const m = /ltrim\(right\(v_ym, 2\), '0'\) \|\| '([^']+)'/.exec(SQL);
  ok(m, '★SQL 側の文が見つからない（tc_pub_info の notice）★');
  for (let i = 1; i <= 12; i++) {
    const ym = '2026-' + String(i).padStart(2, '0');
    eq(CL.employeeNotice({ ym: ym, state: 'closed' }), String(i) + m[1], ym + ' の文が食い違う');
  }
  eq(CL.employeeNotice({ ym: '2026-10', state: 'closed' }), '10' + m[1], '10月（0で終わる月）');
  ['割増', '丸め', '切り捨て', '残業', '深夜', '金額'].forEach(function (w) {
    ok(m[1].indexOf(w) < 0, '★倉庫が返す文に ' + w + ' が入っている★');
  });
});

T('★★締め切った後も「打った時刻」は本人に見えたまま★★', () => {
  /* tc_my_punches に締めの門を付けると ★記録が見えなくなる★＝元の決まりを壊す。
     門が付いていない事を数える（逆に 打刻と申請には 門が要る）。 */
  const body = SQL.split('create or replace function public.tc_my_punches')[1].split('end $$;')[0];
  ok(body.indexOf('tc_state') < 0, '★tc_my_punches に締めの門が付いている（記録が見えなくなる）★');
  ['tc_punch_add', 'tc_fix_request'].forEach(function (fn) {
    const b = SQL.split('create or replace function public.' + fn)[1].split('end $$;')[0];
    ok(b.indexOf('timeally.tc_state(') >= 0, '★' + fn + ' に締めの門が無い（URLを直に叩けば通る）★');
  });
});

/* ── self-test：わざと壊して赤になるか ───────────────────────── */
if (process.argv.includes('--self-test')) {
  console.log('\n[tc-close --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('①「締め日を過ぎたら即 確定」にした作り物は 締め待ちを飛ばす（本物は飛ばさない）', () => {
    const wrong = (past) => (past ? 'closed' : 'open');
    eq(wrong(true), 'closed', '作り物が壊れていない＝この検査が空振り');
    eq(CL.stateOf({ ym: '2026-07', closeDay: 31, today: '2026-08-15', log: [] }).state, 'pending',
      '★本物が締め待ちを飛ばしている★');
  });
  S('② 解除しても CSV を出せる作り物は 古い数字を配る（本物は止める）', () => {
    const s = CL.stateOf({ ym: '2026-07', closeDay: 31, today: '2026-08-15',
      log: [L('close', '2026-08-01T10:00:00Z'), L('reopen', '2026-08-05T09:00:00Z', 'u1', 'x')] });
    eq(s.can.exportCsv, false, '★本物が解除後にCSVを出せる★');
  });
  S('③ 締め日を「その月の1日から」にした作り物は 7/21〜8/20 を作れない（本物は作れる）', () => {
    const wrong = () => ({ from: '2026-08-01', to: '2026-08-20' });
    eq(wrong().from, '2026-08-01', '作り物が壊れていない＝この検査が空振り');
    eq(C.period('2026-08', 20).from, '2026-07-21', '★本物の締め期間が違う★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
