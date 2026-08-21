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
  -- 法定休日の曜日（0=日 … 6=土）／★-1 = 決めていない（就業規則で特定していない）★
  --   労基法35条の法定休日は「週に1日」。★特定する義務は無い★（明確にするのが望ましい、まで）。
  --   ★決めていない会社に アプリが勝手に曜日を決めない★＝休日の割増を付けない。
  --   だから ★新しい会社の既定は -1★。
  legal_holiday_dow int  not null default -1 check (legal_holiday_dow between -1 and 6),
  -- ★法定休日の決め方（労基法35条：毎週1日 または 4週4日）★
  --   none=決めていない（既定）／dow=曜日で決める／per_person=従業員ごとに曜日／w4d4=4週4日制
  --   ★w4d4 は 4週間の起算日が要る★（就業規則等で明らかにする）。空のままでは選べない
  holiday_mode        text not null default 'none' check (holiday_mode in ('none','dow','per_person','w4d4')),
  holiday_cycle_start date,
  week_start_dow    int  not null default 0,       -- 週の起算（0=日）
  -- ★丸め方★
  --   none    = 1分単位（既定・適法）
  --   month   = ★通達そのもの★（1か月の合計・1時間未満の端数を30分で分ける／基発150号・適法）
  --   daily30 = 日ごと30分切り下げ（古い設定。custom(30/floor/day) と同じ・★適法ではない★）
  --   custom  = 単位 × 向き × かける先 を会社が選ぶ（下の3列）
  -- ★どれを選んでも 打った時刻(tc_punch)は1分単位のまま★。変わるのは見せ方だけ。
  -- ★労働者に不利になる組み合わせは画面で注意を出す（止めない・黙って選ばせない）★
  rounding          text not null default 'none' check (rounding in ('none','month','daily30','custom')),
  round_unit_min    int  not null default 1  check (round_unit_min in (1,5,10,15,30,60)),
  round_dir         text not null default 'floor' check (round_dir in ('floor','ceil','round')),
  round_scope       text not null default 'day'   check (round_scope in ('day','month')),
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
  -- ★法定休日の人ごとの上書き★（null = 会社の決まりに従う／0=日 … 6=土）
  --   シフト制（運転代行・飲食・建設）は曜日を固定できない会社が多いので、人ごとに決められる
  legal_holiday_dow int check (legal_holiday_dow between 0 and 6),
  created_at    timestamptz not null default now()
);
create index if not exists idx_tc_pub_account on timeally.tc_pub(account_id);

-- ★もう作ってある倉庫にも足す（作り直さない）★
--   `create table if not exists` は ★既に在る表には何もしない★ので、
--   列と決まりは ここで明示的に足す。★行は1行も動かない★。
--   ・丸めの列3つ（無ければ足す）
--   ・rounding の決まりを 'custom' も通す形に付け替える
--     （★中身は消えない★。制約の名前を差し替えるだけ。列は落とさない）
alter table timeally.tc_companies add column if not exists round_unit_min int  not null default 1;
alter table timeally.tc_companies add column if not exists round_dir      text not null default 'floor';
alter table timeally.tc_companies add column if not exists round_scope    text not null default 'day';
alter table timeally.tc_companies drop constraint if exists tc_companies_rounding_check;
alter table timeally.tc_companies add  constraint tc_companies_rounding_check
  check (rounding in ('none','month','daily30','custom'));
alter table timeally.tc_companies drop constraint if exists tc_companies_round_unit_min_check;
alter table timeally.tc_companies add  constraint tc_companies_round_unit_min_check
  check (round_unit_min in (1,5,10,15,30,60));
alter table timeally.tc_companies drop constraint if exists tc_companies_round_dir_check;
alter table timeally.tc_companies add  constraint tc_companies_round_dir_check
  check (round_dir in ('floor','ceil','round'));
alter table timeally.tc_companies drop constraint if exists tc_companies_round_scope_check;
alter table timeally.tc_companies add  constraint tc_companies_round_scope_check
  check (round_scope in ('day','month'));
-- ★法定休日の決め方を4つにする★（既に在る行の値は動かさない）
alter table timeally.tc_companies add column if not exists holiday_mode        text not null default 'none';
alter table timeally.tc_companies add column if not exists holiday_cycle_start date;
alter table timeally.tc_companies drop constraint if exists tc_companies_holiday_mode_check;
alter table timeally.tc_companies add  constraint tc_companies_holiday_mode_check
  check (holiday_mode in ('none','dow','per_person','w4d4'));
-- ★人ごとの上書き★（null = 会社の決まりに従う）
alter table timeally.tc_pub add column if not exists legal_holiday_dow int;

-- ★紙の綴じ代（2026-08-15 司さんの指摘で作り直した）★
--   2穴パンチの中心は ★紙の端からおよそ12mm★。
--   ★綴じる場所は選ばせない★＝★四辺とも20mm★なら 上でも左でも右でも 穴が余白に入る。
--   ★2026-08-15（同じ日の後）に 設定そのものを外した★（司さんの決定）
--   ＝★勤務表は必ず綴じる紙★なので ★いつでも四辺20mm★。人が決める事を1つ減らす。
--   ⇒ ★bind_margin も もう読まない・書かない★（四辺20mmは js/tc-ui.js の1か所で決める）。
alter table timeally.tc_companies add column if not exists bind_margin boolean not null default true;
-- ★bind_side（綴じる場所）も もう読まない・書かない★（同じ日に「四辺とも同じ」へ変えたため）。
--   ★列は落とさない★＝門番(scripts/sql-guard.mjs)が ★消す系(drop column)を止める★。
--   出勤簿は法定三帳簿なので ★列を落とす道を軽々に作らない★のが このアプリの前提。
--   （落とすなら ★司さんの一言をもらって 別の塊で★。今は 使わないだけにしておく）
alter table timeally.tc_companies add column if not exists bind_side text;

