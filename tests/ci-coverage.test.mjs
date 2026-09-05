/* ci-coverage.test.mjs — ★CIに並んでいない検査が無いか★（Timeally）
 * =============================================================================
 * ★新しい tests/ は CI に登録するまで1本も走らない★
 *   前科: テストを足したのに CI に並べ忘れて、★「テストが緑」がその検査を1本も見ていない★
 *   状態になった。だから ★書いた物と 走らせている物を突き合わせる★。
 *
 * ここで見る物:
 *   ① tests/ の検査が すべて .github/workflows/ci.yml に名指しで並んでいる
 *   ② ★--self-test を持つ検査は --self-test も並んでいる★
 *      （わざと壊して赤になるかを確かめない見張りは、空振りしていても気づけない）
 *   ③ 門番(scripts/)も並んでいる
 *   ④ ★除外するなら 理由と 戻す条件を書く★（黙って外さない）
 *
 * 使い方: node tests/ci-coverage.test.mjs
 *         node tests/ci-coverage.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CI = path.join(ROOT, '.github/workflows/ci.yml');

/* ★CIから外す物は ここに 理由と 戻す条件を書く（黙って外さない）★
   ★ここに書いてよいのは「CIで走らせては いけない道具」だけ★＝見張りを ここに入れて 緑にしない。 */
export const EXCLUDED = {
  // 'tests/xxx.test.mjs': '理由 … 戻す条件 …',
  'scripts/apply-schema.mjs':
    '倉庫にSQLを当てる道具＝CIが走らせたら 倉庫を触る。戻す条件＝読むだけの --probe を CI用に分けた時。',
  'scripts/seed-test.mjs':
    '倉庫に 試し用のデータを入れる道具＝CIが走らせたら 倉庫を触る。戻す条件＝CI専用の空の倉庫を持った時。',
  'scripts/check-deployed.mjs':
    '実配信(Vercel)を26回 叩く道具＝押した後に人が走らせる物。戻す条件＝配信の後に走るCIを分けた時。',
  'scripts/mirror-to-prod.mjs':
    'テスト線から本番repoへ写す道具＝CIが走らせたら 勝手に本番が動く。戻す条件＝写す中身だけ見る --check を作った時。',
  'scripts/probe-close.mjs':
    '一度きりの調べ物（下見）＝答えは記録に残してある。戻す条件＝同じ事を毎回 見張りたくなった時。',
  'scripts/probe-unique.mjs':
    '一度きりの調べ物（下見）＝答えは記録に残してある。戻す条件＝同じ事を毎回 見張りたくなった時。',
  /* ★clock-travel は 2026-09-06 に 毎回のCIへ 載せました（--next-month の1日だけ・約147秒）★
     ＝重さを測ったら 4日付で 605秒。★次の月の1日 1つだけ★なら 147秒で、
       ★事故の前の状態で 実際に 捕まる★事を 確かめてから 載せています。
     ★残り3日付（年またぎ・うるう日・458秒）は 手で押す物のまま★（毎回 見る物ではない）。 */
  'scripts/fake-clock.cjs':
    'clock-travel が読み込む部品＝単体では走らない。戻す条件＝単体で走る形にした時。',
};

/* ★★「まだ 載せていない」見張り＝★保留★（道具とは 別に 数える）★★
   （2026-09-06 指示役の裁定＝★「正しい赤」でも 赤を 住まわせるな★
     ＝次に 誰かが 壊しても ★もう赤だから 気づかない★ から）
   ★道具（上の EXCLUDED）と 混ぜません★＝★いつか 載せる物★なので 別の組にして 毎回 数を出す。
   ★載せる順番は 決まっています（指示役の裁定C）★
     毎回のCI … proto-daily(17秒) ＋ align-check(20秒)  ← ★B が CIで 動いた事を 見てから★
     週1の回  … print-check(32秒) ＋ screen-check(63秒)  ← ★job に MEASURE_REQUIRED=1 を 1回だけ★
   ★どちらも ubuntu に ブラウザが 在るかを 先に 測る★（ci.yml の `_browser.mjs --where` の1行） */
