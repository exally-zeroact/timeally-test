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
  'scripts/clock-travel.mjs':
    '時計を進めて 他の見張りを丸ごと 走らせ直す道具（重い）。戻す条件＝重さを測って 指示役が載せると決めた時。',
  'scripts/fake-clock.cjs':
    'clock-travel が読み込む部品＝単体では走らない。戻す条件＝単体で走る形にした時。',
};

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
      return scriptFiles().filter((f) => !EXCLUDED[f] && !r.some((x) => x.indexOf('node ' + f) === 0)).length;
    };
    ok(kazu(kizu) === kazu(honmono) + 1, '抜いても 本数が増えない＝この見張りは 空振り');
  });
  S('⑤ 理由つきで外した物は 数に入れない（EXCLUDED が効いている）', () => {
    const f = Object.keys(EXCLUDED).find((k) => k.indexOf('scripts/') === 0);
    ok(f && !scriptFiles().filter((x) => !EXCLUDED[x]).includes(f), 'EXCLUDED が効いていない: ' + f);
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
  const miss = testFiles().filter((f) => !EXCLUDED[f] && !ran.includes('node ' + f));
  ok(miss.length === 0, 'CIに並んでいない: ' + miss.join(', '));
  console.log('     実測: 検査 ' + testFiles().length + '本すべてが CI に在る');
});

T('★--self-test を持つ検査は --self-test も CI に並んでいる（空振りを見張る）', () => {
  const need = testFiles().filter((f) => !EXCLUDED[f] && hasSelfTest(f));
  const miss = need.filter((f) => !ran.includes('node ' + f + ' --self-test'));
  ok(miss.length === 0, '自己確認がCIに無い: ' + miss.join(', '));
  console.log('     実測: 自己確認つき ' + need.length + '本すべてが CI に在る');
});

T('★scripts/ の見張りも CI に並んでいる（外すなら 理由を書く）', () => {
  const inCi = (f) => ran.some((r) => r.indexOf('node ' + f) === 0);
  const all = scriptFiles();
  const nokoshi = all.filter((f) => !EXCLUDED[f] && !inCi(f));
  console.log('     実測: scripts/ ' + all.length + '本 … CI在り ' + all.filter(inCi).length
    + '本／理由つきで外した ' + all.filter((f) => EXCLUDED[f]).length
    + '本／★まだ直していない（赤で正しい）★ ' + nokoshi.length + '本');
  for (const f of nokoshi) console.log('       ★CIで走っていない★ ' + f);
  /* ★線を緩めて緑にしない★＝直すまで 赤のまま（08-28「テスト先行の赤は 正しい赤」と同じ扱い）。
     ★直し方は2つだけ★ … ①CIに並べる ②CIで走らせてはいけない道具なら EXCLUDED に理由を書く */
  ok(nokoshi.length === 0,
    '★まだ直していない（赤で正しい）★ ' + nokoshi.length + '本: ' + nokoshi.join(', '));
});

T('★門番(scripts/)も CI に並んでいる', () => {
  const miss = guardFiles().filter((f) => !ran.some((r) => r.indexOf('node ' + f) === 0));
  ok(miss.length === 0, 'CIに並んでいない門番: ' + miss.join(', '));
});

T('★除外するなら 理由と戻す条件が書いてある（黙って外さない）', () => {
  for (const [f, why] of Object.entries(EXCLUDED)) {
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
