/* seed-test.mjs — ★テスト倉庫に「見せるための実データ」を入れる★（Timeally）
 * =============================================================================
 * ★env:'test' 以外では 1行も書かない★（本番の倉庫には当たらない）。
 * ★何回流しても同じ形になる★（同じ人・同じ日は 入れ直す）。
 *
 * 入れる物（指示役 2026-08-15 の注文どおり）:
 *   会社A 山田工業   締め日31（末日）… 2026-07 は ★確定できる状態★（締め待ち）
 *     E1 田中 花子 … ★月60時間を超える残業★（60超の行に数字が入る）
 *     E2 佐藤 健   … ★法定休日(日)の深夜★（休日の深夜の行に数字が入る）
 *   会社B 南海フーズ 締め日10        … 2026-08 は 7/11〜8/10 で ★締め待ち★
 *     E1 鈴木 みどり／E2 高橋 大輔
 *
 * 使い方: node scripts/seed-test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const strip = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');

function readConfig() {
  const src = strip(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
  const url = /url:\s*'([^']+)'/.exec(src)[1];
  const env = /env:\s*'([^']+)'/.exec(src);
  return { ref: /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)[1], env: env ? env[1] : '' };
}
function readToken() {
  for (const n of ['timeally-db-token.json', 'nomiya-db-url.json', 'nomiya-db-url-prod.json']) {
    const p = path.join(os.tmpdir(), n);
    if (!fs.existsSync(p)) continue;
    try { const t = JSON.parse(fs.readFileSync(p, 'utf8')).token; if (t) return t; } catch (_) { /* 次へ */ }
  }
  throw new Error('鍵が見つかりません');
}
const cfg = readConfig();
if (cfg.env !== 'test') { console.log('★中止★ env が test ではありません（' + cfg.env + '）'); process.exit(1); }
const token = readToken();
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${cfg.ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${t.slice(0, 600)}`);
  return JSON.parse(t);
}
const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";

/* ── 日付の道具（JSTの壁時計で組み立てて、最後に JST として倉庫へ渡す） ── */
function days(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
const dow = (ymd) => new Date(ymd + 'T00:00:00Z').getUTCDay();

/* ── 誰が いつ 何を打ったか ─────────────────────────────────── */
function shift(d, inHm, outHm, withBreak) {
  const rows = [[d + ' ' + inHm, 'in']];
  if (withBreak) rows.push([d + ' 12:00', 'break_in'], [d + ' 13:00', 'break_out']);
  /* 日をまたぐ退勤は 次の日の時刻で置く（★出勤日の締めに入る★のは計算側が決める） */
  const over = outHm < inHm;
  const outD = over ? new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10) : d;
  rows.push([outD + ' ' + outHm, 'out']);
  return rows;
}

function planA1() {                       /* 田中 花子 … ★月60時間超の残業★ */
  const out = [];
  days('2026-07-01', '2026-07-31').forEach((d) => {
    if (dow(d) === 0) return;             // 日曜は休み
    out.push(...shift(d, '08:30', '21:00', true));   // 実働 11.5h → 1日 3.5h の残業
  });
  return out;
}
function planA2() {                       /* 佐藤 健 … ★法定休日(日)の深夜★ */
  const out = [];
  days('2026-07-01', '2026-07-31').forEach((d) => {
    if (dow(d) === 0) { out.push(...shift(d, '22:00', '05:00', false)); return; }  // 日曜の夜勤
    if (dow(d) === 6) return;
    out.push(...shift(d, '09:00', '18:00', true));
  });
  return out;
}
function planB(inHm, outHm) {             /* 会社B … 7/11〜8/10 が締め */
  const out = [];
  days('2026-07-11', '2026-08-10').forEach((d) => {
    if (dow(d) === 0 || dow(d) === 6) return;
    out.push(...shift(d, inHm, outHm, true));
  });
  return out;
}

const ACC_A = '509d7eb5-92f4-4856-ae8c-ffd82a9c2dee';   // timeally-test@example.com（既にある）
const EMAIL_B = 'timeally-test-b@example.com';
const PW_B = 'timeally-b-2026';

console.log(`倉庫: ${cfg.ref.slice(0, 4)}…（env: ${cfg.env}）`);

/* ── ① 会社B の入れ物（ログインできる人）を作る ───────────────── */
await q(`
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated','authenticated',
       ${esc(EMAIL_B)}, extensions.crypt(${esc(PW_B)}, extensions.gen_salt('bf')),
       now(), now(), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
where not exists (select 1 from auth.users where email = ${esc(EMAIL_B)});`);
await q(`
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where u.email = ${esc(EMAIL_B)}
   and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider='email');`);
const accB = (await q(`select id from auth.users where email = ${esc(EMAIL_B)};`))[0].id;
console.log(`会社B の入り口: ${EMAIL_B} / ${PW_B}`);

/* ── ② 会社の設定 ────────────────────────────────────────────── */
await q(`
insert into timeally.tc_companies (account_id, name, close_day, daily_std_min, week_std_min, week_legal_min,
                                   break_default_min, legal_holiday_dow, holiday_mode, rounding, warn_on, sme)
