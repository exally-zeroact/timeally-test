-- ============================================================================
-- Timeally（タイマリー）— 倉庫の設計図
-- ★部屋(schema)は timeally。部屋ごと持って出られる★
--   （ダイコメ管理画面と同じ判断。窓口の考え方は Castally/Exally で 2026-08-06 に実測済）
--
-- ★実の棚は timeally.* に置き、public に同じ名前の窓口(view)を置く★
--   窓口は ★security_invoker = true★ が命綱。
--   これが無いと窓の持ち主(postgres)の権利で開き、★全社のデータが見える★。
--   `create or replace view` は security_invoker を落とすので、
--   ★毎回そのすぐ後で alter view ... set (security_invoker=true) をやる★（前科あり）。
--
-- ★列を足す時の順番: ① 部屋の表に add column ② 窓を作り直す ③ その後にコード配信★
--   窓を忘れると、アプリは窓ごしにしか見られないので ★丸ごと db_error★ になる
--   （2026-08-09 ダイコメで実際に踏んだ。文法チェックも2460件のテストも緑のまま通った）
--
-- ★表は5つだけ。増やさない。★
--   tc_companies / tc_pub / tc_punch / tc_fix / tc_shift
--
-- 当て方: npm run db:apply （門番 scripts/sql-guard.mjs を必ず通る）
-- ============================================================================

