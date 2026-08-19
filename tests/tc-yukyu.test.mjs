/* tc-yukyu.test.mjs — ★有給の日数を 実数で固める＋境界を実データで測って埋める★（Timeally）
 * =============================================================================
 * ★一次情報（確認日 2026-08-19・この日に1本ずつ開いて数を確かめた）★
 *   付与日数の表・基準日
 *     https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/koyou_roudou/roudoukijun/faq/kijyunhou_6_00001.html
 *     原文の表 … 6か月→10労働日／1年6か月→11／2年6か月→12／3年6か月→14／
 *                4年6か月→16／5年6か月→18／6年6か月以上→20
 *     原文 …「雇い入れの日から６か月経過していること」
 *            「最初に年次有給休暇が付与された日から１年を経過した日に」再び付与
 *   時効・繰越・年5日
 *     https://www.check-roudou.mhlw.go.jp/study/roudousya_yukyu.html
 *     原文 …「労基法第115条に基づき２年の消滅時効にかかると解されており、
 *             年休発生日から2年間は行使可能」
 *            「年度経過後における年次有給休暇の権利は消滅しません」
 *            「１０日以上の年次有給休暇が付与される全ての労働者を対象に、
 *              その基準日から１年以内に５日以上の年休付与義務」
 *
 * ★この検査には lib の名前ではなく 生の数字を書く★（lib を書き換えたら赤くなる）
 *
 * ★境界は 実データ（テスト倉庫 2026-08-19 実測）から取った★
 *   ・従業員 18人のうち ★入社日が入っているのは 4人★（14人は空）
 *     ⇒★入社日が無い人★は 必ず起きる＝「数えられません」と言い切れるか を試験にする
 *   ・打刻が在る人 4人。いちばん長い人 ★高橋 大輔 入社 2022-07-01★（打刻 184本）
 *     ⇒2026-08-19 時点で ★基準日 2026-01-01・4回目・付与14日★（4年6か月→16 ではない）
 *   ・★有給の日は 倉庫に0件★（＝これから入る）／欠勤も0件
 *
 * 使い方: node tests/tc-yukyu.test.mjs
 *         node tests/tc-yukyu.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const Y = require_(path.join(ROOT, 'lib/tc-yukyu.js'));
const LAW = require_(path.join(ROOT, 'lib/tc-law.js'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };
const eq = (a, b, m) => ok(a === b, (m || '') + ' 実測 ' + JSON.stringify(a) + ' / 決まり ' + JSON.stringify(b));

/* ★わざと壊して赤になるか★（この検査が空振りしていない証拠） */
if (process.argv.includes('--self-test')) {
  console.log('\n[tc-yukyu --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  S('① 表の数を1つ変えたら 赤になる形か（生の数字を書いている）', () => {
    ok(Y.yukyuGrantDays(6) === 10 && Y.yukyuGrantDays(78) === 20, '表が違う');
    ok(Y.yukyuGrantDays(77) === 18, '6年6か月の1か月前が 20 になっている');
  });
  S('② 繰越を「全部」にしたら 赤になる（時効2年＝前の1年ぶんだけ）', () => {
    /* 3回目の年で、1回目の10日が まるまる残っていても 繰越は 前の1年ぶんだけ */
    const r = Y.yukyuLeft({ hireDate: '2020-01-01', today: '2022-08-01', takenDays: [] });
    ok(r.carryDays <= 11, '★2年以上前の分まで繰り越している★: ' + r.carryDays);
  });
  S('④ 年5日を「全員に出す」にしたら 赤（9日の人は対象外）', () => {
    /* 6か月未満＝まだ付いていない人を 対象にしていないか */
    ok(Y.must5State({ hireDate: '2026-08-01', today: '2026-08-19', takenDays: [] }).target === false,
      '★まだ付いていない人まで 対象にしている★');
  });
  S('③ 入社日が無い人に 数を返したら 赤', () => {
    ok(Y.yukyuLeft({ hireDate: null, today: '2026-08-19', takenDays: [] }).ok === false, '数えてしまっている');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[有給] 一次情報の数と、実データで測った境界');

T('★付与日数の表（一次情報のとおり・生の数字）', () => {
  eq(Y.yukyuGrantDays(6), 10, '6か月');
  eq(Y.yukyuGrantDays(18), 11, '1年6か月');
  eq(Y.yukyuGrantDays(30), 12, '2年6か月');
  eq(Y.yukyuGrantDays(42), 14, '3年6か月');
  eq(Y.yukyuGrantDays(54), 16, '4年6か月');
  eq(Y.yukyuGrantDays(66), 18, '5年6か月');
  eq(Y.yukyuGrantDays(78), 20, '6年6か月');
  eq(Y.yukyuGrantDays(240), 20, '20年');
  console.log('     実測: 6か月→10 / 1.5年→11 / 2.5年→12 / 3.5年→14 / 4.5年→16 / 5.5年→18 / 6.5年以上→20');
});

T('★境界＝入社半年未満は 0日（前日と当日で答えが変わる）', () => {
  eq(Y.yukyuGrantDays(5), 0, '5か月');
  const before = Y.yukyuLeft({ hireDate: '2026-03-01', today: '2026-08-31', takenDays: [] });
  const on = Y.yukyuLeft({ hireDate: '2026-03-01', today: '2026-09-01', takenDays: [] });
  eq(before.ok, false, '6か月の前日');
  eq(on.ok, true, '6か月ちょうどの日');
  eq(on.grantDays, 10, '6か月ちょうどの付与');
  eq(on.period.from, '2026-09-01', '基準日');
  console.log('     実測: 2026-03-01 入社 … 8/31 は「まだ付きません」／9/1 に 10日・基準日 2026-09-01');
});

T('★境界＝月末入社（2025-08-31 入社は 2026-02-28 が基準日・月末に寄せる）', () => {
  const r = Y.yukyuLeft({ hireDate: '2025-08-31', today: '2026-03-01', takenDays: [] });
  eq(r.period.from, '2026-02-28', '基準日');
  eq(r.grantDays, 10, '付与');
  console.log('     実測: 2025-08-31 入社 → 基準日 2026-02-28（2/31 は無いので月末に寄せる）');
});

T('★年度またぎ＝基準日をまたぐと 使った日数を数え直す', () => {
  const taken = ['2025-12-30', '2026-01-05', '2026-02-10'];   /* 1日目は前の1年 */
  const r = Y.yukyuLeft({ hireDate: '2022-07-01', today: '2026-08-19', takenDays: taken });
  eq(r.period.from, '2026-01-01', '基準日');
  eq(r.period.to, '2026-12-31', '期間の終わり');
  eq(r.usedDays, 2, '今の1年に使った日数');
  eq(r.grantDays, 14, '今の1年の付与（3年6か月）');
  eq(r.carryDays, 11, '繰越（前の1年 12日 − 前の1年に使った1日）');
  eq(r.leftDays, 23, '残り');
  console.log('     実測: 高橋（2022-07-01 入社）… 基準日 2026-01-01 / 付与14 + 繰越11 − 使った2 = 残り23');
});

T('★時効2年＝繰り越せるのは 前の1年ぶんだけ（それより前は消える）', () => {
  /* 2020-01-01 入社 … 基準日は 2020-07-01 / 2021-07-01 / 2022-07-01 / ★2023-07-01（4回目）★ */
  const r = Y.yukyuLeft({ hireDate: '2020-01-01', today: '2023-08-01', takenDays: [] });
  eq(r.period.from, '2023-07-01', '基準日');
  eq(r.period.nth, 4, '4回目の年');
  eq(r.grantDays, 14, '今の付与（3年6か月）');
  eq(r.carryDays, 12, '繰越は 前の1年ぶんだけ（2年6か月の12日）');
  eq(r.leftDays, 26, '残り（1・2回目の 10日・11日は 時効で消える）');
  console.log('     実測: 3年半 使わなかった人 … 14 + 12 = 26日（前の前より古い 10日と11日は 消える）');
});

T('★境界＝使いすぎても マイナスにならない', () => {
  const many = [];
  for (let i = 1; i <= 40; i++) many.push('2026-03-' + ('0' + ((i % 28) + 1)).slice(-2));
  const r = Y.yukyuLeft({ hireDate: '2022-07-01', today: '2026-08-19', takenDays: many });
  ok(r.leftDays >= 0, '★マイナスの残りを出している★: ' + r.leftDays);
  console.log('     実測: 使いすぎ … 残り ' + r.leftDays + '日（0より下にしない）');
});

T('★境界＝入社日が無い人（実データで 18人中14人）は 数えないで理由を言う', () => {
  const r = Y.yukyuLeft({ hireDate: null, today: '2026-08-19', takenDays: [] });
  eq(r.ok, false, '数えてしまっている');
  ok(/入社日/.test(r.why), '理由が言えていない: ' + r.why);
  eq(r.leftDays, 0, '残り');
  console.log('     実測: 「' + r.why + '」（実データでは 18人中14人が この形）');
});

T('★年5日の対象（10日以上 付いた人）', () => {
  eq(Y.mustTake5(10), true, '10日');
  eq(Y.mustTake5(9), false, '9日');
  eq(Y.yukyuLeft({ hireDate: '2026-01-01', today: '2026-07-01', takenDays: [] }).mustTake5, true, '6か月の人');
  console.log('     実測: 10日→対象 / 9日→対象外');
});

/* ── ★年5日の時季指定義務★（2026-08-19 指示役④-②） ────────────────────────
   出典（上と同じ・確認日 2026-08-19）… 確かめよう労働条件
     「１０日以上の年次有給休暇が付与される全ての労働者を対象に、
       その基準日から１年以内に５日以上の年休付与義務」 */
T('★年5日＝10日以上 付いた人だけが対象（9日の人は出さない）', () => {
  /* 6か月＝10日 → 対象／入社半年未満 → 対象外（まだ付いていない） */
  const a = Y.must5State({ hireDate: '2026-01-01', today: '2026-08-19', takenDays: [] });
  eq(a.target, true, '6か月の人');
  eq(a.needDays, 5, 'あと何日');
  /* 2026-01-01 入社 → 基準日 2026-07-01 → ★期限は その1年後の前日 2027-06-30★ */
  eq(a.byDate, '2027-06-30', '期限（基準日から1年）');
  const b = Y.must5State({ hireDate: '2026-08-01', today: '2026-08-19', takenDays: [] });
  eq(b.target, false, '入社半年未満');
  const c = Y.must5State({ hireDate: null, today: '2026-08-19', takenDays: [] });
  eq(c.target, false, '入社日が無い人');
  console.log('     実測: 6か月→対象（あと5日・期限 2027-06-30）／半年未満→対象外／入社日なし→対象外');
});

T('★年5日＝取った分だけ減り、5日 取ったら 0になる（境界）', () => {
  const base = { hireDate: '2026-01-01', today: '2026-08-19' };
  eq(Y.must5State(Object.assign({ takenDays: ['2026-07-01', '2026-07-02'] }, base)).needDays, 3, '2日 取った');
  eq(Y.must5State(Object.assign({ takenDays: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07'] }, base)).needDays, 0, '5日 取った');
  eq(Y.must5State(Object.assign({ takenDays: ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06', '2026-07-07', '2026-07-08'] }, base)).needDays, 0, '6日 取った（マイナスにしない）');
  /* ★前の1年に取った分は 今の1年に数えない★（年度またぎ） */
  eq(Y.must5State({ hireDate: '2022-07-01', today: '2026-08-19', takenDays: ['2025-12-30'] }).needDays, 5, '前の1年に取った分');
  console.log('     実測: 2日→あと3 ／5日→あと0 ／6日→あと0 ／前の1年の分は数えない');
});

T('★tc-law.js から呼んでも 同じ数（正本は1本きり）', () => {
  eq(LAW.yukyuGrantDays(42), Y.yukyuGrantDays(42), '付与日数');
  eq(JSON.stringify(LAW.yukyuLeft({ hireDate: '2022-07-01', today: '2026-08-19', takenDays: [] })),
    JSON.stringify(Y.yukyuLeft({ hireDate: '2022-07-01', today: '2026-08-19', takenDays: [] })), '残り');
  eq(LAW.YUKYU_TABLE.length, 7, '表の本数');
  console.log('     実測: tc-law 経由と tc-yukyu 直で 同じ答え');
});

T('★lib は 今日を勝手に読まない（試験を走らせた日で答えが変わらない）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/tc-yukyu.js'), 'utf8');
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  ok(!/Date\.now\(\)/.test(body), '★Date.now() を使っている★');
  ok(!/new Date\(\)/.test(body), '★new Date() を使っている★');
  console.log('     実測: Date.now() 0件 / new Date() 0件（today は 呼ぶ側が渡す）');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
