/* tc-csv.test.mjs — ★給与への合格条件を、繋ぐ前に確かめる★（Timeally）
 * =============================================================================
 * ★合格条件は1行★:
 *   「出したCSVを kintai-csv.js に食わせて rows が期待どおり」
 *
 * ★受け取る側の本物を実際に走らせる★（読んで正しそう、では終わらせない）。
 *   tests/vendor/kintai-csv.js は exally-prod の実物を1バイトも変えずに置いた物。
 *   出どころと同一である事は tests/vendor-integrity.test.mjs が別に数える。
 *
 * ここで止めたい事故:
 *   ① ★見出しを変えて、受け取る側が黙って null になる★（0ではなく null＝列が無い）
 *   ② ★小数時（160.5）で出して1分単位の原本と食い違う★
 *   ③ ★BOMが無くてExcelで化ける／改行が混ざって行が壊れる★
 *   ④ ★氏名が無い行が黙って捨てられる★（kintai-csv は氏名が空の行を落とす）
 *
 * 使い方: node tests/tc-csv.test.mjs
 *         node tests/tc-csv.test.mjs --self-test
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const CSV = require_(path.join(ROOT, 'lib/tc-csv.js'));
const C = require_(path.join(ROOT, 'lib/tc-calc.js'));
const NAME = require_(path.join(ROOT, 'lib/tc-name.js'));
/* ★受け取る側の本物★ */
const KINTAI = require_(path.join(ROOT, 'tests/vendor/kintai-csv.js'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

const P = (at, kind) => ({ at, kind, src: 'punch' });

/* ★作り物の数字を並べない。実際に summarize() を通した結果をCSVにする★
   （偽データで測ると偽データ自体が嘘をつく。本番と同じ経路を通す） */
function realMonth(punches, company) {
  return C.summarize({ ym: '2026-08', punches, shifts: [], fixes: [], company: company || {} }).month;
}

console.log('\n[tc-csv] 給与への受け口（kintai-csv.js に実際に食わせる）');

T('★出したCSVを kintai-csv.js が読めて、9つの列を全部 認識する', () => {
  const m = realMonth([
    P('2026-08-03T09:00', 'in'), P('2026-08-03T12:00', 'break_in'),
    P('2026-08-03T13:00', 'break_out'), P('2026-08-03T20:30', 'out'),
  ]);
  const text = CSV.monthlyCsv([{ no: 'E001', name: '山田 太郎', month: m }]);
  const r = KINTAI.parse(text);
  eq(r.warnings.length, 0, '受け取る側が文句を出した: ' + r.warnings.join(' / '));
  ['name', 'no', 'shukkin', 'kekkin', 'yukyu', 'worked', 'ot', 'night', 'holiday'].forEach((f) => {
    ok(r.recognized.indexOf(f) >= 0, '★' + f + ' の列を認識していない★（見出しを変えた？）');
  });
  eq(r.rows.length, 1);
});

T('★1分単位が1分も狂わずに渡る（"H:MM" で出す）', () => {
  // 9:00-20:30 は拘束690分。休憩60分 ⇒ ★実労働 630分（10時間30分）★／法定外残業 150分
  const m = realMonth([
    P('2026-08-03T09:00', 'in'), P('2026-08-03T12:00', 'break_in'),
    P('2026-08-03T13:00', 'break_out'), P('2026-08-03T20:30', 'out'),
  ]);
  eq(m.workedMin, 630); eq(m.otMin, 150);
  const row = KINTAI.parse(CSV.monthlyCsv([{ no: 'E001', name: '山田 太郎', month: m }])).rows[0];
  eq(row.workedMin, 630, '★実労働が1分でもズレたら給与が狂う★');
  eq(row.otMin, 150);
  eq(row.name, '山田 太郎');
  eq(row.no, 'E001');
  eq(row.shukkin, 1);
});

T('★半端な分（1分・59分）も往復して同じ数になる', () => {
  [1, 59, 61, 599, 601].forEach((min) => {
    const text = CSV.monthlyCsv([{ name: 'A', month: { shukkin: 1, kekkin: 0, yukyu: 0, workedMin: min, otMin: 0, nightMin: 0, holidayMin: 0 } }]);
    eq(KINTAI.parse(text).rows[0].workedMin, min, min + '分が往復で変わった');
  });
});

T('★★月60時間超・休日深夜の列を足しても 元の9列の割り当てが1つも動かない★★', () => {
  const m = { shukkin: 20, kekkin: 0, yukyu: 1, workedMin: 12000, otMin: 4200,
    ot60Min: 600, nightMin: 600, holidayMin: 480, holidayNightMin: 120 };
  const r = KINTAI.parse(CSV.monthlyCsv([{ no: 'E1', name: '山田 太郎', month: m }]));
  eq(r.warnings.length, 0, '受け取る側が文句を出した: ' + r.warnings.join(' / '));
  eq(JSON.stringify(r.map), JSON.stringify({ no: 0, name: 1, shukkin: 2, kekkin: 3, yukyu: 4, worked: 5, ot: 6, night: 8, holiday: 9 }),
    '★列を足したせいで 元の割り当てがズレた★: ' + JSON.stringify(r.map));
  const row = r.rows[0];
  eq(row.workedMin, 12000); eq(row.otMin, 4200); eq(row.nightMin, 600); eq(row.holidayMin, 480);
});

T('★★今の給与は「時間外60時間超」「休日深夜」を読まない（列は渡るが捨てられる）★★', () => {
  /* ★これは「壊れている」のではなく「まだ受け取る側に置き場が無い」★
     ・列が無ければ そもそも渡せないので、こちらは先に足してある
     ・★給与(Kyually)に「この列を読む」を足すのは 指示役が出す★（片方だけにしない）
     ★給与側が読めるようになった日、この検査は赤くなる★
       → その時は tests/vendor/kintai-csv.js を取り直して、ここを「読める」に書き換える。
         ★赤くなる事が 合図★（黙って通り過ぎない） */
  const heads = CSV.MONTHLY_HEADERS;
  eq(heads.indexOf('時間外60時間超'), 7, '列の位置が変わった');
  eq(heads.indexOf('休日深夜'), 10, '列の位置が変わった');
  const m = { workedMin: 12000, otMin: 4200, ot60Min: 600, holidayMin: 480, holidayNightMin: 120 };
  const r = KINTAI.parse(CSV.monthlyCsv([{ name: 'A', month: m }]));
  const used = Object.values(r.map);
  ok(!used.includes(7), '★給与が60超の列を読めるようになった＝この検査を書き換える時★');
  ok(!used.includes(10), '★給与が休日深夜の列を読めるようになった＝この検査を書き換える時★');
  /* ただし ★中身は出ている★（人とExcelは読める） */
  const line = CSV.monthlyCsv([{ name: 'A', month: m }]).split('\r\n')[1].split(',');
  eq(line[7], '10:00', '60超の中身が出ていない');
  eq(line[10], '2:00', '休日深夜の中身が出ていない');
  console.log('     実測: 60超と休日深夜は ★CSVに出ているが 今の給与は読まない★');
});

/* ★★列の順番を固定する★★（2026-08-22 指示役■5・実物で追った結果）
   ＝受け取る側 kintai-csv.js は ★先に出てきた見出しが勝つ★（idx[f] が null の時だけ入れる）。
     そして 見出しの判定は ★/深夜/ を /休日/ より先に見る★。
   ⇒★もし「休日深夜」が「深夜労働」より前に来たら、深夜の値が 休日深夜の値に化ける★
     （★警告は0のまま★＝黙って間違う。★#ERRORより黙って小さくなる方が危ない★の型）。
   ⇒ 私（Timeally）がやる事は2つだけ … ★2列は出し続ける★ ／ ★順番を変えない★。
     受け口を直すのは 給与(Rakually)＝指示役が持つ。 */
T('★★列の順番を変えない（時間外→60超／深夜→休日深夜 の順）★★', () => {
  const h = CSV.MONTHLY_HEADERS;
  ok(h.indexOf('時間外労働') < h.indexOf('時間外60時間超'),
    '★60超が 時間外より前に来た★（先に出た方が勝つので 時間外の値が化ける）');
  ok(h.indexOf('深夜労働') < h.indexOf('休日深夜'),
    '★休日深夜が 深夜労働より前に来た★（深夜の値が 休日深夜に化ける）');
  /* ★この検査が空振りしていない事を その場で見せる★＝入れ替えた見本を作って 化けるのを実測 */
  const m = { workedMin: 12000, otMin: 4200, ot60Min: 600, nightMin: 300, holidayMin: 480, holidayNightMin: 120 };
  const good = KINTAI.parse(CSV.monthlyCsv([{ name: 'A', month: m }])).rows[0];
  eq(good.nightMin, 300, '★今の順番なのに 深夜が正しく渡っていない★');
  const swapped = ['氏名,休日深夜,深夜労働', 'A,2:00,5:00', ''].join(String.fromCharCode(13, 10));
  const bad = KINTAI.parse(swapped);
  eq(bad.rows[0].nightMin, 120, '★入れ替えても化けない＝この検査は空振り★');
  eq(bad.warnings.length, 0, '★化けたのに警告が出た（前提が変わった＝読み直す）★');
  console.log('     実測: 今の順番 深夜 5:00→300分 ／ 入れ替えた見本 深夜が ★2:00→120分★ に化ける（警告0）');
});

T('★深夜・休日・有給・欠勤も そのまま渡る', () => {
  const m = realMonth([
    P('2026-08-03T21:00', 'in'), P('2026-08-04T02:00', 'out'),   // 深夜4時間
    P('2026-08-09T09:00', 'in'), P('2026-08-09T15:00', 'out'),   // 日曜=法定休日6時間
  ], { holidayMode: 'dow', legalHolidayDow: 0 });   // ★法定休日を「日」と決めている会社★（既定は「決めていない」）
  const row = KINTAI.parse(CSV.monthlyCsv([{ name: 'B', month: m }])).rows[0];
  eq(row.nightMin, 240); eq(row.holidayMin, 360);
});

T('★何人でも1人1行で渡る（人数が減らない）', () => {
  const people = ['あ', 'い', 'う', 'え', 'お'].map((n, i) => ({
    no: 'E' + i, name: n,
    month: { shukkin: 20, kekkin: 0, yukyu: 1, workedMin: 9600 + i, otMin: i, nightMin: 0, holidayMin: 0 },
  }));
  const r = KINTAI.parse(CSV.monthlyCsv(people));
  eq(r.rows.length, 5, '★人が減っている★');
  eq(r.rows[4].workedMin, 9604);
});

T('★氏名が空の人は 出す前に気づけるようにする（受け取る側は黙って捨てる）', () => {
  const r = KINTAI.parse(CSV.monthlyCsv([{ no: 'E1', name: '', month: { shukkin: 1, workedMin: 480 } }]));
  eq(r.rows.length, 0, '受け取る側の振る舞い（＝氏名が空だと消える）を固定する');
  // ⇒ 画面側は「氏名が未入力の人がいます」と出してから書き出す（tests/ui-sweep.mjs で押して確かめる）
});

T('★Excelで開けるように BOM ＋ CRLF（受け取る側はどちらでも読める）', () => {
  const text = CSV.monthlyCsv([{ name: 'A', month: { workedMin: 60 } }]);
  eq(text.charCodeAt(0), 0xFEFF, 'BOMが無い（Excelで日本語が化ける）');
  ok(text.indexOf('\r\n') > 0, 'CRLFが無い');
  eq(KINTAI.parse(text).rows[0].name, 'A', 'BOM付きでも受け取る側が読める');
});

T('★カンマや引用符が入った氏名でも列がズレない', () => {
  const text = CSV.monthlyCsv([{ name: '山田, 太"郎', month: { shukkin: 3, workedMin: 480 } }]);
  const row = KINTAI.parse(text).rows[0];
  eq(row.name, '山田, 太"郎');
  eq(row.shukkin, 3, '★列がズレている★');
});

/* ── 日ごとの明細（社長側） ─────────────────────────────────────── */
T('★日ごとの明細に「中抜け」「所定超」「法定外残業」の列がある（混ぜない）', () => {
  ['中抜け', '所定内', '所定超', '法定外残業', '深夜', '休日', '備考'].forEach((h) => {
    ok(CSV.DAILY_HEADERS.indexOf(h) >= 0, h + ' の列が無い');
  });
});
T('★備考に「直した記録（元は何分か）」が残る', () => {
  const n = CSV.note({ fixes: [{ beforeMin: 480, afterMin: 510, reason: '打刻漏れ', status: 'approved' }], srcs: [] });
  ok(/480分→510分/.test(n), '元の分数が残っていない: ' + n);
  ok(/打刻漏れ/.test(n), '理由が残っていない');
});
T('★承認されていない申請は 備考に「直し」として出さない（未承認を確定扱いにしない）', () => {
  const n = CSV.note({ fixes: [{ beforeMin: 480, afterMin: 510, reason: 'x', status: 'pending' }], srcs: [] });
  eq(n, '', '未承認が確定として出ている: ' + n);
});
T('★切り捨てた分は備考に必ず出る（黙って消さない）', () => {
  ok(/切り捨て 9分/.test(CSV.note({ cutMin: 9, srcs: [] })));
});

/* ── 推奨ファイル名 ─────────────────────────────────────────────── */
T('★保存名は中身から作る（空欄を並べない・落とせない文字を残さない）', () => {
  eq(NAME.build({ kind: '勤怠', company: '山田/商事:株', person: '', ym: '2026-08', count: 5, stamp: '20260814_1530' }, 'csv'),
    '勤怠_山田-商事-株_2026-08_全5名_20260814_1530.csv');
  eq(NAME.build({}, 'csv'), '勤怠.csv', '空でも「_.csv」を作らない');
  ok(NAME.build({ company: '㈱テスト①' }, 'pdf').indexOf('(株)テスト(1)') >= 0, '機種依存文字が開かれていない');
  ok(!/[\\/:*?"<>|]/.test(NAME.build({ company: 'a\\b/c:d*e?f"g<h>i|j' }, 'csv')), '落とせない文字が残っている');
});

/* ── self-test：わざと壊して赤になるか ───────────────────────────── */
if (process.argv.includes('--self-test')) {
  console.log('\n[tc-csv --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('① 見出しを勝手な言葉に変えると 受け取る側が読めなくなる（本物の見出しは読める）', () => {
    const bad = '出勤時間合計,名前だけ\r\n100:00,A\r\n';
    const r1 = KINTAI.parse(bad);
    ok(r1.recognized.indexOf('worked') < 0, '作り物が読めてしまう＝この検査が空振り');
    const good = KINTAI.parse(CSV.monthlyCsv([{ name: 'A', month: { workedMin: 6000 } }]));
    ok(good.recognized.indexOf('worked') >= 0, '★本物の見出しを受け取る側が読めない★');
  });
  S('⑤ 列の順番を入れ替えた作り物では 深夜が化ける（本物の順番では化けない）', () => {
    const swapped = ['氏名,休日深夜,深夜労働', 'A,2:00,5:00', ''].join(String.fromCharCode(13, 10));
    eq(KINTAI.parse(swapped).rows[0].nightMin, 120, '作り物が化けない＝この検査が空振り');
    const m = { workedMin: 6000, nightMin: 300, holidayNightMin: 120 };
    eq(KINTAI.parse(CSV.monthlyCsv([{ name: 'A', month: m }])).rows[0].nightMin, 300,
      '★本物の順番で 深夜が化けている★');
  });
  S('② 小数時で出すと1分単位が崩れる（本物は "H:MM" なので崩れない）', () => {
    const decimal = '氏名,労働時間\r\nA,8.01\r\n';
    eq(KINTAI.parse(decimal).rows[0].workedMin, 481, '作り物が崩れていない＝この検査が空振り');
    const text = CSV.monthlyCsv([{ name: 'A', month: { workedMin: 481 } }]);
    eq(KINTAI.parse(text).rows[0].workedMin, 481, '★本物が1分単位を崩している★');
    ok(/8:01/.test(text), '★"H:MM" で出していない★');
  });
  S('③ BOMを外すと Excelで化ける（本物は付いている）', () => {
    const noBom = CSV.monthlyCsv([{ name: 'A', month: {} }]).slice(1);
    ok(noBom.charCodeAt(0) !== 0xFEFF, '作り物にBOMが残っている＝この検査が空振り');
    eq(CSV.monthlyCsv([{ name: 'A', month: {} }]).charCodeAt(0), 0xFEFF, '★本物にBOMが無い★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