export const HORYU = {
  /* ★proto-daily と align-check は 2026-09-06 に 毎回のCIへ 載せました（保留から 外れた）★
     ★print-check と screen-check は 下の「別の段の中で走る」へ 移しました（★保留 0本が 正しい姿★）★ */
};

/* ★★3つ目の状態＝「★別の段の 中で 毎回 走っている★」★★（2026-09-06 指示役の裁定）
   ＝直に 並んではいないが、`clock-travel --next-month` が ★通し53本を 丸ごと★ 走らせるので
     ★毎回 走っています★。⇒★「保留（まだ走っていない）」は もう 嘘★。
   ★危ない所★ … ★覆いが「別の段の おまけ」で 出来ている★
     ⇒ 誰かが `--next-month` を CI から外したら ★print/screen が 黙って 走らなくなる★のに
       ★保留だから 無くて当然★と この見張りが ★緑を出す★（＝「いつも緑」の 新しい顔）
   ⇒★頼っている段の名前を 書く★＋★その段が CIに在るかを 機械が見る（下の検査）★ */
export const NAKA_DE = {
  'scripts/print-check.mjs':
    'clock-travel(--next-month) の中で 通し53本として 毎回 走る。戻す条件＝--next-month を CIから外す時は 直に 並べる。',
  'scripts/screen-check.mjs':
    'clock-travel(--next-month) の中で 通し53本として 毎回 走る。戻す条件＝--next-month を CIから外す時は 直に 並べる。',
};
/* ★頼っている段は 名前で1か所に持つ★（理由の文を 読み解かない＝文を直すと 黙る形にしない） */
export const TAYORU = {
  'scripts/print-check.mjs': 'scripts/clock-travel.mjs',
  'scripts/screen-check.mjs': 'scripts/clock-travel.mjs',
};

/* 数える時は 合わせて見る（★理由と戻す条件の 見張りも 全部に 効かせる★） */
export const HAZUSHITA = { ...EXCLUDED, ...HORYU, ...NAKA_DE };

export function testFiles() {
  return fs.readdirSync(path.join(ROOT, 'tests'))
    .filter((f) => /\.test\.mjs$/.test(f) || f === 'ui-sweep.mjs')
    .map((f) => 'tests/' + f).sort();
}
/* ★scripts/ の中身も 数える★（2026-09-02 指示役の裁定・第1段）
   ＝ここを見ていなかったので ★見張りを CI から外しても 誰も 赤くしなかった★。
     手元 ✓859 に対し CI ✓781＝★ブラウザを使う見張り5本が CIで 走っていない★のに 緑だった。 */
export function scriptFiles() {
  return fs.readdirSync(path.join(ROOT, 'scripts'))
    .filter((f) => /\.(mjs|cjs)$/.test(f))
    .map((f) => 'scripts/' + f).sort();
}
export function guardFiles() {
  return ['scripts/sql-guard.mjs', 'scripts/stamp-build.mjs'];
}
export function hasSelfTest(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return /--self-test/.test(src) && /process\.argv\.includes\('--self-test'\)/.test(src);
}