-- ★同じ人を2行 作らせない（指示役の裁定 2026-08-15）★
--   ★人が入ってからでは剥がせない★ので、まだ0行/4行のうちに入れる。
--   実測（2026-08-15 両方の倉庫を読むだけで数えた）:
--     DB-test … 4行／employee_id 別々4／emp_no 別々4／空の emp_no 0
--     本番    … 0行（まだ誰も居ない）
--   ⇒ ★消す物も直す物も無しで足せる★
--
--   ★2つは別物★（ここを混ぜると危ない）:
--     employee_id … ★機械が作る鍵★（'E'+時刻）。打刻・予定・締めが これで人を指す
--     emp_no      … ★人が打つ従業員番号★。★給与CSVの「従業員番号」に載るのはこちら★
alter table timeally.tc_pub drop constraint if exists tc_pub_uniq_employee_id;
alter table timeally.tc_pub add  constraint tc_pub_uniq_employee_id
  unique (account_id, employee_id);
-- ★空の鍵を作らせない★（空だと打刻が誰の物か分からなくなる）
alter table timeally.tc_pub drop constraint if exists tc_pub_employee_id_not_blank;
alter table timeally.tc_pub add  constraint tc_pub_employee_id_not_blank
  check (length(btrim(employee_id)) > 0);

-- ★従業員番号(emp_no)は「入れたなら重ならない」★
--   ★空は許す★＝番号を使っていない会社が実際にある（うちの実物もそう）。
--   ★給与の受け口(kintai-csv.js)を実際に読んで確かめた★:
--     氏名が空の行は ★落とされる★（＝氏名が必須）／従業員番号は ★運ぶだけで必須ではない★
--   だから ★空を禁止せず、重なりだけを止める★（部分的な一意）。
create unique index if not exists tc_pub_uniq_emp_no
  on timeally.tc_pub (account_id, emp_no)
  where emp_no is not null and btrim(emp_no) <> '';
alter table timeally.tc_pub drop constraint if exists tc_pub_legal_holiday_dow_check;
alter table timeally.tc_pub add  constraint tc_pub_legal_holiday_dow_check
  check (legal_holiday_dow is null or legal_holiday_dow between 0 and 6);
-- ★法定休日に「決めていない(-1)」を足す★（既に在る行の値は動かさない）
alter table timeally.tc_companies alter column legal_holiday_dow set default -1;
alter table timeally.tc_companies drop constraint if exists tc_companies_legal_holiday_dow_check;
alter table timeally.tc_companies add  constraint tc_companies_legal_holiday_dow_check
  check (legal_holiday_dow between -1 and 6);

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

-- ★「この時刻で合っている」と本人が答えた印★（2026-08-18 司さん「時刻を間違えた時」）
--   機械が「長すぎ/短すぎ/退勤が先」に気づいて聞いた時、★合っていると答えたら 二度と聞かない★。
--   ★中身は「聞いた事の種類」★（too-long / too-short / out-before-in）。
--   ★打刻そのものは1文字も動かない★（at も kind も そのまま）。
alter table timeally.tc_punch add column if not exists ok_types text[] not null default '{}';

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

-- ★「この1本は使わない」というお願い（2026-08-18）★
--   連打・打ち間違いの答え（「08:00 は出勤でした」＝退勤の1本を使わない）を持つ場所。
--   ★消さない・書き換えない★ので、承認したら tc_punch.voided_at に印を付けるだけ
--   （at も kind も1分も動かさない＝原本は残る）。
--   ★列を足したら 窓(view)も作り直す★（この設計図の下の create or replace view が やる）。
alter table timeally.tc_fix add column if not exists void_ids uuid[] not null default '{}';

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
-- ★日ごとの休憩の直し（2026-08-15）★
--   休憩は ★押させず 会社の既定を引く★ 形にしたが、
--   ★本当に休憩が取れなかった日★は在るので 社長が日ごとに直せるようにする。
--   ★誰が・いつ 直したかを残す★（tc_shift は「その日の予定」の棚なので ここに置く）。
alter table timeally.tc_shift add column if not exists break_min int;
alter table timeally.tc_shift add column if not exists break_by  uuid;
alter table timeally.tc_shift add column if not exists break_at  timestamptz;
-- ★有給を「付ける／外す」（2026-08-19）★
--   ★新しい棚は作らない★＝有給は もともと day_kind='paid_leave' が持っている。
--   足すのは ★誰が・いつ 付けたか★ の2つだけ（★休憩の break_by / break_at と同じ形★）。
--   ★付与日数・繰越・残り日数の列は作らない★＝付けた日を数えれば出る（lib/tc-law.js が数える）。
-- ★人が書いた言葉は 別の欄に持つ（2026-08-21 指示役）★
--   前は reason 1つに ★自動で作った文（「…を 13:47 に直します」）★と
--   ★人が書いた言葉（「打ち忘れ」）★が 混ざっていた。
--   ⇒ 画面が「理由:」として刷ると ★理由でない文が 理由の顔で出る★。
--   ★文字で見分けるのをやめる★＝ reason=機械が作った説明／note=人が書いた言葉。
alter table timeally.tc_fix add column if not exists note text not null default '';

