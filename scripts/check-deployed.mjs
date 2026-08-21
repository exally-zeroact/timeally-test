/* check-deployed.mjs — ★push した物が 本当に配信に乗ったかを数える★（Timeally）
 * =============================================================================
 * なぜ要るのか（2026-08-21 本番投入で分かった）:
 *   ★「push 済み・CI 緑」は 客に届いた事ではない★。合図が届かずビルドが始まらないと、
 *   配信は前の版のまま居座る。だから ★配信を1回 数える★までが 投入の手順。
 *
 * ★この道具に アプリの名前・画面の名前を書かない★（2026-08-22 指示役）
 *   ＝借り物（exally の check-deployed-version.mjs）は ★向こうの画面名を持っていた★ので、
 *     Timeally では「無い物を探して 404」と言い続けた。★repo を見て 自分で見つける★。
 *     ・画面 … repo の直下の *.html を全部
 *     ・部品 … その HTML が読んでいる 相対パスの src= / href=（外のCDN・フォントは触らない）
 *
 * 数える事は3つだけ:
 *   ① 画面が 200 で返るか
 *   ② ★配信の印（?v=）が 手元の中身から作った印と同じか★（＝古い版が居座っていないか）
 *   ③ ★その画面が読む部品が 配信に実在するか★（遅れて読む物も含めて 404 が0件か）
 *
 * ★叩くのは 1本につき1回だけ★（叩き続けると Vercel が 403 で自分のテスト環境を止める）。
 * ★叩いた回数を最後に出す★（報告にそのまま書けるように）。
 *
 * 使い方:
 *   node scripts/check-deployed.mjs                       … js/supa-config.js の env で URL を決める
 *   node scripts/check-deployed.mjs --url https://…       … 配信先を指で渡す
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stampOf } from './stamp-build.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : ''; };

/* ★配信先は 環境から決める★（repo 名を環境の証拠にしない）
   env は js/supa-config.js の1本だけが持っている（この repo の決まり）。 */
function siteUrl() {
  const given = argOf('--url');
  if (given) return given.replace(/\/+$/, '');
  const src = fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
  const env = (/env:\s*'([^']+)'/.exec(src) || [])[1] || '';
  if (env === 'prod') return 'https://timeally.vercel.app';
  if (env === 'test') return 'https://timeally-test.vercel.app';
  throw new Error('env が読めません（--url で配信先を渡してください）');
}

const screens = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();
/* 画面が読んでいる相対パス（?v= は落とす）。★外のCDN・フォントは数えない★（うちの配信ではない） */
const RE = /\b(?:src|href)="((?!https?:|\/\/|#|mailto:|data:)[^"]+?)(?:\?v=[0-9a-f]{7,8})?"/g;
const parts = new Set();
for (const f of screens) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  let m;
  while ((m = RE.exec(html))) {
    if (/\.html$/i.test(m[1])) continue;          // 画面どうしのリンクは 画面の方で数える
    parts.add(m[1].replace(/^\.\//, ''));
  }
}

const site = siteUrl();
const stamp = stampOf();
let hits = 0, ng = 0;
const say = (good, msg) => { console.log((good ? '  ✓ ' : '  ✗ ') + msg); if (!good) ng++; };

async function get(rel) {
  hits++;
  const r = await fetch(site + '/' + rel, { redirect: 'follow' });
  const text = /\.(html|js|css|json|svg)$/i.test(rel) ? await r.text() : '';
  return { status: r.status, text };
}

console.log(`\n[配信の見張り] ${site}`);
console.log(`  手元の印 ${stamp}（画面 ${screens.length}枚 / 部品 ${parts.size}本）`);

for (const f of screens) {
  const r = await get(f);
  say(r.status === 200, `${f} … ${r.status}`);
  if (r.status !== 200) continue;
  /* ★配信の印が 手元と同じか★＝違えば「push はしたが 配信は前の版」 */
  const got = [...new Set([...r.text.matchAll(/\?v=([0-9a-f]{7,8})/g)].map((m) => m[1]))];
  say(got.length === 1 && got[0] === stamp,
    `${f} … 配信の印 ${got.join(' / ') || 'なし'}（手元 ${stamp}）`);
}
for (const rel of [...parts].sort()) {
  const r = await get(rel + '?v=' + stamp);
  say(r.status === 200, `${rel} … ${r.status}`);
}

console.log(`\n  叩いた回数 ${hits}回（1本につき1回）`);
if (ng) {
  console.log(`★${ng}件 合っていません★（配信が前の版のまま／部品が配信に無い）`);
  process.exit(1);
}
console.log('★全部 合っています（配信＝手元）★');
