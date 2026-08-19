/* employee-screen.test.mjs — ★従業員の画面に「数えた結果」を1つも出さない★（Timeally）
 * =============================================================================
 * ★決まり（司さん・2026-08-14）★
 *   従業員の画面は「打つだけ」。
 *   ・丸めの説明文も出さない
 *   ・数えた結果（働いた長さ・追加ぶん・夜の分・お金・法律の話）を ★一切 出さない★
 *   ・出すのは ★自分が打った1分単位の生の時刻★だけ
 *   ＝ ★従業員は嘘の数字を一度も見ない★
 *   ・数えた記録は 社長側と帳簿にだけ置く（★記録は必ず残す★）
 *
 * ★3重で守る★
 *   ① 画面の言葉を数える（見える文字＝コメントは除く）
 *   ② 従業員の画面が ★数える道具を1本も読み込んでいない★（読めば いつか出せてしまう）
 *   ③ 倉庫のRPCが ★時刻しか返さない★（画面を作り直しても漏れない・いちばん強い）
 *
 * 使い方: node tests/employee-screen.test.mjs
 *         node tests/employee-screen.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★従業員の画面（と、そこが読む物）★
   ★lib/tc-clean.js を足した（2026-08-18）★＝従業員の画面が読む物が1本 増えたので、
   ★出す文も 同じ目で数える★（この1本は ★長さを1つも数えない★のが約束）。 */
export const EMP_FILES = ['punch.html', 'kiroku.html', 'js/emp-app.js', 'lib/tc-clean.js',
  /* ★2026-08-19 lib/tc-yukyu.js を足した★＝「有給の残り」を1行 出すために読む。
     ★この1本は 日数しか数えない★（率・丸め・割増・金額の言葉が1つも無い）ので
     従業員の画面から読み込んでよい。★tc-law.js は今までどおり 読ませない★（②が見張る）。 */
  'lib/tc-yukyu.js'];

/* ★出してはいけない言葉★（「数えた結果」と「法律の話」）
   ここに無い言い換えが増えたら足す。足す時は ★実物の画面を見てから★。 */
export const BANNED = [
  '実労働', '労働時間', '総労働', '拘束時間',
  '残業', '時間外', '所定内', '所定超', '所定労働',
  '深夜', '休日労働', '割増', '法定',
  '丸め', '切り捨て', '切上', '切り上げ', '端数',
  '金額', '時給', '賃金', '給与', '手当',
  '労基', '協定', '労働基準',
  '有給', '年休', '欠勤', '遅刻', '早退',
  '集計', '合計時間', '月計',
];