alter table timeally.tc_shift add column if not exists day_kind_by uuid;
alter table timeally.tc_shift add column if not exists day_kind_at timestamptz;

alter table timeally.tc_shift drop constraint if exists tc_shift_break_min_range;
alter table timeally.tc_shift add  constraint tc_shift_break_min_range
  check (break_min is null or (break_min >= 0 and break_min <= 1440));

-- ★6本目の棚 tc_close … 締めの記録（追記だけ）★（2026-08-15）
--   ★上書きしない・消さない★＝直しの跡が残る。
--   「表は5つだけ」と決めたが、★確定/解除は「いつ・誰が・なぜ」を残さないと
--   後で どの数字を給与へ渡したのか 誰も言えなくなる★ ので1本だけ足した。
--   ★行を書き換えない＝足すだけ★ なので、他の5本とは性質が違う（帳面）。
--   労基法109条（記録は5年・当分の間3年）と同じ考え方（lib/tc-law.js）。
--
--   action  close  … 確定した
--           reopen … 解除した（★理由が要る★）
--           export … 給与へ渡した（CSV/Excelを出した）
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists timeally.tc_close (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  ym         text not null check (ym ~ '^[0-9]{4}-[0-9]{2}$'),
  -- close/reopen/export … 締めの話（月ぜんたい）
  -- pin_set/pin_reissue … ★入口の話（人ごと・2026-08-15 追加）★
  --   ★同じ帳面に入れる★＝追記だけ・消せない、という性質が同じだから（表は増やさない）。
  --   ★見せる時は分ける★（締めの履歴に混ぜない。lib/tc-close.js の historyOf が分ける）
  action     text not null check (action in ('close','reopen','export','pin_set','pin_reissue')),
  at         timestamptz not null default now(),
  by_uid     uuid not null,
  by_name    text not null default '',
  -- ★人ごとの話（pin_set / pin_reissue）だけ入る★。締めの話は null
  employee_id text,
  reason     text not null default '',
  -- ★確定した時の数字を そのまま焼き付ける★（後で人数や合計が動いても、
  --   「渡した時はこうだった」が残る＝食い違いに気づける）
  snapshot   jsonb
);
create index if not exists tc_close_idx on timeally.tc_close (account_id, ym, at);
-- ★解除には理由が要る（画面だけでなく倉庫でも止める）★
-- ★もう作ってある倉庫にも足す（作り直さない）★
alter table timeally.tc_close add column if not exists employee_id text;
alter table timeally.tc_close drop constraint if exists tc_close_action_check;
alter table timeally.tc_close add  constraint tc_close_action_check
  check (action in ('close','reopen','export','pin_set','pin_reissue'));
alter table timeally.tc_close drop constraint if exists tc_close_reason_req;
alter table timeally.tc_close add  constraint tc_close_reason_req
  check (action <> 'reopen' or length(btrim(reason)) >= 2);

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

-- ★tc_close だけは for all にしない＝読む/足すだけ。直す/消す の決まりを作らない★
--   （決まりが無い＝その操作は誰にも通らない。倉庫の側で「追記だけ」を守る）
alter table timeally.tc_close enable row level security;
drop policy if exists own_tc_close_read on timeally.tc_close;
create policy own_tc_close_read on timeally.tc_close for select
  using (account_id = auth.uid());
drop policy if exists own_tc_close_add on timeally.tc_close;
create policy own_tc_close_add on timeally.tc_close for insert
  with check (account_id = auth.uid() and by_uid = auth.uid());

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

-- ★tc_close の窓は 読む/足す だけ渡す（update/delete は渡さない＝追記だけ）★
create or replace view public.tc_close with (security_invoker = true) as
  select * from timeally.tc_close;
alter view public.tc_close set (security_invoker = true);
grant select, insert on public.tc_close to authenticated;

create or replace view public.tc_shift with (security_invoker = true) as
  select * from timeally.tc_shift;
alter view public.tc_shift set (security_invoker = true);
grant select, insert, update, delete on public.tc_shift to authenticated;

-- ★窓から anon を外す★（2026-08-22 指示役の承認・本番を読んで見つけた）
--   ★書いていないのに 付いている★＝この倉庫は「新しく作る棚・窓・関数に anon を付ける」
--   既定(ALTER DEFAULT PRIVILEGES)を持っている（Supabase の標準・★他アプリと同じ倉庫なので触らない★）。
--   実測（本番）… 窓6本に anon が ★読む・入れる・書き換える・消す 全部★ 付いていた。
--   ★今 漏れてはいない★（実の棚に anon が無く、窓は security_invoker＝呼んだ人の権利で開くため
--     anon の鍵で叩くと 401/42501）。★ただし門が1枚だけ★＝棚に anon を1行 足した日に開く。
--   ⇒★窓の側でも 外して門を2枚にする★。
--   ★窓は PUBLIC が付いていないので anon だけ外せば足りる★（関数は PUBLIC も外す＝下の revoke）。
--   ★従業員の画面は RPC(security definer)しか使わない★ので、窓の anon を外しても打刻は動く
--   （★実際に1周 押して確かめる★）。
revoke all privileges on public.tc_companies from anon;
revoke all privileges on public.tc_pub       from anon;
revoke all privileges on public.tc_punch     from anon;
revoke all privileges on public.tc_fix       from anon;
revoke all privileges on public.tc_close     from anon;
revoke all privileges on public.tc_shift     from anon;

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