create schema if not exists timeally;
create extension if not exists pgcrypto with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────
-- ① tc_companies … 会社情報（1アカウント1行）
--    ★ここに置くのは「会社が選べる見せ方」だけ。法定の率や日数は置かない★
--      （法定値は lib/tc-law.js に出典URLつきで1か所。倉庫に写すと2か所になって腐る）
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists timeally.tc_companies (
  account_id        uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  name              text not null default '',
  close_day         int  not null default 31,      -- 締め日。31=末日締め
  daily_std_min     int  not null default 480,     -- 1日の所定（分）。法定8時間とは別物
  week_std_min      int  not null default 2400,    -- 週の所定（分）
  week_legal_min    int  not null default 2400,    -- 週の法定（分）。特例事業は 2640
  break_default_min int  not null default 60,      -- 休憩の既定（分）
  legal_holiday_dow int  not null default 0,       -- 法定休日の曜日（0=日）
  week_start_dow    int  not null default 0,       -- 週の起算（0=日）
  -- ★丸め方。none=1分単位(既定・適法) / month=月合計の端数(適法) / daily30=日ごと30分切下(客の希望)★
  --   ★daily30 は適法ではない。だから「切り捨てた時間と金額」を必ず記録して社長に見せる★
  rounding          text not null default 'none' check (rounding in ('none','month','daily30')),
  -- ★警告は既定=切。ただし中では常に数えている（入れた瞬間に過去の分も出る）★
  warn_on           boolean not null default false,
  sme               boolean not null default true, -- 中小企業か（60時間超50%は2023-04-01から）
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- ② tc_pub … 従業員の入口（URL/QR＋暗証番号＋端末記憶）
--    ★payslip-app の pay_meisai_pub と【同じ設計】をなぞった★
--      （2026-07-06 に本番適用＋E2E検証済の物。自分で作ると必ず抜ける）
--      ・初回コード(init_code)で本人を縛る ・平文を持たない(bcrypt) ・端末を覚える
--      ・★5回失敗で15分ロック★ ・★最小8文字をサーバ側で強制★
--      ・★従業員(anon)にテーブルを直接読ませない＝RPC経由のみ★
--    ★暗証番号は4桁ではなく8文字以上★（端末記憶で毎回聞かないので手間は増えない）
--
--    name / hourly_yen / hire_date を置いている理由（表を増やさないため）:
--      name       … ★給与への受け口(kintai-csv.js)が「氏名」列を必須にしている★
--      hourly_yen … ★切り捨てた「金額」を出すのに要る★（無いときは 0 ではなく「未設定」と出す）
--      hire_date  … 有給の付与日数（労基法39条）と年5日の判定に要る
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists timeally.tc_pub (
  token         uuid primary key default gen_random_uuid(),
  account_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  employee_id   text not null,
  name          text not null default '',
  emp_no        text,
  hire_date     date,
  hourly_yen    int,                                -- null = 未設定（★0にしない★）
  init_code     text,                               -- 会社発行の初回コード。設定後は null
  pw_hash       text,                               -- pgcrypto bcrypt。平文で持たない
  device_tokens text[] not null default '{}',
  fail_count    int not null default 0,
  locked_until  timestamptz,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists idx_tc_pub_account on timeally.tc_pub(account_id);

-- ─────────────────────────────────────────────────────────────────────────
-- ③ tc_punch … ★打刻の生データ＝原本★
--    ★1分単位。丸めない・上書きしない・消さない★（労基法24条 賃金全額払い）
--    出勤簿は法定三帳簿の1つ。保存は5年（当分の間3年）＝★行を消す道を作らない★
--      ⇒ 消したい時は voided_at に印を付ける（行は残る）。RPCに delete は無い。
--    kind: in | out | break_in | break_out | ★away_in | away_out★
--      ★away（私用外出＝中抜け）は休憩と必ず別にする★
--      混ぜると 休憩45分/60分（労基法34条）の判定が狂う
--    src : punch（その場） | calendar（後から入れた＝★必ず申請扱い★）
--    approved_at: その場の打刻は即 now()。calendar は ★社長が承認するまで null★
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists timeally.tc_punch (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references auth.users(id) on delete cascade,
  employee_id text not null,
  at          timestamptz not null,
  kind        text not null check (kind in ('in','out','break_in','break_out','away_in','away_out')),
  src         text not null default 'punch' check (src in ('punch','calendar')),
  device      text,
  approved_at timestamptz,
  voided_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_tc_punch_emp_at on timeally.tc_punch(account_id, employee_id, at);

-- ─────────────────────────────────────────────────────────────────────────
-- ④ tc_fix … 直しの申請と承認
--    ★社長1人の会社は「自己承認」と残す★（承認が無かった事にしない）
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists timeally.tc_fix (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references auth.users(id) on delete cascade,
  employee_id  text not null,
  d            date not null,
  before_min   int,
  after_min    int,
  reason       text not null default '',
  requested_by text not null default 'employee',   -- employee | owner
  requested_at timestamptz not null default now(),
  approved_by  text,                               -- 'self'（自己承認）or 社長のuid文字列
  approved_at  timestamptz,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  punch_ids    uuid[] not null default '{}'        -- この申請で入れた打刻（承認で有効になる）
);
create index if not exists idx_tc_fix_pending on timeally.tc_fix(account_id, status, d);

-- ─────────────────────────────────────────────────────────────────────────
-- ⑤ tc_shift … ★予定（シフト管理表）。最初から作る。中身は空でよい★
--    理由: 司さんが「最後にシフト管理表のカレンダーを入れる」と言っている。
--          これは ★変形労働時間制で必要な『その日は何時間の予定だったか』の表と同じ物★で、
--          ★後から足せない★（残業の判定が「その日8時間超」から「実績 − 予定」に変わるため）。
--    ★変形労働時間制そのものは今は使わない★。欄と表だけ用意する。
--    planned_in / planned_out は ★遅刻・早退★ を出すのに要る（無ければ 0 ではなく「—」）。
--    day_kind は 有給・欠勤・休日 を持つ場所（表を増やさないため ここに置く）。
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists timeally.tc_shift (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references auth.users(id) on delete cascade,
  employee_id  text not null,
  d            date not null,
  planned_min  int,
  planned_in   time,
  planned_out  time,
  day_kind     text not null default 'work' check (day_kind in ('work','paid_leave','absent','holiday')),
  note         text not null default '',
  unique (account_id, employee_id, d)
);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS … 本人（account_id = auth.uid()）の行だけ。従業員(anon)は1行も直接読めない。
-- ─────────────────────────────────────────────────────────────────────────
alter table timeally.tc_companies enable row level security;
alter table timeally.tc_pub       enable row level security;
alter table timeally.tc_punch     enable row level security;
alter table timeally.tc_fix       enable row level security;
alter table timeally.tc_shift     enable row level security;

drop policy if exists own_tc_companies on timeally.tc_companies;
create policy own_tc_companies on timeally.tc_companies for all
  using (account_id = auth.uid()) with check (account_id = auth.uid());
drop policy if exists own_tc_pub on timeally.tc_pub;
create policy own_tc_pub on timeally.tc_pub for all
  using (account_id = auth.uid()) with check (account_id = auth.uid());
drop policy if exists own_tc_punch on timeally.tc_punch;
create policy own_tc_punch on timeally.tc_punch for all
  using (account_id = auth.uid()) with check (account_id = auth.uid());
drop policy if exists own_tc_fix on timeally.tc_fix;
create policy own_tc_fix on timeally.tc_fix for all
  using (account_id = auth.uid()) with check (account_id = auth.uid());
drop policy if exists own_tc_shift on timeally.tc_shift;
create policy own_tc_shift on timeally.tc_shift for all
  using (account_id = auth.uid()) with check (account_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- 窓口(view) … ★アプリは必ず窓ごしに読む★（部屋を直接指さない＝部屋ごと引っ越せる）
--   ★security_invoker = true が命綱★（呼んだ人の権利で開く＝実の棚のRLSが効く）
--   ★列を足したら ここも必ず作り直す★（窓に無い列を読むと丸ごと落ちる）
-- ─────────────────────────────────────────────────────────────────────────
create or replace view public.tc_companies with (security_invoker = true) as
  select * from timeally.tc_companies;
alter view public.tc_companies set (security_invoker = true);
grant select, insert, update, delete on public.tc_companies to authenticated;

create or replace view public.tc_pub with (security_invoker = true) as
  select * from timeally.tc_pub;
alter view public.tc_pub set (security_invoker = true);
grant select, insert, update, delete on public.tc_pub to authenticated;

create or replace view public.tc_punch with (security_invoker = true) as
  select * from timeally.tc_punch;
alter view public.tc_punch set (security_invoker = true);
grant select, insert, update, delete on public.tc_punch to authenticated;

create or replace view public.tc_fix with (security_invoker = true) as
  select * from timeally.tc_fix;
alter view public.tc_fix set (security_invoker = true);
grant select, insert, update, delete on public.tc_fix to authenticated;

create or replace view public.tc_shift with (security_invoker = true) as
  select * from timeally.tc_shift;
alter view public.tc_shift set (security_invoker = true);
grant select, insert, update, delete on public.tc_shift to authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- 従業員(anon)向け RPC … ★security definer。search_path に extensions が要る★
--   （crypt / gen_salt / gen_random_bytes は extensions スキーマにある。
--     public だけにすると ★関数が解決できず落ちる★＝payslip で踏んだ罠）
--
-- ★従業員に返すのは「自分が打った1分単位の生の時刻」だけ★
--   実労働・残業・丸め・金額を ★RPCが1つも返さない★＝画面の作り方に関係なく守られる
--   （画面だけで隠すと、いつか誰かが出してしまう）。
-- ═════════════════════════════════════════════════════════════════════════

create or replace function public.tc_auth(p_token uuid, p_device text)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('found',false); end if;
  return jsonb_build_object('found',true,
    'name', v_pub.name,
    'has_password',(v_pub.pw_hash is not null),
    'remembered',(p_device is not null and p_device = any(v_pub.device_tokens)),
    'locked',(v_pub.locked_until is not null and v_pub.locked_until > now()));
end $$;

create or replace function public.tc_set_password(p_token uuid, p_init text, p_pw text)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false); end if;
  if v_pub.locked_until is not null and v_pub.locked_until > now() then
    return jsonb_build_object('ok',false,'locked',true,'retry_at',v_pub.locked_until); end if;
  if v_pub.pw_hash is not null then return jsonb_build_object('ok',false,'already_set',true); end if;
  -- ★最小8文字はサーバ側で強制する（画面だけの検査は迂回できる）★
  if length(coalesce(p_pw,'')) < 8 then return jsonb_build_object('ok',false,'weak',true); end if;
  if v_pub.init_code is null or upper(trim(coalesce(p_init,''))) <> v_pub.init_code then
    update timeally.tc_pub set fail_count=fail_count+1,
      locked_until = case when fail_count+1 >= 5 then now()+interval '15 minutes' else locked_until end
      where token=p_token returning fail_count, locked_until into v_pub.fail_count, v_pub.locked_until;
    if v_pub.fail_count >= 5 then return jsonb_build_object('ok',false,'bad_init',true,'locked',true,'retry_at',v_pub.locked_until); end if;
    return jsonb_build_object('ok',false,'bad_init',true,'remaining',5 - v_pub.fail_count);
  end if;
  update timeally.tc_pub set pw_hash=crypt(p_pw, gen_salt('bf')), init_code=null, fail_count=0, locked_until=null
    where token=p_token;
  return jsonb_build_object('ok',true);
end $$;

create or replace function public.tc_verify(p_token uuid, p_pw text)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_dev text;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false); end if;
  if v_pub.locked_until is not null and v_pub.locked_until > now() then
    return jsonb_build_object('ok',false,'locked',true,'retry_at',v_pub.locked_until); end if;
  if v_pub.pw_hash is null or v_pub.pw_hash <> crypt(p_pw, v_pub.pw_hash) then
    update timeally.tc_pub set fail_count=fail_count+1,
      locked_until = case when fail_count+1 >= 5 then now()+interval '15 minutes' else locked_until end
      where token=p_token returning fail_count, locked_until into v_pub.fail_count, v_pub.locked_until;
    if v_pub.fail_count >= 5 then return jsonb_build_object('ok',false,'locked',true,'retry_at',v_pub.locked_until); end if;
    return jsonb_build_object('ok',false,'remaining',5 - v_pub.fail_count);
  end if;
  v_dev := encode(gen_random_bytes(18),'hex');
  update timeally.tc_pub set device_tokens=array_append(device_tokens, v_dev), fail_count=0, locked_until=null
    where token=p_token;
  return jsonb_build_object('ok',true,'device_token',v_dev,'name',v_pub.name);
end $$;

-- 認証（端末記憶 or 暗証番号）を1か所で確かめる内部関数
create or replace function timeally.tc_ok(v_pub timeally.tc_pub, p_device text, p_pw text)
returns boolean language sql immutable set search_path=public, extensions, timeally as $$
  select (p_device is not null and p_device = any(v_pub.device_tokens))
      or (p_pw is not null and v_pub.pw_hash is not null and v_pub.pw_hash = crypt(p_pw, v_pub.pw_hash));
$$;

-- ★打刻を入れる★
--   src='punch'    … その場の打刻。approved_at は即 now()（承認は要らない）
--   src='calendar' … 後から入れた物。★必ず申請扱い＝approved_at は null★
create or replace function public.tc_punch_add(p_token uuid, p_device text, p_pw text,
                                               p_at timestamptz, p_kind text, p_src text)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_id uuid; v_src text;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false,'unauth',true); end if;
  if not timeally.tc_ok(v_pub, p_device, p_pw) then return jsonb_build_object('ok',false,'unauth',true); end if;
  if p_kind not in ('in','out','break_in','break_out','away_in','away_out') then
    return jsonb_build_object('ok',false,'bad_kind',true); end if;
  v_src := case when p_src = 'calendar' then 'calendar' else 'punch' end;
  -- ★未来の打刻は入れさせない（原本を汚さない）★
  if p_at > now() + interval '5 minutes' then return jsonb_build_object('ok',false,'future',true); end if;
  insert into timeally.tc_punch(account_id, employee_id, at, kind, src, device, approved_at)
  values (v_pub.account_id, v_pub.employee_id, p_at, p_kind, v_src, left(coalesce(p_device,''),64),
          case when v_src='punch' then now() else null end)
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'pending', v_src='calendar');
end $$;

