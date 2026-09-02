/* _browser.mjs — ★ブラウザの探し方は ここ1か所★（Timeally）
 * =============================================================================
 * ★なぜ 1か所にするか（2026-09-02 指示役の裁定B・条件②）★
 *   同じ探し方を 4本（screen-check／print-check／align-check／proto-daily）に 4回 書いていた。
 *   ★写しを増やすと 写し忘れで 事故る★。だから ★探し方は この1本だけ★にする。
 *
 * ★なぜ Linux を足すか（条件①）★
 *   4本とも ★chrome.exe / msedge.exe の道しか書いていなかった★＝ubuntu の CI では
 *   ★載せた瞬間に「ブラウザが見つかりません」で 赤★になる。★重さ以前に 載らない★状態だった。
 *   ★Windows の道は 消さない★＝司さんのパソコンで 回すのが 本番の使い方。
 *
 * ★見つからない時の出し方（条件③）★
 *   ・★生の例外で落とさない★＝人の言葉で「★未測定★ … ブラウザが 見つかりません」と言ってから 終わる
 *   ・★終わり値は 場所で 分ける★
 *       MEASURE_REQUIRED=1（★週1の専用の回★）… ★赤（1）★＝そこは 必ず 測る場所
 *       それ以外（手元・毎回のCI）        … ★未測定（0）★＝ただし ★声は 必ず 出す★
 *     ※★「緑」ではなく「未測定」と 言う★。数える人が 緑と 読み違えない為。
 *
 * 使い方:
 *   import { needBrowser } from './_browser.mjs';
 *   const chrome = needBrowser('画面を測る');   // 見つからなければ ここで 終わる
 *   node scripts/_browser.mjs --self-test      // わざと 見つからない状態を 作って 出方を数える
 */
import fs from 'node:fs';
import path from 'node:path';

/** ★探す先（Windows → Linux の順）★
 *  ★環境変数が 一番強い★＝借り物の置き場を 人が決められる様に（CHROME_PATH）。 */