-- ★暗証番号を決める（初回だけ）★（2026-08-15 司さんの指摘で作り直した）
--   前は ★秘密が3つ★ あった: リンク／会社が渡す「最初のあいことば」／8文字以上の文字列。
--   ★「最初のあいことば」はリンクと同じ口で渡すので 守りが増えていない★ ので無くした。
--   ★秘密は「暗証番号（数字4〜6桁）」1つだけ★。現場で毎日 何回も打つ物だから。
--
--   ★守りが減る分の埋め合わせ★
--     ・リンク(?t=)は uuid ＝ ★リンクを持っている人しか 番号を試せない★
--     ・★5回まちがえたら15分あかない★（1人ずつ）
--     ・★2回目からは決められない★（社長が「入口を作り直す」まで変えられない）
--     ・★決めた事を帳面に残す★（社長の画面に日時が出る＝身に覚えが無ければ気づける）
--
--   ★桁は倉庫でも見る★（画面だけの検査は迂回できる）。lib/tc-pin.js と同じ線。
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
  if p_pin !~ '^[0-9]{4,6}$' then return jsonb_build_object('ok',false,'bad_pin',true); end if;
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

-- ★引数の違う古い形は落とす★（残ると「最初のあいことば」の口が生き続ける）
drop function if exists public.tc_set_password(uuid,text,text);

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

-- ★その日が どの締め(YYYY-MM)に入るか★（lib/tc-close.js と同じ線を倉庫でも引く）
--   締め日20 → 7/21〜8/20 は '2026-08'。★締め日30 の2月は 日が28までしか無いので自然に末日へ寄る★
create or replace function timeally.tc_period_ym(p_close_day int, p_d date)
returns text language sql immutable as $$
  select case when extract(day from p_d) <= greatest(1, least(31, coalesce(p_close_day,31)))
              then to_char(p_d,'YYYY-MM')
              else to_char(p_d + interval '1 month','YYYY-MM') end;
$$;

-- ★締めの状態を倉庫でも決める★（open / pending / closed）
--   画面だけで止めると ★URLを直に叩けば通る★。入口の側で止める。
create or replace function timeally.tc_state(p_account uuid, p_d date)
returns text language plpgsql stable set search_path=public, extensions, timeally as $$
declare v_cd int; v_ym text; v_1st date; v_end date; v_close timestamptz; v_reopen timestamptz;
begin
  select close_day into v_cd from timeally.tc_companies where account_id = p_account;
  v_cd := greatest(1, least(31, coalesce(v_cd, 31)));
  v_ym := timeally.tc_period_ym(v_cd, p_d);
  v_1st := to_date(v_ym || '-01', 'YYYY-MM-DD');
  -- ★締めの最終日＝「締め日」と「その月の末日」の小さい方★
  v_end := least((v_1st + interval '1 month - 1 day')::date, (v_1st + (v_cd - 1) * interval '1 day')::date);
  select max(at) into v_close  from timeally.tc_close where account_id=p_account and ym=v_ym and action='close';
  select max(at) into v_reopen from timeally.tc_close where account_id=p_account and ym=v_ym and action='reopen';
  if v_close is not null and (v_reopen is null or v_close > v_reopen) then return 'closed'; end if;
  if ((now() at time zone 'Asia/Tokyo')::date) > v_end then return 'pending'; end if;
  return 'open';
end $$;

-- ★打刻を入れる★
--   src='punch'    … その場の打刻。approved_at は即 now()（承認は要らない）
--   src='calendar' … 後から入れた物。★必ず申請扱い＝approved_at は null★
create or replace function public.tc_punch_add(p_token uuid, p_device text, p_pw text,
                                               p_at timestamptz, p_kind text, p_src text)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_id uuid; v_src text; v_st text;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false,'unauth',true); end if;
  if not timeally.tc_ok(v_pub, p_device, p_pw) then return jsonb_build_object('ok',false,'unauth',true); end if;
  if p_kind not in ('in','out','break_in','break_out','away_in','away_out') then
    return jsonb_build_object('ok',false,'bad_kind',true); end if;
  v_src := case when p_src = 'calendar' then 'calendar' else 'punch' end;
  -- ★未来の打刻は入れさせない（原本を汚さない）★
  if p_at > now() + interval '5 minutes' then return jsonb_build_object('ok',false,'future',true); end if;
  -- ★締め日が過ぎた月には 入れさせない★（画面で隠すだけでは URL を直に叩けば通る）
  --   返すのは「締め切りました」だけ。★割増・丸めの話は1文字も返さない★
  v_st := timeally.tc_state(v_pub.account_id, ((p_at at time zone 'Asia/Tokyo')::date));
  if v_st <> 'open' then
    return jsonb_build_object('ok',false,'closed',true,'state',v_st,
      'ym', timeally.tc_period_ym((select close_day from timeally.tc_companies where account_id=v_pub.account_id),
                                  ((p_at at time zone 'Asia/Tokyo')::date)));
  end if;
  insert into timeally.tc_punch(account_id, employee_id, at, kind, src, device, approved_at)
  values (v_pub.account_id, v_pub.employee_id, p_at, p_kind, v_src, left(coalesce(p_device,''),64),
          case when v_src='punch' then now() else null end)
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'pending', v_src='calendar');
end $$;