-- ★自分の記録を返す。返すのは「打った生の時刻」だけ★
--   実労働・残業・丸め・金額は ★1つも返さない★（従業員は嘘の数字を一度も見ない）
create or replace function public.tc_my_punches(p_token uuid, p_device text, p_pw text,
                                                p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_rows jsonb;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('unauth',true); end if;
  if not timeally.tc_ok(v_pub, p_device, p_pw) then return jsonb_build_object('unauth',true); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'at', at, 'kind', kind, 'src', src,
           'pending', (approved_at is null)) order by at), '[]')
    into v_rows
    from timeally.tc_punch
   where account_id = v_pub.account_id and employee_id = v_pub.employee_id
     and voided_at is null
     and at >= p_from::timestamptz and at < (p_to + 1)::timestamptz;
  return jsonb_build_object('punches', v_rows, 'name', v_pub.name);
end $$;

-- ★直しの申請★（従業員が出す。承認は社長側）
create or replace function public.tc_fix_request(p_token uuid, p_device text, p_pw text,
                                                 p_d date, p_before int, p_after int,
                                                 p_reason text, p_punch_ids uuid[])
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_id uuid;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false,'unauth',true); end if;
  if not timeally.tc_ok(v_pub, p_device, p_pw) then return jsonb_build_object('ok',false,'unauth',true); end if;
  insert into timeally.tc_fix(account_id, employee_id, d, before_min, after_min, reason, requested_by, punch_ids)
  values (v_pub.account_id, v_pub.employee_id, p_d, p_before, p_after, coalesce(p_reason,''), 'employee',
          coalesce(p_punch_ids,'{}'))
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

-- 会社の設定のうち ★従業員の画面に要る物だけ★（丸め方や率は返さない）
create or replace function public.tc_pub_info(p_token uuid)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_co timeally.tc_companies;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('found',false); end if;
  select * into v_co from timeally.tc_companies where account_id = v_pub.account_id;
  return jsonb_build_object('found',true,'company', coalesce(v_co.name,''), 'name', v_pub.name);
end $$;

grant usage on schema timeally to authenticated;
grant execute on function
  public.tc_auth(uuid,text),
  public.tc_set_password(uuid,text,text),
  public.tc_verify(uuid,text),
  public.tc_punch_add(uuid,text,text,timestamptz,text,text),
  public.tc_my_punches(uuid,text,text,date,date),
  public.tc_fix_request(uuid,text,text,date,int,int,text,uuid[]),
  public.tc_pub_info(uuid)
to anon, authenticated;

-- 初回コードの再発行（社長）はRLSで直接 update すればよい:
--   update tc_pub set init_code='ABCD1234', pw_hash=null, device_tokens='{}', fail_count=0, locked_until=null
--   where token='…';