values ('${ACC_A}', '山田工業', 31, 480, 2400, 2400, 60, 0, 'dow', 'none', false, true),
       ('${accB}',  '南海フーズ', 10, 480, 2400, 2400, 60, 0, 'dow', 'none', false, true)
on conflict (account_id) do update set
  name=excluded.name, close_day=excluded.close_day, legal_holiday_dow=excluded.legal_holiday_dow,
  holiday_mode=excluded.holiday_mode, rounding=excluded.rounding, updated_at=now();`);

/* ── ③ 従業員 ────────────────────────────────────────────────── */
const PEOPLE = [
  { acc: ACC_A, id: 'E1', no: 'A01', name: '田中 花子', yen: 1200, hire: '2023-04-01', plan: planA1() },
  { acc: ACC_A, id: 'E2', no: 'A02', name: '佐藤 健', yen: 1350, hire: '2021-10-01', plan: planA2() },
  { acc: accB, id: 'E1', no: 'B01', name: '鈴木 みどり', yen: 1150, hire: '2024-04-01', plan: planB('09:00', '18:00') },
  { acc: accB, id: 'E2', no: 'B02', name: '高橋 大輔', yen: 1400, hire: '2022-07-01', plan: planB('08:00', '20:30') },
];
for (const p of PEOPLE) {
  /* ★tc_pub には (account_id, employee_id) の一意が無い★ので upsert できない。
     既に居る人は ★入れ直さず 直す★（暗証番号と端末記憶を消さないため）。 */
  await q(`
update timeally.tc_pub set name=${esc(p.name)}, emp_no=${esc(p.no)}, hire_date='${p.hire}', hourly_yen=${p.yen}
 where account_id='${p.acc}' and employee_id=${esc(p.id)};`);
  await q(`
insert into timeally.tc_pub (account_id, employee_id, name, emp_no, hire_date, hourly_yen, init_code, active)
select '${p.acc}', ${esc(p.id)}, ${esc(p.name)}, ${esc(p.no)}, '${p.hire}', ${p.yen}, 'SEED2026', true
 where not exists (select 1 from timeally.tc_pub
                    where account_id='${p.acc}' and employee_id=${esc(p.id)});`);
}

/* ── ④ 打刻（★入れ直す前に その人の その期間だけ消す★＝何回流しても同じ） ── */
let total = 0;
for (const p of PEOPLE) {
  await q(`delete from timeally.tc_punch where account_id='${p.acc}' and employee_id=${esc(p.id)}
             and at >= timestamptz '2026-07-01 00:00+09' and at < timestamptz '2026-08-12 00:00+09';`);
  for (let i = 0; i < p.plan.length; i += 200) {
    const chunk = p.plan.slice(i, i + 200);
    const vals = chunk.map(([at, kind]) =>
      `('${p.acc}', ${esc(p.id)}, timestamptz '${at}+09', ${esc(kind)}, 'punch', now())`).join(',');
    await q(`insert into timeally.tc_punch (account_id, employee_id, at, kind, src, approved_at) values ${vals};`);
  }
  total += p.plan.length;
  console.log(`  ${p.name}: 打刻 ${p.plan.length}件`);
}

/* ── ⑤ 締めの記録は ★入れない★（画面で押して作る＝実物で確かめる） ── */
const st = await q(`
  select c.name, c.close_day,
         timeally.tc_period_ym(c.close_day,(now() at time zone 'Asia/Tokyo')::date) as now_ym,
         timeally.tc_state(c.account_id,(now() at time zone 'Asia/Tokyo')::date)    as now_state,
         (select count(*) from timeally.tc_punch p where p.account_id=c.account_id) as punches,
         (select count(*) from timeally.tc_close z where z.account_id=c.account_id) as closes
    from timeally.tc_companies c order by c.name;`);
console.log(`\n入れた打刻 ${total}件`);
st.forEach((r) => console.log(`  ${r.name} 締め日${r.close_day} → 今は ${r.now_ym}「${r.now_state}」／打刻${r.punches}件／締めの記録${r.closes}行`));