-- ★打った直後だけ 自分で取り消せる★（2026-08-18 司さん「ミスのないような対処をさせろ」）
--   ★これは「消す道」ではない★:
--     ・行は残る（at も kind も1分も動かさない）。★voided_at の印を立てるだけ★
--     ・読む側（tc_my_punches / loadPunches）が voided_at is null で外すので、
--       ★会社には何も出ない＝お願いにもならない＝会社の手間も増えない★
--   ★門は倉庫の側にも作る★（画面だけで止めると 直に叩けば通る）:
--     ① 自分の打刻だけ ② その場の打刻(src='punch')だけ ③ ★60秒以内★ ④ まだ取り消していない
--     ⑤ 締め切った月は受け付けない
--   ★60秒の根拠★: 実データ（tc_punch の created_at）で ★押し直しの間隔は最大11.9秒★。その5倍。
create or replace function public.tc_punch_undo(p_token uuid, p_device text, p_pw text, p_id uuid)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_row timeally.tc_punch; v_st text;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false,'unauth',true); end if;
  if not timeally.tc_ok(v_pub, p_device, p_pw) then return jsonb_build_object('ok',false,'unauth',true); end if;
  select * into v_row from timeally.tc_punch
   where id = p_id and account_id = v_pub.account_id and employee_id = v_pub.employee_id;
  if v_row.id is null then return jsonb_build_object('ok',false,'not_mine',true); end if;
  if v_row.voided_at is not null then return jsonb_build_object('ok',false,'already',true); end if;
  if v_row.src <> 'punch' then return jsonb_build_object('ok',false,'not_punch',true); end if;
  if now() - v_row.created_at > interval '60 seconds' then
    return jsonb_build_object('ok',false,'too_late',true); end if;
  v_st := timeally.tc_state(v_pub.account_id, ((v_row.at at time zone 'Asia/Tokyo')::date));
  if v_st <> 'open' then return jsonb_build_object('ok',false,'closed',true,'state',v_st); end if;
  update timeally.tc_punch set voided_at = now() where id = p_id;
  return jsonb_build_object('ok',true);
end $$;

-- ★自分で直す（お願い 不要）★（2026-08-18 夜 司さん「願いを出さな修正できんのはどうかと思う」）
--   ★線は3つ★ … ①その場60秒は取り消し（tc_punch_undo）／★②これ＝自分で直す★／③会社に出す(tc_fix)
--   ②の条件（★倉庫の側でも全部 見る★・画面だけで止めない）:
--     ・自分の打刻だけ ・まだ取り消していない ・★締めた月は駄目★（給与が確定した後に動かさない）
--   ★元の値は消さない★:
--     ・直す   … ★元の行に voided_at の印★＋★新しい時刻の行を1本 足す★（at も kind も作り替えない）
--     ・取り消す… ★元の行に voided_at の印だけ★
--   ★後から必ず見える★:
--     ・tc_fix に ★status='approved' / requested_by='employee' / approved_by='employee'★ で1行 残す
--       ＝会社の画面（直しの箱）に ★「自分で直した」★として出る。誰が・いつ・何を、が消えない。
create or replace function public.tc_punch_edit(p_token uuid, p_device text, p_pw text,
                                                p_id uuid, p_at timestamptz, p_kind text, p_reason text,
                                                p_note text default '')
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_row timeally.tc_punch; v_st text; v_new uuid; v_d date; v_kind text;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false,'unauth',true); end if;
  if not timeally.tc_ok(v_pub, p_device, p_pw) then return jsonb_build_object('ok',false,'unauth',true); end if;
  -- ★足す（p_id が無い）★ … 打ち忘れた分も ★その場で入る★（2026-08-18 夜3 司さん）
  --   ＝人が覚える言葉は「直す・消す・足す」の3つだけ。お願い・承認は もう出さない。
  if p_id is null then
    if p_at is null or p_kind not in ('in','out','break_in','break_out','away_in','away_out') then
      return jsonb_build_object('ok',false,'bad_kind',true); end if;
    v_d := ((p_at at time zone 'Asia/Tokyo')::date);
  else
    select * into v_row from timeally.tc_punch
     where id = p_id and account_id = v_pub.account_id and employee_id = v_pub.employee_id;
    if v_row.id is null then return jsonb_build_object('ok',false,'not_mine',true); end if;
    if v_row.voided_at is not null then return jsonb_build_object('ok',false,'already',true); end if;
    v_d := ((v_row.at at time zone 'Asia/Tokyo')::date);
  end if;
  v_st := timeally.tc_state(v_pub.account_id, v_d);
  -- ★締めた月は 自分では直せない★（会社に出す道＝tc_fix_request へ回す）
  if v_st = 'closed' then return jsonb_build_object('ok',false,'closed',true,'state',v_st); end if;
  -- ★これから先の時刻は入れない★（原本を汚さない・打刻を入れる時と同じ線）
  if p_at is not null and p_at > now() + interval '5 minutes' then
    return jsonb_build_object('ok',false,'future',true); end if;
  -- ★直す／足す時は 新しい行を1本 足す（その場で記録に入る＝approved_at を入れる）★
  if p_at is not null then
    if p_id is not null and ((p_at at time zone 'Asia/Tokyo')::date) <> v_d then
      return jsonb_build_object('ok',false,'other_day',true); end if;
    v_kind := case when p_id is null then p_kind else v_row.kind end;
    insert into timeally.tc_punch(account_id, employee_id, at, kind, src, device, approved_at)
    values (v_pub.account_id, v_pub.employee_id, p_at, v_kind,
            case when p_id is null then 'calendar' else 'punch' end,
            left(coalesce(p_device,''),64), now())
    returning id into v_new;
  end if;
  -- ★元の行は消さない。印を立てるだけ★（足す時は 消す元が無い）
  if p_id is not null then
    update timeally.tc_punch set voided_at = now() where id = p_id;
  end if;
  -- ★跡を残す（会社の画面に出る）★
  insert into timeally.tc_fix(account_id, employee_id, d, before_min, after_min, reason, note,
                              requested_by, approved_by, approved_at, status, punch_ids, void_ids)
  values (v_pub.account_id, v_pub.employee_id, v_d, null, null, coalesce(p_reason,''), coalesce(p_note,''),
          'employee', 'employee', now(), 'approved',
          case when v_new is null then '{}'::uuid[] else array[v_new] end,
          case when p_id is null then '{}'::uuid[] else array[p_id] end);
  return jsonb_build_object('ok',true,'id',v_new);