/** ★見える文字だけ★ を残す（コメントは画面に出ないので落とす） */
export function visibleText(src, isHtml) {
  let t = String(src);
  if (isHtml) t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  t = t.replace(/\/\*[\s\S]*?\*\//g, ' ');
  t = t.replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
  return t;
}

/* ★たった1つだけ 出してよい言い方★（指示役 2026-08-19 ⑤「従業員の画面に『残り◯日』を出すだけ」）
   ＝★「有給の残り」という並びだけ★を先に取り除いてから数える。
     ★これ以外の「有給」は 今までどおり赤★（「有給を申請」「有給 8時間」などは通らない）。
     ★言い方を増やす時は ここに足す＝勝手に増えない★ */
export const ALLOWED_PHRASES = ['有給の残り'];

export function bannedIn(text) {
  var t = String(text);
  ALLOWED_PHRASES.forEach((ph) => { t = t.split(ph).join(''); });
  return BANNED.filter((w) => t.indexOf(w) >= 0);
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

if (process.argv.includes('--self-test')) {
  console.log('\n[employee-screen --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('① 「今日の実労働は8時間です」を混ぜたら捕まえる', () => {
    ok(bannedIn('<div>今日の実労働は8時間です</div>').length > 0, '捕まえられない＝この検査が空振り');
  });
  S('② 「この会社は30分単位で切り捨てます」も捕まえる（★丸めの説明文も出さない★）', () => {
    ok(bannedIn('この会社は30分単位で切り捨てます').length > 0, '捕まえられない');
  });
  S('③ コメントの中は見ない（画面に出ないので）', () => {
    ok(bannedIn(visibleText('/* 実労働は社長側にだけ出す */ <b>おつかれさま</b>', false)).length === 0,
      'コメントを拾っている＝説明が書けなくなる');
    ok(bannedIn(visibleText('<!-- 残業 --><b>x</b>', true)).length === 0, 'HTMLコメントを拾っている');
  });
  S('④ 「有給の残り 3日」だけは通す／それ以外の「有給」は捕まえる', () => {
    ok(bannedIn('有給の残り 3日').length === 0, '★出してよい1つの言い方まで赤にしている★');
    ok(bannedIn('有給を申請する').length > 0, '★「有給を申請」まで通している＝穴★');
    ok(bannedIn('有給 8時間').length > 0, '★「有給 8時間」まで通している＝穴★');
    ok(bannedIn('残りの有給は 3日です').length > 0, '★並びが違う言い方まで通している★');
  });
  S('⑤ ふつうの打刻の言葉は捕まえない（誤検知が出ない）', () => {
    ok(bannedIn('出勤 退勤 休憩に入る 休憩から戻る 私用で外出 外出から戻る').length === 0,
      '誤検知: ' + bannedIn('出勤 退勤 休憩に入る 休憩から戻る 私用で外出 外出から戻る').join(','));
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[従業員の画面] 数えた結果が1つも出ていないか');

T('★検査する画面が実在する（空振りしていない）', () => {
  EMP_FILES.forEach((f) => ok(fs.existsSync(path.join(ROOT, f)), f + ' が無い'));
  console.log('     実測: ' + EMP_FILES.length + '本を見る（' + EMP_FILES.join(' / ') + '）');
});

T('★従業員の画面に「数えた結果」の言葉が1つも無い', () => {
  const bad = [];
  EMP_FILES.forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const words = bannedIn(visibleText(src, /\.html$/.test(f)));
    words.forEach((w) => bad.push(f + ' → 「' + w + '」'));
  });
  ok(bad.length === 0, '出てはいけない言葉:\n   - ' + bad.join('\n   - '));
  console.log('     実測: 見張っている言葉 ' + BANNED.length + '語 / 見つかった 0件');
});

T('★従業員の画面が「数える道具」を1本も読み込んでいない', () => {
  const tools = ['tc-calc.js', 'tc-csv.js', 'tc-law.js', 'xlsx.full.min.js'];
  const bad = [];
  ['punch.html', 'kiroku.html'].forEach((f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    tools.forEach((t) => { if (src.indexOf(t) >= 0) bad.push(f + ' → ' + t); });
  });
  ok(bad.length === 0, '数える道具を読んでいる: ' + bad.join(', '));
});

T('★倉庫のRPCが 時刻しか返さない（画面を作り直しても漏れない）', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
  const m = /create or replace function public\.tc_my_punches[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql);
  ok(m, 'tc_my_punches が読めない');
  const body = m[1];
  const keys = (body.match(/'([a-z_]+)',\s*[a-z_(]/g) || []).map((s) => s.split("'")[1]);
  /* 2026-08-18 ★ok_types★ を足した＝「この時刻で合っている」と答えた印（時刻の話・数えた結果ではない） */
  const allowed = new Set(['id', 'at', 'kind', 'src', 'pending', 'ok_types', 'punches', 'name', 'unauth']);
  const extra = keys.filter((k) => !allowed.has(k));
  ok(extra.length === 0, '★時刻以外を返している: ' + extra.join(', ') + '★');
  /* 数える言葉がSQLの返り値に混ざっていないか（min / total などの名前も見る） */
  ok(!/work_min|ot_min|night_min|holiday_min|amount|yen/i.test(body), '★数えた結果を返している★');
});

/* ★2026-08-19 有給の残りを出すために tc_pub_info が返す物が増えた★
   ＝★返してよいのは「元の事実」だけ★（入社日／有給にした日の一覧）。
     ★残り日数・付与日数を倉庫で数えて返さない★（数えるのは lib/tc-yukyu.js の1本きり）。 */
T('★tc_pub_info は「元の事実」しか返さない（残り日数を倉庫で数えない）', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
  const m = /create or replace function public\.tc_pub_info[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql);
  ok(m, 'tc_pub_info が読めない');
  const body = m[1];
  const keys = (body.match(/'([a-z_0-9]+)',\s*[a-z_(]/g) || []).map((s) => s.split("'")[1]);
  const allowed = new Set(['found', 'company', 'name', 'state', 'ym', 'day_std_min',
    'notice', 'hire_date', 'yukyu_days']);
  const extra = keys.filter((k) => !allowed.has(k));
  ok(extra.length === 0, '★想定外の物を返している: ' + extra.join(', ') + '★');
  ok(!/left|grant|carry|_min|amount|yen/i.test(body.replace(/day_std_min/g, '')),
    '★数えた結果を倉庫で作って返している★');
  console.log('     実測: tc_pub_info が返す物 ' + keys.length + '個（' + keys.join(' / ') + '）');
});

T('★従業員が触れるRPCの一覧に「数える物」が無い（anon に渡している物を数える）', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
  const m = /grant execute on function([\s\S]*?)to anon/.exec(sql);
  ok(m, 'anon への grant が読めない');
  const names = (m[1].match(/public\.(tc_[a-z_]+)/g) || []).map((s) => s.split('.')[1]);
  /* 2026-08-15 tc_set_password → ★tc_pin_set★（初回コードを無くし 秘密は暗証番号1つに） */
  /* 2026-08-18 ★tc_punch_undo★（打った直後60秒だけ 自分で取り消す）を足した。
     ★返すのは ok / 断った理由だけ★＝数えた結果は1つも返さない。 */
  /* 2026-08-18（夜2）★tc_punch_edit★＝自分で直す道。★返すのは ok / 断った理由だけ★ */
  const allowed = ['tc_auth', 'tc_pin_set', 'tc_verify', 'tc_punch_add', 'tc_punch_undo',
    'tc_punch_ok', 'tc_punch_edit', 'tc_my_punches', 'tc_fix_request', 'tc_pub_info'];
  const extra = names.filter((n) => allowed.indexOf(n) < 0);
  ok(extra.length === 0, '想定外のRPCを従業員に渡している: ' + extra.join(', '));
  console.log('     実測: 従業員が呼べるRPC ' + names.length + '本（' + names.join(' / ') + '）');
});

/* ★2026-08-18 夜3 司さん「シンプルイズベストでやらして」★
   ＝★決まりは1つ（自分の打刻は自分で直せる・消せる。締めた後はできない）★。
   ★お願い・承認・申請は 画面から消した★ が、★跡は必ず中で残す★。 */
T('★直す・消す・足す は その場で入る／★跡は必ず残る★（画面に「お願い/承認」の言葉が0件）', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');
  const m = /create or replace function public\.tc_punch_edit[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql);
  ok(m, 'tc_punch_edit が読めない');
  const body = m[1];
  /* ★元の行は消さない（印だけ）★／★跡を tc_fix に残す★／★締めた月は断る★ */
  ok(/set voided_at = now\(\)/.test(body), '★元の行に印を付けていない★');
  ok(!/delete\s+from/i.test(body), '★消している★');
  ok(/insert into timeally\.tc_fix/.test(body), '★跡を残していない★');
  ok(/if v_st = 'closed' then return/.test(body), '★締めた月を断っていない★');
  /* ★画面の言葉★ … 人が覚えるのは「直す・消す・足す」だけ */
  const words = ['お願い', '承認', '申請', '会社に出す'];
  const bad = [];
  /* ★社長の画面も数える★（2026-08-18 指示役が実配信で見つけた＝
     従業員は もうお願いを出さないのに、社長の画面に「お願い」「承認」の箱が残っていた） */
  ['kiroku.html', 'punch.html', 'js/emp-app.js', 'lib/tc-clean.js',
    'index.html', 'shukei.html', 'login.html', 'js/owner-app.js'].forEach((f) => {
    const t = visibleText(fs.readFileSync(path.join(ROOT, f), 'utf8'), /\.html$/.test(f));
    words.forEach((w) => { if (t.indexOf(w) >= 0) bad.push(f + ' → 「' + w + '」'); });
  });
  ok(bad.length === 0, '★画面に残っている言葉: ' + bad.join(' / ') + '★');
  console.log('     実測: 「お願い/承認/申請/会社に出す」 0件（従業員4本＋社長4本）／跡は tc_fix に残す');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
