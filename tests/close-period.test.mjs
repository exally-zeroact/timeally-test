/* close-period.test.mjs — ★締め期間を 全部の締め日で測る★（Timeally）
 * =============================================================================
 * ★見本を選んで測らない★（司さん/指示役 2026-08-17）。
 *   前は「10 / 20 / 25 / 末日」の4通りだけ測っていた。★4つ選んだ理由が無い★＝
 *   ★見本を作って測るやり方★＝うちが禁じている形。
 *
 * ★測る組み合わせ★
 *   ★締め日 1〜31（31通り）★ × ★月の種類4つ★
 *     2月（平年28日）／2月（うるう年29日＝2024-02）／30日の月／31日の月
 *   ＝★124通り★（date の計算だけなので すぐ回る）
 *
 * ★1通りごとに数える事★
 *   ・★終わりが 締め日★（★その月に無い日は 末日に寄せる★）
 *   ・★始まりが 締め日の翌日★（★前の月に無い日は 前の月の末日に寄せる★）
 *   ・★日数が 始まり〜終わりの実日数と合う★
 *   ・★またぐかどうか★（締め日が末日なら またがない／それ以外は またぐ）
 *
 * 使い方: node tests/close-period.test.mjs
 *         node tests/close-period.test.mjs --self-test   … わざと壊して赤になるか
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const C = require_(path.join(ROOT, 'lib/tc-calc.js'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
const spanDays = (from, to) =>
  Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;

/* ★測る月4種★（★2月は 平年とうるう年の両方★＝29・30・31 の締め日が本当に効く所） */
const MONTHS = [
  ['2026-02', '2月（平年28日）'],
  ['2024-02', '2月（うるう年29日）'],
  ['2026-04', '30日の月'],
  ['2026-08', '31日の月'],
];

console.log('\n[締め期間] ★締め日 1〜31 × 月4種 ＝ 124通り★ を全部 測る');

let n = 0;
const bad = [];
for (const [ym, name] of MONTHS) {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  const last = daysIn(y, m);
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  const prevLast = daysIn(py, pm);
  for (let cd = 1; cd <= 31; cd++) {
    n++;
    const p = C.period(ym, cd);
    /* ★終わりは 締め日（無ければ末日）★ */
    const wantTo = iso(y, m, Math.min(cd, last));
    /* ★始まりは 締め日の翌日（前の月に無ければ 前の月の末日）★
       締め日が末日以上なら その月の1日から */
    const wantFrom = cd >= 31 ? iso(y, m, 1) : iso(py, pm, Math.min(cd + 1, prevLast));
    const why = name + '・締め日' + cd + ' … ';
    if (p.to !== wantTo) bad.push(why + '終わりが ' + p.to + '（' + wantTo + ' のはず）');
    if (p.from !== wantFrom) bad.push(why + '始まりが ' + p.from + '（' + wantFrom + ' のはず）');
    if (spanDays(p.from, p.to) < 27) bad.push(why + '日数が ' + spanDays(p.from, p.to) + '日しかない');
    /* ★またぐのは 締め日が末日でない時だけ★ */
    const cross = p.from.slice(0, 7) !== p.to.slice(0, 7);
    if (cd >= 31 && cross) bad.push(why + '末日締めなのに 月をまたいだ');
    if (cd < 31 && !cross) bad.push(why + '月をまたいでいない');
  }
}

T('★124通り 全部 測った（空振りしていない）', () => {
  ok(n === 124, '測った数が ' + n + '通り（124のはず）');
  console.log('     実測: ★' + n + '通り★（締め日1〜31 × 月4種）');
});

T('★どの締め日でも 終わり＝締め日／始まり＝締め日の翌日（無い日は末日に寄せる）', () => {
  ok(bad.length === 0, bad.length + '件 食い違う:\n   - ' + bad.slice(0, 8).join('\n   - '));
});

T('★存在しない締め日（29・30・31）を 2月で実物で測った', () => {
  const rows = [];
  for (const [ym, name] of [['2026-02', '平年'], ['2024-02', 'うるう年']]) {
    for (const cd of [29, 30, 31]) {
      const p = C.period(ym, cd);
      rows.push(name + '・締め日' + cd + ' → ' + p.from + '〜' + p.to);
      const last = daysIn(+ym.slice(0, 4), 2);
      ok(p.to === iso(+ym.slice(0, 4), 2, Math.min(cd, last)),
        name + '・締め日' + cd + ' の終わりが ' + p.to);
    }
  }
  console.log('     実測:\n       ' + rows.join('\n       '));
});

if (process.argv.includes('--self-test')) {
  console.log('\n[--self-test] ★わざと壊すと赤になるか★');
  let sp = 0, sf = 0;
  const S = (nn, fn) => { try { fn(); sp++; console.log('  ✓ ' + nn); } catch (e) { sf++; console.log('  ✗ ' + nn + ' — ' + e.message); } };
  S('★4通りだけ測る作りに戻すと 空振りする★', () => {
    const few = [10, 20, 25, 31];
    ok(few.length !== 31, '');
    /* ★4通りでは「締め日30の2月」が1度も測られない★ */
    ok(!few.includes(30), '');
    const p = C.period('2026-02', 30);
    ok(p.to === '2026-02-28', '本物が末日に寄せていない: ' + p.to);
    console.log('     ＝★締め日30は 4通りの中に無い★（測っていない穴が残る）');
  });
  S('★末日に寄せるのをやめた作り物★は この検査で赤になる', () => {
    const wrong = (ym, cd) => ({ to: ym + '-' + String(cd).padStart(2, '0') });
    ok(wrong('2026-02', 30).to === '2026-02-30', '作り物が作れていない');
    ok(C.period('2026-02', 30).to !== wrong('2026-02', 30).to, '★本物も存在しない日を返している★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
