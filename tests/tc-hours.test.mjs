/* tc-hours.test.mjs — ★「時間」で入れて「分」で持つ★（Timeally）
 * =============================================================================
 * 司さんの指摘（2026-08-14）: 設定が全部「分」だった。★人は8時間・40時間で考える★
 *
 * ここで守る事:
 *   ・★中では今までどおり分★（倉庫の列は分のまま。計算も分。丸めの誤差を作らない）
 *   ・★既に入っている値が1分もズレない★（480 → "8" → 480）
 *   ・境界を実物で測る … 0 / 0.5 / 7.5 / 8 / 24 / 空欄 / 全角数字 / "8:30"
 *   ・★空欄は 0 ではなく「未入力」★（黙って0にしない）
 *
 * 使い方: node tests/tc-hours.test.mjs
 *         node tests/tc-hours.test.mjs --self-test
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const H = require_(path.join(ROOT, 'lib/tc-hours.js'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

console.log('\n[時間で入れて分で持つ]');

T('★境界（0 / 0.5 / 7.5 / 8 / 24）', () => {
  eq(H.toMin('0'), 0);
  eq(H.toMin('0.5'), 30);
  eq(H.toMin('0.75'), 45);
  eq(H.toMin('7.5'), 450);
  eq(H.toMin('8'), 480);
  eq(H.toMin('24'), 1440);
  eq(H.toMin('40'), 2400);
});

T('★「8:30」の書き方も受ける（打つ人が迷わない）', () => {
  eq(H.toMin('8:30'), 510);
  eq(H.toMin('0:01'), 1);
  eq(H.toMin('0:59'), 59);
  eq(H.toMin('8:00'), 480);
  eq(H.toMin('8:60'), null, '60分は受けない');
  eq(H.toMin('8:5'), 485, '1桁の分も受ける');
});

T('★★「45分」は45分。時間にしない（実機で踏んだ）★★', () => {
  eq(H.toMin('45分'), 45);
  eq(H.toMin('60分'), 60);
  eq(H.toMin('90分'), 90);
  eq(H.toMin('5分'), 5);
  eq(H.toMin('24分'), 24);
  eq(H.toMin('1440分'), 1440);
  eq(H.toMin('45m'), 45);
  eq(H.toMin('45min'), 45);
  /* ★休憩は世の中ほぼ「45分」「60分」と書く欄★ */
  eq(H.read('45分', { maxMin: H.MAX_DAY_MIN }).min, 45, '★45時間で止まってはいけない★');
  eq(H.read('60分', { maxMin: H.MAX_DAY_MIN }).min, 60);
});

T('★時間と分を混ぜた書き方', () => {
  eq(H.toMin('1時間30分'), 90);
  eq(H.toMin('8時間30分'), 510);
  eq(H.toMin('0時間45分'), 45);
  eq(H.toMin('8時間'), 480);
  eq(H.toMin('8h30m'), 510);
  eq(H.toMin('8h'), 480);
});

T('★どの書き方で読んだかを返す（画面の言い方を変えるのに使う）', () => {
  eq(H.unitOf('45分'), 'minute');
  eq(H.unitOf('8'), 'hour');
  eq(H.unitOf('8:30'), 'hm');
  eq(H.unitOf('8時間30分'), 'hm');
  eq(H.unitOf('あ'), null);
});

T('★止めた本当の理由を返す（「大きすぎます」の嘘をつかない）', () => {
  const r = H.read('1441分', { maxMin: H.MAX_DAY_MIN });
  eq(r.error, 'too_big');
  eq(r.read, 1441, '読めた分数を返す（何が長すぎたか言える）');
  eq(r.maxMin, 1440);
  eq(H.read('あ').error, 'unreadable');
  eq(H.read('').error, 'empty');
});

T('★全角数字・全角コロン・空白・「時間」「分」も受ける', () => {
  eq(H.toMin('８'), 480);
  eq(H.toMin('７．５'), 450);
  eq(H.toMin('８：３０'), 510);
  eq(H.toMin('  8  '), 480);
  eq(H.toMin('　8　'), 480);
  eq(H.toMin('8時間'), 480);
  eq(H.toMin('8時間30分'), 510, '★消すと830時間になる（実際に踏んだ）★');
  eq(H.toMin('8h'), 480);
});