/** ci.yml で 実際に走らせている node コマンドを拾う */
export function ranInCi(yml) {
  return (yml.match(/node\s+[^\s&|]+(\s+--self-test)?/g) || []).map((s) => s.replace(/\s+/g, ' ').trim());
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

if (process.argv.includes('--self-test')) {
  console.log('\n[ci-coverage --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  S('① CIから1本 抜いた作り物は 抜けを見つける', () => {
    const yml = fs.readFileSync(CI, 'utf8').replace(/node tests\/tc-law\.test\.mjs\b/g, 'node tests/nothing.mjs');
    const ran = ranInCi(yml);
    ok(!ran.includes('node tests/tc-law.test.mjs'), '作り物が抜けていない＝この検査が空振り');
    ok(ranInCi(fs.readFileSync(CI, 'utf8')).includes('node tests/tc-law.test.mjs'), '★本物のCIに並んでいない★');
  });
  S('② --self-test を持つ検査を 実際に数えている', () => {
    const n = testFiles().filter(hasSelfTest).length;
    ok(n >= 6, '--self-test を持つ検査が少なすぎる: ' + n);
  });
  /* ★足した見張りの自己確認（2026-09-02）★＝「scripts/ を見ている」が 空振りでない事を確かめる */
  S('③ scripts/ を 実際に読んでいる（0本なら 空振り）', () => {
    ok(scriptFiles().length >= 10, 'scripts/ を数えられていない: ' + scriptFiles().length);
  });
  S('④ CIに在る門番を 抜いた作り物は 「走っていない」に 増える', () => {
    const honmono = fs.readFileSync(CI, 'utf8');
    const kizu = honmono.replace(/node scripts\/sql-guard\.mjs/g, 'node scripts/nothing.mjs');
    const kazu = (yml) => {
      const r = ranInCi(yml);
      return scriptFiles().filter((f) => !HAZUSHITA[f] && !r.some((x) => x.indexOf('node ' + f) === 0)).length;
    };
    ok(kazu(kizu) === kazu(honmono) + 1, '抜いても 本数が増えない＝この見張りは 空振り');
  });
  /* ★覆いが 消えた時に 本当に 赤になるか★（2026-09-06・作り物で 確かめる） */
  S('⑥ 頼っている段を 抜いた作り物は 「別の段の中で走る」を 赤にする', () => {
    const kizu = fs.readFileSync(CI, 'utf8').replace(/node scripts\/clock-travel\.mjs/g, 'node scripts/nothing.mjs');
    const r = ranInCi(kizu);
    const kieta = Object.keys(NAKA_DE).filter((f) => !r.some((x) => x.indexOf('node ' + (TAYORU[f] || '')) === 0));
    ok(kieta.length === Object.keys(NAKA_DE).length,
      '段を抜いても 気づかない＝この検査は 空振り: ' + kieta.length);
    const honmono = ranInCi(fs.readFileSync(CI, 'utf8'));
    ok(Object.keys(NAKA_DE).every((f) => honmono.some((x) => x.indexOf('node ' + TAYORU[f]) === 0)),
      '★本物のCIに 頼っている段が 無い★');
  });
  S('⑤ 理由つきで外した物は 数に入れない（EXCLUDED が効いている）', () => {
    const f = Object.keys(HAZUSHITA).find((k) => k.indexOf('scripts/') === 0);
    ok(f && !scriptFiles().filter((x) => !HAZUSHITA[x]).includes(f), '外した組が効いていない: ' + f);
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[CIに並んでいるか]');

T('★ci.yml が実在する（無ければ1本も走らない）', () => {
  ok(fs.existsSync(CI), '.github/workflows/ci.yml が無い');
});

const yml = fs.readFileSync(CI, 'utf8');
const ran = ranInCi(yml);

T('★tests/ の検査が すべて CI に並んでいる', () => {
  const miss = testFiles().filter((f) => !HAZUSHITA[f] && !ran.includes('node ' + f));
  ok(miss.length === 0, 'CIに並んでいない: ' + miss.join(', '));
  console.log('     実測: 検査 ' + testFiles().length + '本すべてが CI に在る');
});

T('★--self-test を持つ検査は --self-test も CI に並んでいる（空振りを見張る）', () => {
  const need = testFiles().filter((f) => !HAZUSHITA[f] && hasSelfTest(f));
  const miss = need.filter((f) => !ran.includes('node ' + f + ' --self-test'));
  ok(miss.length === 0, '自己確認がCIに無い: ' + miss.join(', '));
  console.log('     実測: 自己確認つき ' + need.length + '本すべてが CI に在る');
});

T('★scripts/ の見張りも CI に並んでいる（外すなら 理由を書く）', () => {
  const inCi = (f) => ran.some((r) => r.indexOf('node ' + f) === 0);
  const all = scriptFiles();
  const nokoshi = all.filter((f) => !HAZUSHITA[f] && !inCi(f));
  console.log('     実測: scripts/ ' + all.length + '本 … CI在り ' + all.filter(inCi).length
    + '本／★別の段の中で ' + all.filter((f) => NAKA_DE[f]).length
    + '本★／道具として外した ' + all.filter((f) => EXCLUDED[f]).length
    + '本／★保留（いつか載せる）★ ' + all.filter((f) => HORYU[f]).length
    + '本／★書いていない（赤）★ ' + nokoshi.length + '本');
  /* ★保留も 別の段の中の物も 黙って消さない★＝毎回 名前と 戻す条件を 出す */
  for (const f of all.filter((f) => NAKA_DE[f])) console.log('       ★別の段の中★ ' + f + ' … ' + NAKA_DE[f]);
  for (const f of all.filter((f) => HORYU[f])) console.log('       ★保留★ ' + f + ' … ' + HORYU[f]);
  for (const f of nokoshi) console.log('       ★CIで走っていない（書いていない）★ ' + f);
  /* ★黙って外すのは 駄目・赤を住まわせるのも 駄目★（2026-09-06 指示役）
     ★直し方は3つ★ … ①CIに並べる ②道具なら EXCLUDED ③いつか載せる物なら HORYU（戻す条件つき） */
  ok(nokoshi.length === 0,
    '★理由も戻す条件も書いていない★ ' + nokoshi.length + '本: ' + nokoshi.join(', '));
});

/* ★覆いが「別の段の おまけ」で 出来ている所を 機械で 止める★（2026-09-06）
   ＝`--next-month` を CI から外したら ★print/screen が 黙って 走らなくなる★。
     ★理由の文を 読み解かず★、頼っている段の ★名前★（TAYORU）で 見る。
   ★新しい見張りは 作っていません★＝この検査の中の 1つです。 */
T('★「別の段の中で走る」物は その段が CI に在る（覆いが消えたら 赤）', () => {
  const inCi = (f) => ran.some((r) => r.indexOf('node ' + f) === 0);
  const kieta = Object.keys(NAKA_DE).filter((f) => !inCi(TAYORU[f] || ''));
  ok(kieta.length === 0, '頼っている段が CI に無い: '
    + kieta.map((f) => f + ' → ' + (TAYORU[f] || '（どの段か 書いていない）')).join(', '));
  const kaite = Object.keys(NAKA_DE).filter((f) => !TAYORU[f]);
  ok(kaite.length === 0, 'どの段に頼っているか 書いていない: ' + kaite.join(', '));
  if (Object.keys(NAKA_DE).length) {
    console.log('     実測: 頼っている段 ' + [...new Set(Object.values(TAYORU))].join('／') + ' … CI に在る');
  }
});

T('★門番(scripts/)も CI に並んでいる', () => {
  const miss = guardFiles().filter((f) => !ran.some((r) => r.indexOf('node ' + f) === 0));
  ok(miss.length === 0, 'CIに並んでいない門番: ' + miss.join(', '));
});

T('★除外するなら 理由と戻す条件が書いてある（黙って外さない）', () => {
  for (const [f, why] of Object.entries(HAZUSHITA)) {
    ok(why && why.length >= 20, f + ': 理由が短すぎる');
    ok(/戻す条件|戻す/.test(why), f + ': 戻す条件が書いていない');
  }
});

T('★CIが Node の版を決めている（手元とCIで「落ちず走らない」を作らない）', () => {
  ok(/node-version:\s*['"]?20/.test(yml), 'ci.yml が Node 20 を指していない');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  ok(/>=\s*20/.test((pkg.engines || {}).node || ''), 'package.json の engines が 20 と合っていない');
});

T('★依存を「使う前」に入れている（jsdom が無いと SKIP になり、SKIPを緑と呼ばない作りが赤になる）', () => {
  const install = yml.indexOf('npm install');
  const firstTest = yml.indexOf('node tests/');
  ok(install >= 0 && install < firstTest, 'npm install がテストより後（またはない）');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