export function candidates(env = process.env) {
  return [
    env.CHROME_PATH,
    env.PUPPETEER_EXECUTABLE_PATH,
    /* Windows（★消さない★） */
    path.join(env['ProgramFiles'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(env['ProgramFiles(x86)'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(env['LOCALAPPDATA'] || '', 'Google/Chrome/Application/chrome.exe'),
    path.join(env['ProgramFiles'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    path.join(env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    /* Linux（2026-09-02 に足した＝CI は ubuntu） */
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ].filter((p) => p && p.length > 0);
}

/** 見つかれば その道／無ければ null（★投げない★＝出し方は呼ぶ側で1つに揃える） */
export function findBrowser({ env = process.env, exists = fs.existsSync } = {}) {
  for (const p of candidates(env)) if (exists(p)) return p;
  return null;
}

/** ★見つからない時の出し方を 1つに揃える★（呼ぶ側は これだけ使う） */
export function needBrowser(nanno, { env = process.env, exists = fs.existsSync, quit = process.exit } = {}) {
  const found = findBrowser({ env, exists });
  if (found) return found;
  const kanarazu = env.MEASURE_REQUIRED === '1';
  console.log('\n★未測定★ … ' + nanno + ' には ブラウザが 要りますが 見つかりません');
  console.log('  探した先 … ' + candidates(env).length + 'か所（Windows の chrome/edge ＋ Linux の chrome/chromium）');
  console.log('  入れるか、道を教えてください … ★CHROME_PATH=/…/chrome★');
  if (kanarazu) {
    console.log('  ★ここは 必ず 測る場所です（MEASURE_REQUIRED=1）＝★赤★にします');
    return quit(1);
  }
  console.log('  ★ここは 未測定のまま 進みます（赤にはしません）★＝★緑ではなく「未測定」です★');
  return quit(0);
}

/* ───────── ★どの道を 選んだかを 1行で 言う★（2026-09-02 指示役の求め） ─────────
   ＝★Linux の道を 足した所が CI（ubuntu）で 本当に 効いたか★は、
     ★作り物の自己確認では 分かりません★（そこは わざと 作った状態を 測っています）。
   ⇒★本物の機械の上で「今 何を 選んだか」を 見る★。★数えず・止めず・1行 言うだけ★（終わり値は 0）。 */
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/_browser.mjs')
  && process.argv.includes('--where')) {
  const got = findBrowser();
  console.log('この機械が 選んだ道 … ' + (got || '★未測定（見つかりません）★')
    + '（' + process.platform + '／探した先 ' + candidates().length + 'か所）');
  process.exit(0);
}

/* ───────── わざと 見つからない状態を 作って 出方を数える（条件④） ───────── */
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/_browser.mjs')
  && process.argv.includes('--self-test')) {
  console.log('\n[_browser --self-test] ★3通り（Windowsのみ／Linuxのみ／どちらも無し）★');
  let p = 0, f = 0;
  const T = (n, fn) => { try { fn(); p++; console.log('  ✓ ' + n); } catch (e) { f++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };
  const WIN = { ProgramFiles: 'C:/Program Files' };
  /* ★道の区切りは OS が決める★＝手で書くと Windows で「\」になって 当たらない（実際に外した） */
  const winPath = path.join('C:/Program Files', 'Google/Chrome/Application/chrome.exe');

  T('① Windows だけ 在る … Windows の道を 選ぶ', () => {
    const got = findBrowser({ env: WIN, exists: (x) => x === winPath });
    ok(got === winPath, '選んだ物が違う: ' + got);
  });
  T('② Linux だけ 在る … Linux の道を 選ぶ（★ここが 今まで 無かった★）', () => {
    const got = findBrowser({ env: {}, exists: (x) => x === '/usr/bin/google-chrome' });
    ok(got === '/usr/bin/google-chrome', '選んだ物が違う: ' + got);
  });
  T('③ どちらも 無い … null（★投げない★）', () => {
    ok(findBrowser({ env: {}, exists: () => false }) === null, 'null ではない');
  });
  T('④ どちらも無い＋★必ず測る場所★（MEASURE_REQUIRED=1）… ★赤(1)★', () => {
    let code = null;
    needBrowser('試し', { env: { MEASURE_REQUIRED: '1' }, exists: () => false, quit: (c) => { code = c; } });
    ok(code === 1, '終わり値が 1 ではない: ' + code);
  });
  T('⑤ どちらも無い＋それ以外の場所 … ★未測定(0)・ただし 声は 出す★', () => {
    let code = null; const koe = [];
    const log = console.log; console.log = (...a) => koe.push(a.join(' '));
    needBrowser('試し', { env: {}, exists: () => false, quit: (c) => { code = c; } });
    console.log = log;
    ok(code === 0, '終わり値が 0 ではない: ' + code);
    ok(koe.some((l) => l.indexOf('未測定') >= 0), '「未測定」と 言っていない');
    ok(!koe.some((l) => /★緑★/.test(l)), '緑と 言ってしまっている');
  });
  /* ★名前は 1つだけ（2026-09-02 指示役の裁定）★
     ＝Rakunally が `MEASURE_REQUIRED` を使っており、★同じ考えに 名前が2つ 残ると
       片方だけ 直して 気づかない事故になる★。★古い名前は わざと 効かないままにする★。 */
  T('⑦ ★古い名前（BROWSER_REQUIRED）は 効かない★＝名前は MEASURE_REQUIRED の1つだけ', () => {
    let code = null;
    needBrowser('試し', { env: { BROWSER_REQUIRED: '1' }, exists: () => false, quit: (c) => { code = c; } });
    ok(code === 0, '古い名前が まだ 効いている（2つの名前が 残っている）: ' + code);
  });
  T('⑥ 探し先に Windows と Linux が 両方 在る（★片方を 消していない★）', () => {
    const c = candidates({ ProgramFiles: 'C:/Program Files' });
    ok(c.some((x) => /chrome\.exe$/.test(x)), 'Windows の道が 無い');
    ok(c.some((x) => x.indexOf('/usr/bin/') === 0), 'Linux の道が 無い');
  });

  console.log('\n' + p + ' passed, ' + f + ' failed');
  process.exit(f ? 1 : 0);
}