T('★空欄は 0 ではなく「未入力」（黙って0にしない）', () => {
  eq(H.toMin(''), null);
  eq(H.toMin('   '), null);
  eq(H.toMin(null), null);
  eq(H.toMin(undefined), null);
  eq(H.read('').error, 'empty');
  eq(H.read('').min, null);
  /* ★0時間は「未入力」ではない★ */
  eq(H.read('0').min, 0);
  eq(H.read('0').error, null);
});

T('★読めない物は null（勝手に数にしない）', () => {
  ['あ', '8時間半', '--', '8:30:00', '1e3', '-3', '8..5'].forEach(function (s) {
    const r = H.read(s);
    ok(r.min === null, s + ' を読んでしまった: ' + r.min);
  });
});

T('★上限を超えたら受けない（1日24時間・1週168時間）', () => {
  eq(H.read('24', { maxMin: H.MAX_DAY_MIN }).min, 1440);
  eq(H.read('24.5', { maxMin: H.MAX_DAY_MIN }).error, 'too_big');
  eq(H.read('168', { maxMin: H.MAX_WEEK_MIN }).min, 10080);
  eq(H.read('169', { maxMin: H.MAX_WEEK_MIN }).error, 'too_big');
});

T('★分 → 見せ方（ちょうどは "8"／端数は "7:30"）', () => {
  eq(H.toText(480), '8');
  eq(H.toText(2400), '40');
  eq(H.toText(60), '1');
  eq(H.toText(0), '0');
  eq(H.toText(450), '7:30');
  eq(H.toText(510), '8:30');
  eq(H.toText(1), '0:01');
  eq(H.toText(null), '');
  eq(H.toText(''), '');
});

T('★★今 入っている値が1分もズレない（分→時間→分）★★', () => {
  /* 0〜1週間ぶんの全部の分を往復させる */
  const bad = [];
  for (let m = 0; m <= 7 * 24 * 60; m++) {
    if (H.toMin(H.toText(m)) !== m) bad.push(m);
  }
  ok(bad.length === 0, 'ズレた分: ' + bad.slice(0, 10).join(',') + '（' + bad.length + '件）');
  console.log('     実測: 0〜' + (7 * 24 * 60) + '分 の ' + (7 * 24 * 60 + 1) + '通りすべて往復で一致');
});

T('★既定値（480 / 2400 / 60）が 8 / 40 / 1 に見える', () => {
  eq(H.toText(480), '8'); eq(H.toText(2400), '40'); eq(H.toText(60), '1');
  eq(H.toMin('8'), 480); eq(H.toMin('40'), 2400); eq(H.toMin('1'), 60);
});

/* ── self-test：わざと壊して赤になるか ───────────────────────────── */
if (process.argv.includes('--self-test')) {
  console.log('\n[tc-hours --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('① 「時間」を消すだけの作り物は 8時間30分 を 830時間にする（本物は510分）', () => {
    const wrong = (s) => Number(String(s).replace(/時間|分/g, '')) * 60;
    eq(wrong('8時間30分'), 49800, '作り物が壊れていない＝この検査が空振り');
    eq(H.toMin('8時間30分'), 510, '★本物が830時間にしている★');
  });
  S('①-b ★単位を消してから読む作り物は「45分」を45時間にする（本物は45分）★', () => {
    const wrong = (s) => Number(String(s).replace(/時間|分|h|m/gi, '')) * 60;
    eq(wrong('45分'), 2700, '作り物が壊れていない＝この検査が空振り');
    eq(H.toMin('45分'), 45, '★本物が45時間にしている（実機で踏んだ穴）★');
    eq(H.read('45分', { maxMin: H.MAX_DAY_MIN }).error, null, '★本物が45分を止めている★');
  });
  S('② 空欄を0にする作り物は「未入力」と「0時間」を混ぜる（本物は分ける）', () => {
    const wrong = (s) => Number(s) || 0;
    eq(wrong(''), 0, '作り物が壊れていない＝この検査が空振り');
    eq(H.toMin(''), null, '★本物が空欄を0にしている★');
    eq(H.toMin('0'), 0);
  });
  S('③ 小数を切り捨てる作り物は 7.5時間を7時間にする（本物は450分）', () => {
    const wrong = (s) => Math.floor(Number(s)) * 60;
    eq(wrong('7.5'), 420, '作り物が壊れていない＝この検査が空振り');
    eq(H.toMin('7.5'), 450, '★本物が小数を落としている★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