end $$;

-- ★社長も その人の打刻を直す・消す・足す★（2026-08-22 司さん
--   「社長の画面からやけど ここからも個人の出勤や退勤など修正できるようにした方がいい」）
--   ★決まりは1つのまま★＝直せるのは 締める前だけ。記録は消さない（元に印・新しい行を足す）。
--   ★従業員の口(tc_punch_edit)と 同じ門・同じ跡★（可否と理由を2か所に作らない）:
--     ・締めた月は断る（closed）／これから先の時刻は入れない（future）
--     ・元の行は voided_at の印だけ（★消さない★）／跡は tc_fix に残す（★誰が＝owner★）
--   ★違いは2つだけ★
--     ① 誰か … 社長は auth.uid()＝自分の会社の人だけ（他社の人は not_mine）
--     ② ★種類(kind)も直せる★ … 「08:00 が 出勤か退勤か 決まっていません」を
--        本人が答えられない時、会社が決められるようにする（実機で詰まった所）
create or replace function public.tc_punch_edit_owner(p_employee text, p_id uuid, p_at timestamptz,
                                                      p_kind text, p_reason text, p_note text default '')
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_acc uuid := auth.uid(); v_emp text; v_row timeally.tc_punch; v_st text; v_new uuid; v_d date; v_kind text;
begin
  if v_acc is null then return jsonb_build_object('ok',false,'unauth',true); end if;
  if p_id is null then
    -- ★足す★ … 誰の分かを 会社の人から確かめる
    if p_at is null or p_kind not in ('in','out','break_in','break_out','away_in','away_out') then
      return jsonb_build_object('ok',false,'bad_kind',true); end if;
    select employee_id into v_emp from timeally.tc_pub
     where account_id = v_acc and employee_id = p_employee and active;
    if v_emp is null then return jsonb_build_object('ok',false,'not_mine',true); end if;
    v_d := ((p_at at time zone 'Asia/Tokyo')::date);
  else
    select * into v_row from timeally.tc_punch where id = p_id and account_id = v_acc;
    if v_row.id is null then return jsonb_build_object('ok',false,'not_mine',true); end if;
    if v_row.voided_at is not null then return jsonb_build_object('ok',false,'already',true); end if;
    v_emp := v_row.employee_id;
    v_d := ((v_row.at at time zone 'Asia/Tokyo')::date);
  end if;
  v_st := timeally.tc_state(v_acc, v_d);
  if v_st = 'closed' then return jsonb_build_object('ok',false,'closed',true,'state',v_st); end if;
  if p_at is not null and p_at > now() + interval '5 minutes' then
    return jsonb_build_object('ok',false,'future',true); end if;
  -- ★直す／足す＝新しい行を1本 足す★（種類は 渡されたらそれ・無ければ元のまま）
  if p_at is not null or (p_id is not null and p_kind is not null) then
    if p_id is not null and p_at is not null
       and ((p_at at time zone 'Asia/Tokyo')::date) <> v_d then
      return jsonb_build_object('ok',false,'other_day',true); end if;
    v_kind := coalesce(p_kind, v_row.kind);
    if v_kind not in ('in','out','break_in','break_out','away_in','away_out') then
      return jsonb_build_object('ok',false,'bad_kind',true); end if;
    insert into timeally.tc_punch(account_id, employee_id, at, kind, src, device, approved_at)
    values (v_acc, v_emp, coalesce(p_at, v_row.at), v_kind,
            case when p_id is null then 'calendar' else 'punch' end, 'owner', now())
    returning id into v_new;
  end if;
  if p_id is not null then
    update timeally.tc_punch set voided_at = now() where id = p_id;
  end if;
  insert into timeally.tc_fix(account_id, employee_id, d, before_min, after_min, reason, note,
                              requested_by, approved_by, approved_at, status, punch_ids, void_ids)
  values (v_acc, v_emp, v_d, null, null, coalesce(p_reason,''), coalesce(p_note,''),
          'owner', 'owner', now(), 'approved',
          case when v_new is null then '{}'::uuid[] else array[v_new] end,
          case when p_id is null then '{}'::uuid[] else array[p_id] end);
  return jsonb_build_object('ok',true,'id',v_new);
end $$;

