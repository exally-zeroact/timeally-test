-- ★番号が null でも 通った 穴を 塞ぐ★（2026-10-20・Timeally）
-- 中身は supabase/schema.sql の tc_pin_set と tc_verify を ★そのまま 切り出した 物★
--   （tests/schema-contract.test.mjs が 2つの 本体が 同じかを 毎回 見る）
-- create or replace は 権限（grant）を そのまま 残す＝grant は 書き直さない
-- 当て方: begin; から commit; まで 1回で 当てる（途中で 落ちたら 何も 変わらない）
begin;

create or replace function public.tc_pin_set(p_token uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_dev text;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false); end if;
  if v_pub.locked_until is not null and v_pub.locked_until > now() then
    return jsonb_build_object('ok',false,'locked',true,'retry_at',v_pub.locked_until); end if;
  -- ★2回目からは決められない★（作り直すのは社長の側）
  if v_pub.pw_hash is not null then return jsonb_build_object('ok',false,'already_set',true); end if;
  -- ★null を 先に 断る★（2026-10-20）null だと `!~` の答えが null＝真でも偽でもなく この行を 素通りし、
  --   pw_hash に crypt(null)=null が入って「決めた」と帳面に残り 端末の鍵まで出た（何回でも）
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then return jsonb_build_object('ok',false,'bad_pin',true); end if;
  update timeally.tc_pub set pw_hash=crypt(p_pin, gen_salt('bf')), init_code=null,
                             fail_count=0, locked_until=null
    where token=p_token;
  -- ★決めた事を残す（追記だけ・消さない）★
  insert into timeally.tc_close(account_id, ym, action, by_uid, by_name, employee_id, reason)
  values (v_pub.account_id, to_char((now() at time zone 'Asia/Tokyo')::date,'YYYY-MM'),
          'pin_set', v_pub.account_id, v_pub.name, v_pub.employee_id, '');
  -- ★決めたら そのまま入れる★（決めた直後にもう一度 打たせない）
  v_dev := encode(gen_random_bytes(18),'hex');
  update timeally.tc_pub set device_tokens=array_append(device_tokens, v_dev) where token=p_token;
  return jsonb_build_object('ok',true,'device_token',v_dev,'name',v_pub.name);
end $$;

create or replace function public.tc_verify(p_token uuid, p_pw text)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_dev text;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false); end if;
  if v_pub.locked_until is not null and v_pub.locked_until > now() then
    return jsonb_build_object('ok',false,'locked',true,'retry_at',v_pub.locked_until); end if;
  -- ★番号が 無い・空 も「まちがい」の道へ（回数にも 数える）★（2026-10-20）
  --   前は `pw_hash <> crypt(p_pw, …)` だけ＝p_pw が null だと 答えが null で この if に入らず、
  --   ★番号なしで ok と 端末の鍵が 出た★（リンクを 持てば 誰でも）。比べは null でも 必ず 真偽が出る is distinct from
  if p_pw is null or p_pw = '' or v_pub.pw_hash is null
     or v_pub.pw_hash is distinct from crypt(p_pw, v_pub.pw_hash) then
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

commit;
