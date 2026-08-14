/* sql-guard.mjs — ★倉庫に当てる前の門番★（Timeally）
 * =============================================================================
 * ★1本でも門番に落ちたら 1文字も当てない★（部分適用は「手元は緑・倉庫は半端」を作る）
 *
 * 止めたい事故:
 *   ① ★消す系（drop table / drop schema / truncate / drop column）が混ざる★
 *      … 出勤簿は法定三帳簿。★行を消す道を作らない★のがこのアプリの前提。
 *   ② ★別のアプリの部屋（kyuyo / daikome / castally / amakase / daikou / exally）に当たる★
 *      … 倉庫は共用。名前を1つ間違えると他社の棚を触る。
 *   ③ ★窓口(view)の security_invoker が抜ける★
 *      … 抜けると窓の持ち主(postgres)の権利で開き ★全社のデータが見える★。
 *        `create or replace view` は security_invoker を落とすので、後ろの alter も見る。
 *   ④ ★関数の外に DML（update / delete / insert）が裸で置かれる★
 *      … 設計図に「データを書き換える1行」を紛れ込ませない。
 *        関数の中身（$$ … $$）は仕事そのものなので対象外。
 *
 * 使い方: node scripts/sql-guard.mjs supabase/schema.sql
 *         node scripts/sql-guard.mjs --self-test   ★わざと危ない物を食わせて止まるか★
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ★直に叩かれた時だけ動く★
   （apply-schema.mjs から check() だけ借りる時に、CLIの本体まで走らせない。
     ここを付け忘れると「使い方: …」と出て 当てる道具が黙って exit 2 で止まる＝実際に踏んだ） */
const DIRECT = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

/* ★このアプリが触ってよい部屋★。ここに無い名前が出たら中止。 */
export const ALLOWED_SCHEMAS = ['timeally', 'public', 'extensions'];
/* 他のアプリの部屋（見つけたら即中止。名前を挙げておくと事故が読める） */
export const FOREIGN_SCHEMAS = ['kyuyo', 'daikome', 'castally', 'amakase', 'daikou', 'exally', 'seikyu'];
/* 触ってよい棚の頭 */
export const TABLE_PREFIX = 'tc_';

/** コメントを落とす（-- と /* *\/）。文字列リテラルは残す。 */
export function stripComments(sql) {
  return String(sql || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ');
}

/** $$ … $$ で囲まれた関数の中身を取り出し、外側だけを返す。 */
export function splitBodies(sql) {
  const bodies = [];
  const outer = String(sql).replace(/\$\$[\s\S]*?\$\$/g, (m) => {
    bodies.push(m);
    return ' $BODY$ ';
  });
  return { outer, bodies };
}

/** 違反を返す（純関数＝self-test で作り物を通せる）。 */
export function check(sql) {
  const bad = [];
  const clean = stripComments(sql);
  const { outer, bodies } = splitBodies(clean);
  const flat = outer.replace(/\s+/g, ' ').toLowerCase();

  /* ① 消す系 — ★policy と function の drop だけは許す（作り直しに要る）★ */
  const drops = flat.match(/\bdrop\s+(\w+)/g) || [];
  for (const d of drops) {
    const what = d.split(/\s+/)[1];
    if (what !== 'policy' && what !== 'function') bad.push(`消す系が混ざっている: ${d}`);
  }
  if (/\btruncate\b/.test(flat)) bad.push('truncate が混ざっている');
  if (/\balter\s+table\b[^;]*\bdrop\b/.test(flat)) bad.push('alter table … drop（列を落とす）が混ざっている');

  /* ② 別のアプリの部屋 */
  for (const s of FOREIGN_SCHEMAS) {
    if (new RegExp('\\b' + s + '\\.', 'i').test(flat)) bad.push(`他のアプリの部屋に当たっている: ${s}.`);
  }
  /* 出てきた schema.table の schema を全部数える（auth.users の参照だけ別に許す） */
  const qualified = flat.match(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)/g) || [];
  for (const q of qualified) {
    const [sch, obj] = q.split('.');
    if (sch === 'auth') { if (obj !== 'users' && obj !== 'uid') bad.push(`auth の想定外を触っている: ${q}`); continue; }
    if (!ALLOWED_SCHEMAS.includes(sch)) continue;   // 変数名などの誤検知は落とす（部屋は上で数えた）
    if (sch === 'timeally' && !obj.startsWith(TABLE_PREFIX)) bad.push(`部屋の中の想定外の名前: ${q}`);
  }

  /* ③ 窓口の security_invoker */
  const views = [...clean.matchAll(/create\s+or\s+replace\s+view\s+(public\.[a-z_0-9]+)([\s\S]*?)\bas\b/gi)];
  if (!views.length && /create\s+or\s+replace\s+view/i.test(clean)) bad.push('窓口の書き方が読めない（public. を付けること）');
  for (const v of views) {
    const name = v[1];
    const hasInline = /security_invoker\s*=\s*true/i.test(v[2]);
    const hasAlter = new RegExp('alter\\s+view\\s+' + name.replace('.', '\\.') + '\\s+set\\s*\\(\\s*security_invoker\\s*=\\s*true', 'i').test(clean);
    if (!hasInline || !hasAlter) {
      bad.push(`窓口 ${name} の security_invoker=true が足りない（with と alter の両方が要る）`);
    }
  }

  /* ④ 関数の外の裸のDML */
  if (/\b(delete\s+from|update\s+[a-z_0-9.]+\s+set|insert\s+into)\b/.test(flat)) {
    bad.push('関数の外に データを書き換える1行がある');
  }
  /* 関数の中身は仕事なので通すが、★他の部屋を触っていないか★だけは同じ目で見る */
  for (const b of bodies) {
    for (const s of FOREIGN_SCHEMAS) {
      if (new RegExp('\\b' + s + '\\.', 'i').test(b)) bad.push(`関数の中で他の部屋を触っている: ${s}.`);
    }
    if (/\bdrop\s+table\b|\btruncate\b/i.test(b)) bad.push('関数の中に 消す系がある');
  }
  return bad;
}