-- ★「この時刻で合っている」と答える★（2026-08-18）
--   機械が気づいて聞いた事に本人が答える。★答えたら 二度と聞かない★（印を1つ足すだけ）。
--   ★打刻は1文字も動かない★（at も kind も そのまま。消しもしない）。
--   ★同じ物を2回 足さない★（array に無い時だけ足す）。
create or replace function public.tc_punch_ok(p_token uuid, p_device text, p_pw text,
                                              p_id uuid, p_type text)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_row timeally.tc_punch; v_st text;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false,'unauth',true); end if;
  if not timeally.tc_ok(v_pub, p_device, p_pw) then return jsonb_build_object('ok',false,'unauth',true); end if;
  if p_type is null or p_type not in ('too-long','too-short','out-before-in') then
    return jsonb_build_object('ok',false,'bad_type',true); end if;
  select * into v_row from timeally.tc_punch
   where id = p_id and account_id = v_pub.account_id and employee_id = v_pub.employee_id;
  if v_row.id is null then return jsonb_build_object('ok',false,'not_mine',true); end if;
  v_st := timeally.tc_state(v_pub.account_id, ((v_row.at at time zone 'Asia/Tokyo')::date));
  if v_st = 'closed' then return jsonb_build_object('ok',false,'closed',true,'state',v_st); end if;
  update timeally.tc_punch
     set ok_types = (select array_agg(distinct x) from unnest(ok_types || array[p_type]) as x)
   where id = p_id;
  return jsonb_build_object('ok',true);
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
           'pending', (approved_at is null),
           -- ★「合っている」と答えた印★（時刻の確かめを二度と聞かない為。数えた結果ではない）
           'ok_types', ok_types) order by at), '[]')
    into v_rows
    from timeally.tc_punch
   where account_id = v_pub.account_id and employee_id = v_pub.employee_id
     and voided_at is null
     and at >= p_from::timestamptz and at < (p_to + 1)::timestamptz;
  return jsonb_build_object('punches', v_rows, 'name', v_pub.name);
end $$;

