/* clock-travel.mjs — ★時計を進めて 試験を丸ごと走らせる★（Timeally）
 * =============================================================================
 * 使い方:
 *   node scripts/clock-travel.mjs                       … 決めた日を全部（既定の4つ）
 *   node scripts/clock-travel.mjs 2026-10-01T00:05:00   … その日だけ
 *
 * ★見るのは2つ★
 *   ① 赤が0本か
 *   ② ★通った本数が 減っていないか★（緑だけ見ない＝拾われずに「空振りで緑」を作らない。
 *      アマかせが 実際に踏んだ穴）
 *
 * ★この道具は 読むだけ★（倉庫も配信も触らない）。Date だけを差し替えて 試験を走らせる。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* ★Windows の書き方で渡す★（/c/... の形だと node が見つけられない＝1回 空振りした） */
/* NODE_OPTIONS の中では 円記号が消える（1回 空振りした）
   ⇒ スラッシュに直して渡す（node は どちらでも読める）。 */
const PRELOAD = path.resolve(ROOT, 'scripts', 'fake-clock.cjs')
  .split(String.fromCharCode(92)).join('/');

/* ★節目だけ選ぶ★（月替わり・年替わり・うるう年＝落ちるならここ） */
const DAYS = process.argv[2] ? [process.argv[2]] : [
  '2026-10-01T00:05:00',   // 月替わり
  '2026-11-01T00:05:00',   // 月替わり
  '2027-01-01T00:05:00',   // 年替わり
  '2028-02-29T00:05:00',   // ★うるう年の2月29日★
];

function run(iso) {
  const r = spawnSync(process.execPath, ['tests/run.js'], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, FAKE_NOW: iso, TA_FAKE_NOW: iso, NODE_OPTIONS: `--require "${PRELOAD}"` },
  });
  const out = (r.stdout || '') + (r.stderr || '');
  const green = (out.match(/✓/g) || []).length;
  /* ★減った時に「何が」減ったかを言えるように 名前で持つ★
     （数だけ見ると ★静かに減った★のに気づけない＝一番 危ない） */
  const names = out.split(String.fromCharCode(10)).filter((l) => l.indexOf('✓') >= 0)
    .map((l) => l.replace(/^\s*✓\s*/, '').trim());
  const red = (out.match(/✗/g) || []).length;
  const last = (out.trim().split('\n').pop() || '').trim();
  return { iso, green, red, last, names, ok: r.status === 0, out };
}

/* ★まず 道具が本当に効いているか★（子の中の「今日」を出させる＝空振りしていない証拠） */
const probe = spawnSync(process.execPath, ['-e', 'console.log(new Date().toISOString())'], {
  encoding: 'utf8',
  env: { ...process.env, FAKE_NOW: DAYS[0], TA_FAKE_NOW: DAYS[0], NODE_OPTIONS: `--require "${PRELOAD}"` },
});
const probed = (probe.stdout || '').trim();
console.log('[clock-travel] 子の中の「今日」… ' + (probed || '★出ない★')
  + '（頼んだ日 ' + DAYS[0] + '）');
/* ★道具が効いていないまま走らせない★（緑でも赤でも 意味が無い） */
/* ★出るのは UTC の字★（頼んだ日はJSTの壁時計）＝★時刻の数で見比べる★
   （字だけ見て「違う」と言うと 9時間ずれて 毎回 空振りに見える＝1回 踏んだ） */
const wantMs = new Date(DAYS[0]).getTime();
const gotMs = Date.parse(probed);
if (!probed || Math.abs(gotMs - wantMs) > 60 * 1000) {
  console.log('★時計を差し替えられていません★（この道具が空振りしています）');
  console.log((probe.stderr || '').slice(0, 300));
  process.exit(1);
}

const rows = [];
for (const iso of DAYS) {
  const r = run(iso);
  rows.push(r);
  console.log(`\n──── ${iso}`);
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.last}`);
  console.log(`  通った ${r.green}本 ／ 赤 ${r.red}本`);
  if (!r.ok) {
    console.log(r.out.split('\n').filter((l) => /✗/.test(l)).slice(0, 12).map((l) => '   ' + l).join('\n'));
  }
}

/* ★本数が減っていないか★（1日目を基準に見る） */
const base = rows[0].green;
const shrank = rows.filter((r) => r.green < base);
console.log('\n════ まとめ');
rows.forEach((r) => console.log(`  ${r.iso.slice(0, 10)} … ${r.ok ? 'OK' : '★NG★'} ／ 通った ${r.green}本`));
if (shrank.length) {
  console.log('★本数が減っている日が あります★（拾われていない試験が在る可能性）:');
  shrank.forEach((r) => {
    console.log(`   ${r.iso.slice(0, 10)} … ${r.green}本（基準 ${base}本）`);
    /* ★減った物を 名前で出す★（「9本 減った」で終わらせない） */
    const have = new Set(r.names);
    const missing = rows[0].names.filter((n) => !have.has(n));
    missing.slice(0, 12).forEach((n) => console.log('      無い: ' + n.slice(0, 70)));
    if (missing.length > 12) console.log('      …ほか ' + (missing.length - 12) + '件');
  });
}
const ng = rows.filter((r) => !r.ok).length + shrank.length;
console.log(ng ? `\n★${ng}件 赤★` : '\n★どの日でも 緑・本数も減っていません★');
process.exit(ng ? 1 : 0);
