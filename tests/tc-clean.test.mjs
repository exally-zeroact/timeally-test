/* tc-clean.test.mjs — ★連打・打ち間違いの境界を 実物で測る★（Timeally）
 * =============================================================================
 * ★見本は 司さんが 2026-08-17 に実機で作った 5本★（テスト倉庫 tc_punch からそのまま写した）。
 *   08/17  08:00 出勤 ／ 08:00 退勤 ／ 08:00 出勤 ／ 17:03 退勤 ／ 21:44 出勤
 *   ★作り物で代用しない★（id も 倉庫に在る物の頭8文字）。
 *
 * ★境界は 実データを数えてから決めた★（2026-08-18 / テスト倉庫 tc_punch 全402件・6人・108日）
 *   ・秒が0でない打刻 … ★0件★     → 「秒だけ違う」は今は起きない。でも ★倉庫は秒を持てる★ので試す
 *   ・同じ種類が続く物をまとめた時に消える本数 … 0分=1本 / 3分=1本 / 10分=1本（★どれも同じ★）
 *   ・本物の打刻どうしの間 … ★最小60分★（60分が92回）→ ★3分の窓は 本物を巻き込まない★
 *   ・同じ分に出勤と退勤=1件／閉じていない出勤=3件／出勤が無い退勤=1件／日をまたぐ=4件
 *   ・0:00ちょうど=0件／23:59=0件 → ★実データに無い★ので ここで作って試す（数を出した上で）
 *
 * 使い方: node tests/tc-clean.test.mjs
 *         node tests/tc-clean.test.mjs --self-test
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const CLEAN = require_(path.join(ROOT, 'lib/tc-clean.js'));
const CALC = require_(path.join(ROOT, 'lib/tc-calc.js'));
const CSV = require_(path.join(ROOT, 'lib/tc-csv.js'));

/* ★実物★（2026-08-17 vaojf21496@yahoo.co.jp / 従業員 Emsx86ik5・倉庫からそのまま） */
export const REAL_0817 = [
  { id: '4585c34f', at: '2026-08-17T08:00', kind: 'in', src: 'punch' },
  { id: '45732de7', at: '2026-08-17T08:00', kind: 'out', src: 'punch' },
  { id: '1d29231e', at: '2026-08-17T08:00', kind: 'in', src: 'punch' },
  { id: '8567f67f', at: '2026-08-17T17:03', kind: 'out', src: 'punch' },
  { id: 'e89afaad', at: '2026-08-17T21:44', kind: 'in', src: 'punch' },
];
const TODAY = '2026-08-18';                     // ★翌日に見た★（08/17 は もう終わった日）
const CO = { closeDay: 31, breakDefaultMin: 60 };

const p = (at, kind, id) => ({ id: id || (at + kind), at: at, kind: kind, src: 'punch' });
const sum = (punches, today) => CALC.summarize({ ym: '2026-08', punches: punches, company: CO, today: today || TODAY });
const dayOf = (s, d) => s.days.filter((x) => x.d === d)[0];
const asksOf = (punches, today) => CLEAN.clean(punches, { today: today || TODAY }).asks;

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };

/* ── わざと戻すと赤になるか（★通り数を出す★） ───────────────────── */
if (process.argv.includes('--self-test')) {
  console.log('\n[tc-clean --self-test] わざと戻すと赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('① ★掃除しない作り（前の姿）★に戻すと 08/17 が黙って0分のまま何も言わない', () => {
    /* 前の姿＝打った物をそのまま組み立てる（tc-clean を通さない） */
    const raw = CLEAN.sorted(REAL_0817);
    const r = CLEAN.pairsOf(raw);
    const closed = r.pairs.filter((x) => x.outAt);
    /* ★前の姿＝08:00 に「0分の勤務」が1つ出来て、あとは黙る★（司さんが見た画面） */
    eq(closed.length, 1, '作り物が「前の姿」になっていない');
    eq(closed[0].inAt, closed[0].outAt, '★0分の勤務になっていない＝作り物が違う★');
    /* 本物は ★必ず 聞く事を出す★ */
    ok(asksOf(REAL_0817).length >= 2, '★本物が 聞く事を出していない＝この検査が空振り★');
  });
  S('② ★窓を60分に広げた作り物★は 本物の打刻（最小60分）まで巻き込む', () => {
    const two = [p('2026-08-17T09:00', 'in'), p('2026-08-17T10:00', 'in')];
    eq(CLEAN.clean(two, { windowMin: 60, today: TODAY }).used.length, 1, '作り物が巻き込んでいない');
    eq(CLEAN.clean(two, { today: TODAY }).used.length, 2, '★既定(3分)で巻き込んでいる＝広すぎる★');
  });
  S('③ ★決められない日を 0にして黙る作り物★は undecided が立たない', () => {
    const broken = REAL_0817.filter((x) => x.kind !== 'out' || x.at !== '2026-08-17T08:00');
    ok(!CLEAN.clean(broken, { today: TODAY }).byDay['2026-08-17'].undecided, '作り物で undecided が立っている');
    ok(CLEAN.clean(REAL_0817, { today: TODAY }).byDay['2026-08-17'].undecided,
      '★本物で undecided が立っていない＝この検査が空振り★');
  });
  S('④ ★「まとめました」を消す作り物★は 画面から打刻が1本 消える', () => {
    const r = CLEAN.clean(REAL_0817, { today: TODAY });
    eq(r.punches.length, 5, '★原本の本数が変わっている（消している）★');
    eq(r.punches.filter((x) => x.why === 'merged').length, 1, 'まとめた印が付いていない');
  });
  S('⑤ ★備考から「決められません」を外した作り物★は 紙とCSVが黙る', () => {
    const d = dayOf(sum(REAL_0817), '2026-08-17');
    ok(/決められません/.test(CSV.note(d)), '★本物の備考に出ていない＝この検査が空振り★');
    ok(!/決められません/.test(CSV.note(Object.assign({}, d, { undecided: false }))), '作り物でも出ている');
  });
  S('⑥ ★どの状態でも全部 押せる作り（前の姿）★に戻すと 出勤していない人が退勤を押せる', () => {
    const all = { in: true, out: true, away_in: true, away_out: true };
    ok(all.out, '作り物が「全部押せる」になっていない');
    ok(!CLEAN.stateOf([], {}).allow.out, '★本物で 出勤していない人が退勤を押せる＝門が無い★');
  });
  S('⑦ ★時刻の門を「以上」に緩めた作り物★は 同じ分（08:00 出勤→08:00 退勤）を通す', () => {
    const s = CLEAN.stateOf([p('2026-08-18T09:00', 'in')], {});
    const loose = (t) => CLEAN.toMin(t) >= CLEAN.toMin(s.lastAt);      // わざと「以上」
    ok(loose('2026-08-18T09:00'), '作り物が緩くなっていない');
    ok(!CLEAN.timeOk(s, '2026-08-18T09:00').ok, '★本物が同じ分を通している（08/17 の型が再発する）★');
  });
  S('⑧ ★線を 所定×1.5 に下げた作り物★は 実データの 750分の日にも聞いてしまう', () => {
    const mk = (min) => [{ id: 'a', at: '2026-08-17T00:00', kind: 'in' },
      { id: 'b', at: '2026-08-17T' + ('0' + Math.floor(min / 60)).slice(-2) + ':'
        + ('0' + (min % 60)).slice(-2), kind: 'out' }];
    ok(750 > 480 * 1.5, '作り物の線が下がっていない');
    ok(CLEAN.timeIssues(mk(750), { dayStdMin: 480 }).length === 0,
      '★本物の線(所定×2)が 実データに在る750分の日に聞いている★');
  });
  S('⑨ ★「合っている」の印を見ない作り物★は 何度でも同じ事を聞く', () => {
    const long = [{ id: 'a', at: '2026-08-17T08:00', kind: 'in' },
      { id: 'b', at: '2026-08-18T21:00', kind: 'out', ok_types: ['too-long'] }];
    ok(CLEAN.timeIssues(long, { today: '2026-08-19' }).length === 0, '★本物が印を見ていない★');
    const noMark = long.map((x) => ({ id: x.id, at: x.at, kind: x.kind }));
    ok(CLEAN.timeIssues(noMark, { today: '2026-08-19' }).length === 1, '作り物で聞かなくなっている');
  });
  S('⑩ ★全部お願いにする作り（前の姿）★は 締めていない月でも 会社を待たせる', () => {
    ok(CLEAN.canFix({ state: 'open' }).ok, '★本物が まだ会社を待たせている★');
    ok(CLEAN.canFix({ state: 'pending' }).ok, '★締め待ちで 止めている★');
  });
  S('⑪ ★締めた月まで直せる作り物★は 給与の確定後に勤怠が動く', () => {
    ok(!CLEAN.canFix({ state: 'closed' }).ok, '★締めた月を 直せてしまう★');
    ok(/会社に言ってください/.test(CLEAN.canFix({ state: 'closed' }).why), '理由の言葉が違う');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed（★11通り★）');
  if (sf) process.exit(1);
}

console.log('\n[連打・打ち間違い] ★実物（08/17 の5本）と 境界を測る★');

/* ── ① 実物 ─────────────────────────────────────────────────── */
T('★実物★ 08/17 の5本 … 同じ分の出勤2本は1本にまとまり、原本は5本のまま残る', () => {
  const r = CLEAN.clean(REAL_0817, { today: TODAY });
  eq(r.punches.length, 5, '★原本が減っている（消してはいけない）★');
  eq(r.punches.filter((x) => x.why === 'merged').length, 1, 'まとめた本数');
  eq(r.punches.filter((x) => x.why === 'undecided').length, 2, '決められない本数（出勤と退勤）');
  eq(r.used.length, 2, '使う本数（17:03 退勤 と 21:44 出勤）');
  eq(r.movedMin, 0, '★まとめで動いた分★（同じ分なので0分）');
  console.log('     実測: 原本5本 → まとめ1本 / 決められない2本 / 使う2本 / 動いた分 0分');
});

T('★実物★ 08/17 は 聞く事が2つ出る（★同じ時刻の どちらか★と ★閉じていない出勤★）', () => {
  const a = asksOf(REAL_0817);
  eq(a.length, 2, '聞く事の数: ' + JSON.stringify(a.map((x) => x.text)));
  eq(a[0].type, 'both');
  eq(a[0].text, '08:00 は 出勤と退勤が同じ時刻です。どちらでしたか？');
  eq(a[1].type, 'open-in');
  eq(a[1].text, '21:44 の出勤に、まだ退勤が入っていません');
  console.log('     実測: ' + a.map((x) => x.text).join(' ／ '));
});

T('★実物★ 17:03 の「出勤が無い退勤」は 聞かない（★上の質問に答えれば消える物★）', () => {
  const a = asksOf(REAL_0817);
  ok(!a.some((x) => x.type === 'out-only'), '同じ日に 質問を積み上げている: ' + JSON.stringify(a));
});

T('★実物★ 押すと どうなるかを 先に見せる（根拠つき）', () => {
  const r = CLEAN.clean(REAL_0817, { today: TODAY });
  const a = r.asks[0];
  eq(CLEAN.previewOf(r, a, 'in'), '08:00〜17:03 になります');
  ok(/出勤が入らないまま/.test(CLEAN.previewOf(r, a, 'out')), '退勤を選んだ時の姿が出ていない');
});

T('★実物★ その日の結論を1行 出す（★決められない日は 決められないと言う★）', () => {
  const r = CLEAN.clean(REAL_0817, { today: TODAY });
  const line = CLEAN.daySentence(r.byDay['2026-08-17'], '2026-08-17');
  ok(/決められません/.test(line), line);
  /* ★すぐ下に同じ質問が出るので ここは短く★（同じ文を2回 並べない） */
  ok(/08:00 が 出勤か退勤か 決まっていません/.test(line), '理由が入っていない: ' + line);
  ok(line.indexOf(r.asks[0].text) < 0, '★質問と同じ文をそのまま繰り返している★: ' + line);
  console.log('     実測: ' + line);
});

T('★実物★ 数える所も「決められない」を持って回る（★0にして黙らない★）', () => {
  const s = sum(REAL_0817);
  const d = dayOf(s, '2026-08-17');
  eq(d.undecided, true, '日に印が付いていない');
  eq(d.merged, 1, 'まとめた本数が日に付いていない');
  eq(d.asks.length, 2, '聞く事が日に付いていない');
  eq(s.month.undecidedDays, 1, '月に「決められない日」が出ていない');
  eq(s.month.workedMin, 0, '★決められない日を勝手に数えている★');
  ok(/決められません/.test(CSV.note(d)), '★紙とCSVの備考に出ていない★');
  console.log('     実測: 月の 決められない日 ' + s.month.undecidedDays + '日 / 聞く事 ' + s.month.askCount + '件');
});

T('★実物★ 答えた後（08:00は出勤・21:44は取り消し）は 08:00〜17:03＝実労働 8:03 になる', () => {
  const answered = REAL_0817.filter((x) => x.id !== '45732de7' && x.id !== 'e89afaad');
  const d = dayOf(sum(answered), '2026-08-17');
  eq(d.inAt, '2026-08-17T08:00'); eq(d.outAt, '2026-08-17T17:03');
  eq(d.spanMin, 543, '拘束（8:00〜17:03）');
  eq(d.breakMin, 60, '会社の既定の休憩');
  eq(d.workMin, 483, '実労働（543 − 60）');
  eq(CSV.hhmm(d.workMin), '8:03');
  eq(d.undecided, false); eq(d.asks.length, 0);
  console.log('     実測: 08:00〜17:03 拘束9:03 − 休憩1:00 → 実労働 8:03');
});

/* ── ② 境界（★実データで数えてから作った★） ─────────────────────── */
T('境界: ★同じ種類の3連続★（同じ分）… 後の1本だけ使う・残り2本は印を付けて残す', () => {
  const three = [p('2026-08-05T09:00', 'in', 'a'), p('2026-08-05T09:00', 'in', 'b'),
    p('2026-08-05T09:00', 'in', 'c'), p('2026-08-05T18:00', 'out', 'z')];
  const r = CLEAN.clean(three, { today: TODAY });
  eq(r.used.filter((x) => x.kind === 'in').length, 1, '使う出勤が1本でない');
  eq(r.used.filter((x) => x.kind === 'in')[0].id, 'c', '★後の1本★を使っていない');
  eq(r.punches.filter((x) => x.why === 'merged').length, 2);
  eq(dayOf(sum(three), '2026-08-05').workMin, 480, '9:00〜18:00 − 休憩60分');
});

T('境界: ★窓の中の連打（3分）と 窓の外（4分）★ … 4分は まとめず ★聞く★', () => {
  const inWin = [p('2026-08-05T09:00', 'in', 'a'), p('2026-08-05T09:03', 'in', 'b'), p('2026-08-05T18:00', 'out')];
  const outWin = [p('2026-08-05T09:00', 'in', 'a'), p('2026-08-05T09:04', 'in', 'b'), p('2026-08-05T18:00', 'out')];
  eq(CLEAN.clean(inWin, { today: TODAY }).used.length, 2, '3分（窓の中）がまとまっていない');
  eq(CLEAN.clean(inWin, { today: TODAY }).movedMin, 3, '★動いた分を数えていない★');
  eq(CLEAN.clean(outWin, { today: TODAY }).used.length, 3, '4分（窓の外）を勝手にまとめている');
  ok(asksOf(outWin).some((x) => x.type === 'open-in' && x.hm === '09:00'), '窓の外を聞いていない');
  console.log('     実測: 窓=' + CLEAN.WINDOW_MIN + '分（実データの本物の最小間隔 60分より小さい）');
});

T('境界: ★秒だけ違う（08:00:01 と 08:00:59）★ … 同じ分として1本にまとめる', () => {
  const sec = [{ id: 'a', at: '2026-08-05T08:00:01', kind: 'in' }, { id: 'b', at: '2026-08-05T08:00:59', kind: 'in' },
    p('2026-08-05T17:00', 'out')];
  const r = CLEAN.clean(sec, { today: TODAY });
  eq(r.used.filter((x) => x.kind === 'in').length, 1, '秒違いをまとめていない');
  eq(r.movedMin, 0, '秒は分に丸めて見るので 動いた分は0');
});

T('境界: ★閉じていない出勤（前の日）★ … 聞く。★今日の最後★は 言い方を変えて聞く', () => {
  const yday = [p('2026-08-17T09:00', 'in')];
  const a1 = asksOf(yday, TODAY);
  eq(a1.length, 1); eq(a1[0].type, 'open-in'); eq(a1[0].soft, false);
  const today = [p('2026-08-18T09:00', 'in')];
  const a2 = asksOf(today, TODAY);
  eq(a2.length, 1); eq(a2[0].soft, true, '★今日の最後の出勤を きつく言っている★');
  ok(/まだお仕事中なら そのままで大丈夫です/.test(a2[0].text), a2[0].text);
});

T('境界: ★退勤だけ★（出勤が無い）… 聞く／数える所は0分のまま黙らない', () => {
  const only = [p('2026-08-05T18:00', 'out')];
  const a = asksOf(only);
  eq(a.length, 1); eq(a[0].type, 'out-only');
  eq(a[0].text, '18:00 の退勤に、出勤が入っていません');
  const d = dayOf(sum(only), '2026-08-05');
  eq(d.workMin, 0); eq(d.incomplete, true, '★片方だけの印が付いていない★');
  ok(/8\/5 は 決められません/.test(CLEAN.daySentence(CLEAN.clean(only, { today: TODAY }).byDay['2026-08-05'], '2026-08-05')),
    '「打刻がありません」と言っている（打刻は在る）');
});

T('境界: ★日をまたぐ（23:50 出勤 → 翌 07:00 退勤）★ … 1つの勤務のまま・聞かない', () => {
  const night = [p('2026-08-05T23:50', 'in'), p('2026-08-06T07:00', 'out')];
  eq(asksOf(night).length, 0, '日またぎを おかしいと言っている: ' + JSON.stringify(asksOf(night)));
  const d = dayOf(sum(night), '2026-08-05');
  eq(d.crossMidnight, true);
  eq(d.workMin, 370, '23:50〜07:00（430分）− 休憩60分');
  eq(d.undecided, false);
});

T('境界: ★0時ちょうど／23:59★ … 日の端でも まとめ方も 聞き方も変わらない', () => {
  const edge = [p('2026-08-05T00:00', 'in', 'a'), p('2026-08-05T00:00', 'in', 'b'), p('2026-08-05T23:59', 'out')];
  const r = CLEAN.clean(edge, { today: TODAY });
  eq(r.used.length, 2, '0:00 の連打がまとまっていない');
  eq(asksOf(edge).length, 0, '端の時刻を おかしいと言っている');
  const d = dayOf(sum(edge), '2026-08-05');
  eq(d.inAt, '2026-08-05T00:00'); eq(d.outAt, '2026-08-05T23:59');
  eq(d.workMin, 1439 - 60, '0:00〜23:59 − 休憩60分');
});

T('境界: ★打刻0件の日★ … 聞かない・決められないとも言わない（★空欄のまま★）', () => {
  const s = sum([]);
  eq(s.month.askCount, 0); eq(s.month.undecidedDays, 0);
  const d = dayOf(s, '2026-08-05');
  eq(d.workMin, 0); eq(d.undecided, false); eq(d.asks.length, 0);
  eq(CSV.note(d), '', '打刻の無い日に備考が出ている');
});

T('境界: ★「お願い中」と 本記録が 同じ日に在る★ … お願い中も同じ目で見る（札は落とさない）', () => {
  const mixed = [p('2026-08-05T09:00', 'in'),
    { id: 'q', at: '2026-08-05T18:00', kind: 'out', src: 'calendar', pending: true }];
  const r = CLEAN.clean(mixed, { today: TODAY });
  eq(r.used.length, 2, 'お願い中を落としている');
  eq(r.punches.filter((x) => x.pending).length, 1, '★お願い中の札が落ちている★');
  eq(asksOf(mixed).length, 0, 'お願い中で閉じているのに 聞いている');
  /* ★社長側は 承認するまで お願い中を数えない★ ＝ その時は「閉じていない出勤」を聞く */
  const ownerSees = mixed.filter((x) => !x.pending);
  eq(asksOf(ownerSees).length, 1, '承認前の社長側で 聞く事が出ていない');
});

/* ── ③ 使う所（数える1本・従業員の画面）が 同じ物を見ているか ────────── */
T('★数える所は tc-clean を通す（判定を2か所に書いていない）', () => {
  const ses = CALC.sessions(REAL_0817, { today: TODAY });
  ok(ses.clean, 'sessions が掃除の結果を持っていない');
  eq(ses.clean.used.length, 2);
  eq(ses.list.length, 1, '使う打刻から組んだ勤務の数');
});

T('★従業員の画面に出る文に 数えた結果の言葉が1つも無い（時刻だけ）', () => {
  const r = CLEAN.clean(REAL_0817, { today: TODAY });
  const words = ['実労働', '労働時間', '残業', '時間外', '深夜', '割増', '丸め', '金額', '時給', '法定'];
  const texts = r.asks.map((a) => a.text)
    .concat([CLEAN.daySentence(r.byDay['2026-08-17'], '2026-08-17'),
      CLEAN.previewOf(r, r.asks[0], 'in'), CLEAN.previewOf(r, r.asks[0], 'out')]);
  const bad = [];
  texts.forEach((t) => words.forEach((w) => { if (t.indexOf(w) >= 0) bad.push(w + ' ← ' + t); }));
  ok(bad.length === 0, '★従業員に見せられない言葉: ' + bad.join(' / ') + '★');
  console.log('     実測: 文 ' + texts.length + '本 / 見張った言葉 ' + words.length + '語 / 見つかった 0件');
});

/* ── ④ ★ミスが起きない作り★（打つ画面の門・2026-08-18 司さん） ───────────
   「出勤押してもないのに退勤おせるとか」
   「ミスがあったからの対処やなく、ミスのないような対処させろよ」            */
T('★門A★ 出勤していない人は ★出勤しか押せない★（退勤は押せない）', () => {
  const s = CLEAN.stateOf([], {});
  eq(s.state, 'out'); eq(s.label, 'まだ出勤していません');
  eq(s.allow.in, true); eq(s.allow.out, false);
  eq(s.allow.away_in, false); eq(s.allow.away_out, false);
  ok(/先に出勤/.test(s.deny), '押せない理由が無い: ' + s.deny);
});

T('★門A★ 出勤中は ★退勤と外出だけ★／外出中は ★戻るだけ★', () => {
  const inn = CLEAN.stateOf([p('2026-08-18T09:00', 'in')], {});
  eq(inn.state, 'in'); eq(inn.allow.out, true); eq(inn.allow.away_in, true); eq(inn.allow.in, false);
  const away = CLEAN.stateOf([p('2026-08-18T09:00', 'in'), p('2026-08-18T12:00', 'away_in')], {});
  eq(away.state, 'away'); eq(away.allow.away_out, true); eq(away.allow.out, false); eq(away.allow.in, false);
  const back = CLEAN.stateOf([p('2026-08-18T09:00', 'in'), p('2026-08-18T12:00', 'away_in'),
    p('2026-08-18T13:00', 'away_out')], {});
  eq(back.state, 'in'); eq(back.allow.out, true);
});

T('★門A★ 夜勤（前の日 23:00 出勤）でも 翌朝は「出勤中」のまま', () => {
  const s = CLEAN.stateOf([p('2026-08-17T23:00', 'in')], { today: '2026-08-18' });
  eq(s.state, 'in'); eq(s.allow.out, true);
  eq(CLEAN.hmOf(s.lastAt), '23:00');
});

T('★門A★ 退勤した後は また出勤だけ／★まとめた打刻は状態に入れない★', () => {
  const s = CLEAN.stateOf([p('2026-08-18T09:00', 'in'), p('2026-08-18T18:00', 'out')], {});
  eq(s.state, 'out'); eq(s.allow.in, true); eq(s.allow.out, false);
  /* 同じ分の連打は1本にまとまる＝状態は「出勤中」1回ぶん */
  const dbl = CLEAN.stateOf([p('2026-08-18T09:00', 'in', 'a'), p('2026-08-18T09:00', 'in', 'b')], {});
  eq(dbl.state, 'in'); eq(dbl.clean.used.length, 1);
});

T('★門E★ 選べる時刻は ★最後に打った時刻より後★だけ（同じ分も止める＝08/17 の型）', () => {
  const s = CLEAN.stateOf([p('2026-08-18T09:00', 'in')], {});
  eq(CLEAN.timeOk(s, '2026-08-18T08:00').ok, false, '過去の時刻を通している');
  eq(CLEAN.timeOk(s, '2026-08-18T09:00').ok, false, '★同じ分を通している（出勤と退勤が同じ時刻になる）★');
  /* ★同じ分と 過去では 言い方を変える★（同じ分＝いま打ったところ／過去＝打ち忘れ） */
  ok(/1分たつと 次を打てます/.test(CLEAN.timeOk(s, '2026-08-18T09:00').why),
    '同じ分の言い方が「打ち忘れ」になっている: ' + CLEAN.timeOk(s, '2026-08-18T09:00').why);
  ok(/取り消す/.test(CLEAN.timeOk(s, '2026-08-18T09:00').why), '★取り消しの逃げ道を出していない★');
  eq(CLEAN.timeOk(s, '2026-08-18T09:01').ok, true);
  ok(/最後に打ったのは 09:00/.test(CLEAN.timeOk(s, '2026-08-18T08:00').why), '理由に時刻が無い');
  ok(/記録へ/.test(CLEAN.timeOk(s, '2026-08-18T08:00').why), '★逃げ道（あとから入れる）を出していない★');
  /* まだ1本も打っていない人は 何時でもよい */
  eq(CLEAN.timeOk(CLEAN.stateOf([], {}), '2026-08-18T08:00').ok, true);
  eq(CLEAN.timeOk(CLEAN.stateOf([], {}), '').ok, false, '空の時刻を通している');
});

T('★実物★ 08/17 の5本を ★押した順★に門A＋門Eへ通すと 4本が そもそも入らない', () => {
  /* 押した順（created_at）… 21:44 を打った後に 時刻を朝へ戻して 4回 押している */
  const pressed = [
    { at: '2026-08-17T21:44', kind: 'in' }, { at: '2026-08-17T08:00', kind: 'in' },
    { at: '2026-08-17T08:00', kind: 'out' }, { at: '2026-08-17T08:00', kind: 'in' },
    { at: '2026-08-17T17:03', kind: 'out' },
  ];
  const kept = [];
  let blocked = 0;
  pressed.forEach(function (x, i) {
    const s = CLEAN.stateOf(kept, { today: TODAY });
    const okKind = s.allow[x.kind];
    const okTime = CLEAN.timeOk(s, x.at).ok;
    if (okKind && okTime) kept.push(Object.assign({ id: 'k' + i }, x)); else blocked++;
  });
  eq(blocked, 4, '止まった本数');
  eq(kept.length, 1, '入った本数');
  /* ★後ろに残る「聞く事」が 2件 → 1件★（「決められない日」が丸ごと消える） */
  eq(asksOf(REAL_0817).length, 2, '今の件数');
  const after = CLEAN.clean(kept, { today: TODAY });
  eq(after.asks.length, 1, '門を入れた後の件数');
  eq(after.asks[0].type, 'open-in');
  ok(!after.byDay['2026-08-17'].undecided, '★決められない日が残っている★');
  console.log('     実測: 5本中 4本が入らない → 聞く事 2件 → 1件（決められない日 1日 → 0日）');
});

T('★門B★ 取り消せる長さは ★60秒★（実データの押し直し最大11.9秒の5倍以上）', () => {
  eq(CLEAN.UNDO_SEC, 60);
  ok(CLEAN.UNDO_SEC >= 11.9 * 5, '★実測の押し直し（最大11.9秒）に対して余裕が無い★');
});

/* ── (5) TIME ISSUES ★時刻そのものを間違えた時★（2026-08-18 夜 司さん） ────
   ★線は実データで決めた★（拘束 106本： 最小420分／最大750分／50%が540分）
     ・所定x2（960分）を超える … ★実データ 0本★（誤って聞かない）
       ※所定x1.5（720分）だと ★49本★ 引っかかる＝線として使えない
     ・15分未満 … ★実データ 0本★（0/5/10/30/60分 で数えても 全部0本）            */
T('★時刻★ 退勤の打ち忘れ（翌日に押した）を 機械が見つけて聞く', () => {
  const long = [p('2026-08-17T08:00', 'in', 'a'), p('2026-08-18T21:00', 'out', 'b')];
  const iss = CLEAN.timeIssues(long, { today: '2026-08-19', dayStdMin: 480 });
  eq(iss.length, 1); eq(iss[0].type, 'too-long');
  eq(iss[0].id, 'b', '★印を付ける先が退勤の行でない★');
  ok(/日をまたいでいます/.test(iss[0].text), iss[0].text);
  ok(/時刻はこれで合っていますか/.test(iss[0].text), iss[0].text);
  console.log('     実測: ' + iss[0].text);
});

T('★時刻★ 線の両側を測る（★所定x2 ちょうどは聞かない・1分超えたら聞く★）', () => {
  const mk = (outHm) => [p('2026-08-17T00:00', 'in', 'a'),
    { id: 'b', at: '2026-08-17T' + outHm, kind: 'out' }];
  eq(CLEAN.timeIssues(mk('16:00'), { dayStdMin: 480 }).length, 0, '960分ちょうどで聞いている');
  eq(CLEAN.timeIssues(mk('16:01'), { dayStdMin: 480 }).length, 1, '961分で聞いていない');
  eq(CLEAN.timeIssues(mk('16:01'), { dayStdMin: 600 }).length, 0, '決まりが長い会社で誤って聞いている');
});

T('★時刻★ 短すぎ … ちょうど15分は聞かない・14分は聞く', () => {
  const mk = (outHm) => [p('2026-08-17T09:00', 'in', 'a'),
    { id: 'b', at: '2026-08-17T' + outHm, kind: 'out' }];
  eq(CLEAN.timeIssues(mk('09:15'), {}).length, 0, '15分ちょうどで聞いている');
  eq(CLEAN.timeIssues(mk('09:14'), {}).length, 1, '14分で聞いていない');
  eq(CLEAN.timeIssues(mk('09:14'), {})[0].type, 'too-short');
});

T('★時刻★ 退勤が出勤より前（その日の最初が退勤）', () => {
  const rev = [{ id: 'o', at: '2026-08-17T07:00', kind: 'out' }, p('2026-08-17T09:00', 'in', 'i')];
  const iss = CLEAN.timeIssues(rev, { today: TODAY });
  ok(iss.some((x) => x.type === 'out-before-in'), JSON.stringify(iss.map((x) => x.type)));
  ok(/07:00 の退勤が 09:00 の出勤より前/.test(iss.filter((x) => x.type === 'out-before-in')[0].text));
});

T('★時刻★ ★「合っている」と答えた物は 二度と聞かない★（印は種類ごと）', () => {
  const long = [p('2026-08-17T08:00', 'in', 'a'), p('2026-08-18T21:00', 'out', 'b')];
  eq(CLEAN.timeIssues(long, { today: '2026-08-19' }).length, 1);
  const answered = long.map((x) => (x.id === 'b' ? Object.assign({}, x, { ok_types: ['too-long'] }) : x));
  eq(CLEAN.timeIssues(answered, { today: '2026-08-19' }).length, 0, '★答えたのに まだ聞いている★');
  const other = long.map((x) => (x.id === 'b' ? Object.assign({}, x, { ok_types: ['too-short'] }) : x));
  eq(CLEAN.timeIssues(other, { today: '2026-08-19' }).length, 1, '★別の種類まで黙らせている★');
});

T('★時刻★ 夜勤（22:00→翌05:00）は 聞かない／0:00・23:59 も 聞かない', () => {
  const night = [p('2026-08-17T22:00', 'in', 'a'), p('2026-08-18T05:00', 'out', 'b')];
  eq(CLEAN.timeIssues(night, { today: '2026-08-19' }).length, 0, '夜勤を おかしいと言っている');
  /* ★日の端の時刻そのもの★は 何も起こさない（0:00 始まり・23:59 終わりでも 8時間なら聞かない） */
  const edge1 = [p('2026-08-17T00:00', 'in', 'a'), p('2026-08-17T08:00', 'out', 'b')];
  const edge2 = [p('2026-08-17T15:59', 'in', 'a'), p('2026-08-17T23:59', 'out', 'b')];
  eq(CLEAN.timeIssues(edge1, { today: TODAY }).length, 0, '0:00 始まりで聞いている');
  eq(CLEAN.timeIssues(edge2, { today: TODAY }).length, 0, '23:59 終わりで聞いている');
  /* ★0:00〜23:59（1439分）は 聞く★＝退勤の打ち忘れの典型（黙って24時間にしない） */
  const allDay = [p('2026-08-17T00:00', 'in', 'a'), p('2026-08-17T23:59', 'out', 'b')];
  eq(CLEAN.timeIssues(allDay, { today: TODAY }).length, 1, '★丸1日を黙って通している★');
});

T('★時刻★ 「お願い中」と本記録が同じ日／取り消した行 の扱い', () => {
  const mixed = [p('2026-08-17T09:00', 'in', 'a'),
    { id: 'b', at: '2026-08-17T09:05', kind: 'out', src: 'calendar', pending: true }];
  eq(CLEAN.timeIssues(mixed, { today: TODAY }).length, 1, 'お願い中を見ていない');
  eq(CLEAN.timeIssues([mixed[0]], { today: TODAY }).length, 0, '取り消した後（渡らない）で聞いている');
});

T('★時刻★ 直す候補を先に出す（★空欄を出さない★）', () => {
  const hist = [p('2026-08-10T09:00', 'in'), p('2026-08-11T09:00', 'in'), p('2026-08-17T08:00', 'in', 'x')];
  const c = CLEAN.fixCandidates(hist, { at: '2026-08-17T08:00', kind: 'in' }, { nowHm: '14:30' });
  eq(c[0].hm, '09:00'); eq(c[0].why, 'いつもの時刻');
  ok(c.some((x) => x.hm === '07:45'), JSON.stringify(c));
  ok(c.some((x) => x.hm === '08:15'), JSON.stringify(c));
  ok(c.some((x) => x.hm === '14:30'), JSON.stringify(c));
  ok(!c.some((x) => x.hm === '08:00'), '元の時刻を候補に出している');
  const thin = CLEAN.fixCandidates([p('2026-08-10T07:00', 'in')], { at: '2026-08-17T08:00', kind: 'in' }, {});
  ok(!thin.some((x) => x.why === 'いつもの時刻'), '1回だけの物を「いつもの」と言っている');
  console.log('     実測: ' + c.map((x) => x.hm + '(' + x.why + ')').join(' / '));
});

T('★時刻★ 直しても ★元の打刻は1文字も動かない★（使わない印＋新しい時刻のお願い）', () => {
  /* 直した後の姿＝元は voided（読む側が外す）／新しい時刻は お願い中で入る */
  const after = [p('2026-08-17T08:00', 'in', 'a'),
    { id: 'n', at: '2026-08-17T20:45', kind: 'out', src: 'calendar', pending: true }];
  const d = dayOf(sum(after), '2026-08-17');
  eq(d.inAt, '2026-08-17T08:00', '元の出勤が動いている');
  eq(CLEAN.timeIssues(after, { today: TODAY, dayStdMin: 480 }).length, 0, '直した後も まだ聞いている');
});

T('★時刻★ ★決められない日には 時刻の確かめを積み上げない★（先に決める事が1つ）', () => {
  /* 08/17 は「08:00 は出勤か退勤か」が先。ここで「17:03 の退勤が 21:44 の出勤より前」を
     一緒に聞くと ★同じ日に質問が3つ★になる（実データで捕まえた） */
  const iss = CLEAN.timeIssues(REAL_0817, { today: TODAY, dayStdMin: 480 });
  eq(iss.length, 0, '★決められない日に 時刻の確かめまで出している★: ' + JSON.stringify(iss.map((x) => x.text)));
  eq(dayOf(sum(REAL_0817), '2026-08-17').asks.length, 2, 'その日の聞く事は 2つのまま');
});

/* ── (6) ★決まりは1つ★（2026-08-18 夜3 司さん「シンプルイズベストでやらして」）
   ★自分の打刻は 自分で直せる・消せる。締めた後はできない★
   ＝人が覚える言葉は「直す・消す・足す」の3つだけ（お願い・承認・申請は画面に出さない）。 */
T('★決まり★ 締めていない間は ★直せる・消せる・足せる★（会社を待たない）', () => {
  eq(CLEAN.canFix({ state: 'open' }).ok, true);
  eq(CLEAN.canFix({ state: 'pending' }).ok, true, '★締め待ちで 止めている★');
  eq(CLEAN.canFix({ state: 'open' }).why, '');
});

T('★決まり★ ★締めた後は できない★（理由は1つの言葉で出す）', () => {
  eq(CLEAN.canFix({ state: 'closed' }).ok, false);
  eq(CLEAN.canFix({ state: 'closed' }).why, '締めたので直せません。会社に言ってください');
  console.log('     実測: 開いている/締め待ち=直せる ／ 締めた=' + CLEAN.canFix({ state: 'closed' }).why);
});

T('★決まり★ 紙とCSVの備考に ★誰が直したか★が残る（null分→null分 と刷らない）', () => {
  const d = { fixes: [{ status: 'approved', beforeMin: null, afterMin: null, requestedBy: 'employee' }] };
  eq(CSV.note(d), '本人が直しました');
  const d2 = { fixes: [{ status: 'approved', beforeMin: null, afterMin: null, requestedBy: 'owner' }] };
  eq(CSV.note(d2), '会社が直しました');
  ok(!/null/.test(CSV.note(d)), '★null分→null分 と刷っている★');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