-- ★直しの申請★（従業員が出す。承認は社長側）
--   p_void_ids … ★「この1本は使わない」というお願い★（2026-08-18）
--     連打・打ち間違いの答え。★原本は消さない・書き換えない★ので、
--     ここでは ★自分の打刻かどうかだけ確かめて 申請に載せる★。
--     実際に印(voided_at)を付けるのは ★社長が承認した時★（js/tc-db.js の approveFix）。
create or replace function public.tc_fix_request(p_token uuid, p_device text, p_pw text,
                                                 p_d date, p_before int, p_after int,
                                                 p_reason text, p_punch_ids uuid[],
                                                 p_void_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_id uuid; v_st text; v_mine int;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('ok',false,'unauth',true); end if;
  if not timeally.tc_ok(v_pub, p_device, p_pw) then return jsonb_build_object('ok',false,'unauth',true); end if;
  -- ★確定した月は 申請も受け取らない★（受け取ると「出したのに直らない」が起きる）
  --   ★締め待ち(pending)は 受け取る★＝締め日の後こそ直しが出る
  v_st := timeally.tc_state(v_pub.account_id, p_d);
  if v_st = 'closed' then return jsonb_build_object('ok',false,'closed',true,'state',v_st); end if;
  -- ★他人の打刻を「使わない」に出来ないようにする★（自分の物だけ）
  if coalesce(array_length(p_void_ids,1),0) > 0 then
    select count(*) into v_mine from timeally.tc_punch
     where id = any(p_void_ids) and account_id = v_pub.account_id and employee_id = v_pub.employee_id;
    if v_mine <> array_length(p_void_ids,1) then return jsonb_build_object('ok',false,'not_mine',true); end if;
  end if;
  insert into timeally.tc_fix(account_id, employee_id, d, before_min, after_min, reason, requested_by,
                              punch_ids, void_ids)
  values (v_pub.account_id, v_pub.employee_id, p_d, p_before, p_after, coalesce(p_reason,''), 'employee',
          coalesce(p_punch_ids,'{}'), coalesce(p_void_ids,'{}'))
  returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end $$;

-- 会社の設定のうち ★従業員の画面に要る物だけ★（丸め方や率は返さない）
--   p_d … ★見ている月の中の1日★（省略すると今日）。
--         従業員が前の月を開いた時に「その月が締め切られているか」を返すために要る。
--         ★返すのは state と 出す文だけ★（数字は1つも渡さない）。
create or replace function public.tc_pub_info(p_token uuid, p_d date default null)
returns jsonb language plpgsql security definer set search_path=public, extensions, timeally as $$
declare v_pub timeally.tc_pub; v_co timeally.tc_companies; v_st text; v_ym text; v_day date;
begin
  select * into v_pub from timeally.tc_pub where token=p_token;
  if v_pub.token is null or not v_pub.active then return jsonb_build_object('found',false); end if;
  select * into v_co from timeally.tc_companies where account_id = v_pub.account_id;
  v_day := coalesce(p_d, (now() at time zone 'Asia/Tokyo')::date);
  v_st := timeally.tc_state(v_pub.account_id, v_day);
  v_ym := timeally.tc_period_ym(v_co.close_day, v_day);
  -- ★今日が締め切り済みかどうかだけ返す★（丸め方・率・所定は返さない）
  --   ★notice は そのまま画面に出す文★＝従業員に見せる文を作るのは ここ1か所。
  --   ★割増・丸め・切り捨て・金額の言葉は 1文字も入れない★
  --   （lib/tc-close.js の employeeNotice と ★同じ文★。tests/tc-close が突き合わせている）
  -- ★day_std_min は「会社の1日の所定（分）」★＝★長すぎの線を 画面と数える所で同じにする★ため。
  --   ★丸め方・率・金額は 今までどおり1つも返さない★（これは設定であって 数えた結果ではない）。
  -- ★有給は「入社日」と「有給にした日の一覧」だけ返す★（2026-08-19）
  --   ＝★残り日数は 画面(lib/tc-law.js)が数える★。同じ判定を倉庫と画面の2か所に置かない。
  return jsonb_build_object('found',true,'company', coalesce(v_co.name,''), 'name', v_pub.name,
    'state', v_st, 'ym', v_ym, 'day_std_min', coalesce(v_co.daily_std_min, 480),
    'hire_date', v_pub.hire_date,
    'yukyu_days', coalesce((select jsonb_agg(sh.d order by sh.d) from timeally.tc_shift sh
       where sh.account_id = v_pub.account_id and sh.employee_id = v_pub.employee_id
         and sh.day_kind = 'paid_leave'), '[]'::jsonb),
    'notice', case when v_st = 'closed'
      then ltrim(right(v_ym, 2), '0') || '月は締め切りました。直しは会社へ言ってください'
      else '' end);
end $$;

-- ★窓(view)への権限だけでは足りない★（2026-08-14 実UIを押して分かった）
--   窓は security_invoker=true ＝ ★呼んだ人の権利で開く★ので、
--   ★実の棚(timeally.*)への権限が無いと "permission denied for table" で落ちる★。
--   行の絞り込みは RLS がやるので、ここは「棚に触ってよい」だけを渡す。
--   ★表を足したら ここにも足す★（schema-contract の検査が抜けを赤にする）。
grant usage on schema timeally to authenticated;
grant select, insert, update, delete on timeally.tc_companies to authenticated;
grant select, insert, update, delete on timeally.tc_pub       to authenticated;
grant select, insert, update, delete on timeally.tc_punch     to authenticated;
grant select, insert, update, delete on timeally.tc_fix       to authenticated;
grant select, insert, update, delete on timeally.tc_shift     to authenticated;
-- ★tc_close は 読む/足す だけ（直す・消す は渡さない＝追記だけを倉庫で守る）★
grant select, insert                  on timeally.tc_close     to authenticated;

grant execute on function
  public.tc_auth(uuid,text),
  public.tc_pin_set(uuid,text),
  public.tc_verify(uuid,text),
  public.tc_punch_add(uuid,text,text,timestamptz,text,text),
  public.tc_punch_undo(uuid,text,text,uuid),
  public.tc_punch_ok(uuid,text,text,uuid,text),
  public.tc_punch_edit(uuid,text,text,uuid,timestamptz,text,text,text),
  public.tc_my_punches(uuid,text,text,date,date),
  public.tc_fix_request(uuid,text,text,date,int,int,text,uuid[],uuid[]),
  public.tc_pub_info(uuid,date)
to anon, authenticated;

-- ★社長の口は authenticated だけ★（2026-08-22）
--   ＝anon（従業員のリンク）に渡すと ★他人の打刻を触れる道★ができる。
--   tests/employee-screen.test.mjs が「anon に渡した物」を数えていて、
--   ★渡した瞬間に赤になった★（見張りが働いた）。
--   ★ただし grant を書くだけでは足りない★（2026-08-22 倉庫を実測して分かった）
--     ＝Postgres は 関数の実行権を ★既定で PUBLIC に渡す★。
--       だから「authenticated にだけ grant」しても、anon は PUBLIC 経由で呼べたままだった。
--     ⇒★先に PUBLIC から取り上げる★。（中の auth.uid() でも止まるが、
--       ★渡さない★のが本筋＝門を2つにしない）
--     ★さらに もう1つ★ … この倉庫は「これから作る関数は anon にも渡す」という
--       既定(default privileges)を持っている＝★新しい関数は 黙って anon 付きで生まれる★。
--       実測: revoke ... from public の後も proacl に ★anon=X★ が残っていた。
--     ⇒★anon から名指しで取り上げる★（PUBLIC と anon の2つを外して初めて 社長だけになる）
revoke execute on function
  public.tc_punch_edit_owner(text,uuid,timestamptz,text,text,text)
from public, anon;
grant execute on function
  public.tc_punch_edit_owner(text,uuid,timestamptz,text,text,text)
to authenticated;

-- ★引数を増やした前の形は 落とす★（残ると 古い形が呼べてしまい、締めの門が無い方が通る）
drop function if exists public.tc_pub_info(uuid);
-- ★2026-08-18 tc_fix_request に p_void_ids を足した★＝★前の8引数の形は落とす★
--   （残ると 古い形が呼べてしまい ★「使わない」を確かめない道★が生き続ける）
drop function if exists public.tc_fix_request(uuid,text,text,date,int,int,text,uuid[]);
-- ★2026-08-18 夜3 tc_punch_edit に p_kind を足した（足す道を1本にまとめた）★＝前の形は落とす
drop function if exists public.tc_punch_edit(uuid,text,text,uuid,timestamptz,text);
-- ★2026-08-21 tc_punch_edit に p_note を足した（人が書いた言葉を 機械の説明と分けて持つ）★
--   ＝前の7引数の形は落とす（残ると 古い形が呼べて ★note を持たない行が また増える★）
drop function if exists public.tc_punch_edit(uuid,text,text,uuid,timestamptz,text,text);

-- 初回コードの再発行（社長）はRLSで直接 update すればよい:
--   update tc_pub set init_code='ABCD1234', pw_hash=null, device_tokens='{}', fail_count=0, locked_until=null
--   where token='…';
