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

/* ★CIから外す物は ここに 理由と 戻す条件を書く（今は空）★ */
export const EXCLUDED = {
  // 'tests/xxx.test.mjs': '理由 … 戻す条件 …',
};

export function testFiles() {
  return fs.readdirSync(path.join(ROOT, 'tests'))
    .filter((f) => /\.test\.mjs$/.test(f) || f === 'ui-sweep.mjs')
    .map((f) => 'tests/' + f).sort();
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