/* ── self-test：わざと危ない物を食わせて止まるか ───────────────────── */
if (DIRECT && process.argv.includes('--self-test')) {
  const OK = `create schema if not exists timeally;
create table if not exists timeally.tc_x(id uuid primary key);
create or replace view public.tc_x with (security_invoker = true) as select * from timeally.tc_x;
alter view public.tc_x set (security_invoker = true);
create or replace function public.tc_f() returns void language plpgsql as $$
begin update timeally.tc_x set id=id; end $$;`;
  let p = 0, f = 0;
  const T = (n, fn) => { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  const must = (sql, why) => { const b = check(sql); if (!b.length) throw new Error('止まらなかった: ' + why); };
  const pass = (sql) => { const b = check(sql); if (b.length) throw new Error('誤検知: ' + b.join(' / ')); };

  console.log('\n[sql-guard --self-test] わざと危ない物を食わせて止まるか');
  T('★正しい設計図は通る（誤検知が出ない）', () => pass(OK));
  T('drop table を混ぜたら止まる', () => must(OK + '\ndrop table timeally.tc_x;', 'drop table'));
  T('truncate を混ぜたら止まる', () => must(OK + '\ntruncate timeally.tc_x;', 'truncate'));
  T('alter table … drop column を混ぜたら止まる', () => must(OK + '\nalter table timeally.tc_x drop column id;', 'drop column'));
  T('★他のアプリの部屋に当てたら止まる', () => must(OK + '\nselect * from kyuyo.pay_employees;', '他の部屋'));
  T('★窓口の security_invoker が抜けたら止まる（with が無い）', () =>
    must('create table if not exists timeally.tc_y(id uuid);\ncreate or replace view public.tc_y as select * from timeally.tc_y;\nalter view public.tc_y set (security_invoker = true);', 'with 抜け'));
  T('★窓口の alter が抜けたら止まる（create or replace が落とすため）', () =>
    must('create table if not exists timeally.tc_y(id uuid);\ncreate or replace view public.tc_y with (security_invoker = true) as select * from timeally.tc_y;', 'alter 抜け'));
  T('関数の外の update は止まる', () => must(OK + '\nupdate timeally.tc_x set id = null;', '裸のDML'));
  T('関数の中の update は通る（仕事そのもの）', () => pass(OK));
  T('関数の中で他の部屋を触ったら止まる', () =>
    must(OK.replace('update timeally.tc_x set id=id;', 'update daikome.dk_companies set id=id;'), '関数の中の他部屋'));
  T('★部屋の中の tc_ 以外の名前は止まる', () => must('create table timeally.zz_other(id uuid);', 'tc_ 以外'));
  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(f ? 1 : 0);
}

/* ── 本体 ─────────────────────────────────────────────────────────── */
if (DIRECT) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!files.length) {
    console.log('使い方: node scripts/sql-guard.mjs supabase/schema.sql');
    process.exit(2);
  }
  let ng = 0;
  for (const f of files) {
    const bad = check(fs.readFileSync(f, 'utf8'));
    if (bad.length) { ng++; console.log('✗ ' + f); bad.forEach((b) => console.log('   - ' + b)); }
    else console.log('✓ ' + f);
  }
  console.log(ng ? `\n★中止★ ${ng}本が門番に落ちました（1文字も当てません）` : '\n門番: 全部 通りました');
  process.exit(ng ? 1 : 0);
}
