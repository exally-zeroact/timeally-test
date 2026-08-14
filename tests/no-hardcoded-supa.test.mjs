/* no-hardcoded-supa.test.mjs — ★倉庫の向き先を、決められた1ファイル以外に書かせない★（Timeally）
 * =============================================================================
 * なぜ必要か（前科・2026-08-07 に Exally で作られた見張りをそのまま持ってきた）:
 *   テスト用の接続先を直書きした道具が、スナップショットに付いてきて
 *   ★テストのつもりで本番倉庫を触った★。しかも ★片方だけ直して6日間そのまま★だった。
 *   ★片方だけ直すと必ずこうなる。だから機械で見張る。★
 *
 * ★このファイル自身に、本物のrefを1文字も書かない★
 *   refは ★repoから形で学ぶ★（URL https://xxxx.supabase.co と 鍵の中の ref は形で分かる）。
 *   限界も書いておく: どこにもURL/鍵の形で出てこない未知のrefを、裸の文字列としてだけ
 *   書かれた場合は捕まえられない。URL・鍵の形なら未知のrefでも捕まえる。
 *
 * 使い方: node tests/no-hardcoded-supa.test.mjs
 *         node tests/no-hardcoded-supa.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★向き先を持ってよいファイル（理由つき）★
   ★後から慌てて足す逃げ道にしない★。理由が書けない物は、直す側が正しい。 */
export const ALLOWED = {
  'js/supa-config.js':
    '★環境の分かれ目そのもの★。本番repo(timeally)=本番倉庫 / テストrepo(timeally-test)=DB-test。向き先を持つのはここだけ',
};

const EXT = new Set(['.js', '.mjs', '.html', '.json', '.yml', '.yaml']);
const SKIP_DIR = new Set(['node_modules', '.git', '.vercel']);

export function refsByShape(text) {
  const out = [];
  let m;
  const url = /https:\/\/([a-z0-9]{16,})\.supabase\.co/g;
  while ((m = url.exec(text))) out.push({ where: 'URL', ref: m[1] });
  const key = /"ref"\s*:\s*"([a-z0-9]{16,})"/g;
  while ((m = key.exec(text))) out.push({ where: '鍵', ref: m[1] });
  const jwt = /eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]{20,})\./g;
  while ((m = jwt.exec(text))) {
    try {
      const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
      const o = JSON.parse(Buffer.from(b + '='.repeat((4 - (b.length % 4)) % 4), 'base64').toString('utf8'));
      if (o && typeof o.ref === 'string') out.push({ where: '鍵(JWT)', ref: o.ref });
    } catch (_) { /* 読めない物は無視 */ }
  }
  return out;
}

export function knownRefs(files) {
  const s = new Set();
  for (const text of Object.values(files)) refsByShape(text).forEach((r) => s.add(r.ref));
  return [...s];
}

export function findViolations(files, allowed = ALLOWED) {
  const known = knownRefs(files);
  const out = [];
  for (const [rel, text] of Object.entries(files)) {
    if (allowed[rel]) continue;
    const hits = refsByShape(text);
    for (const ref of known) {
      const bare = new RegExp('\\b' + ref + '\\b', 'g');
      if (bare.test(text)) hits.push({ where: '裸の文字列', ref });
    }
    if (hits.length) out.push({ file: rel, refs: [...new Set(hits.map((h) => h.ref))], where: hits[0].where });
  }
  return out;
}

function collect() {
  const files = {};
  const walk = (rel) => {
    const dir = path.join(ROOT, rel);
    for (const f of fs.readdirSync(dir)) {
      if (SKIP_DIR.has(f)) continue;
      const p = path.join(dir, f);
      const r = rel ? path.posix.join(rel, f) : f;
      if (fs.statSync(p).isDirectory()) { walk(r); continue; }
      if (!EXT.has(path.extname(f))) continue;
      files[r] = fs.readFileSync(p, 'utf8');
    }
  };
  walk('');
  return files;
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };

if (process.argv.includes('--self-test')) {
  /* ★作り物のref（本物は1文字も書かない）。URLも組み立てて作る★
     （完成形をここに書くと、この見張り自身が自分に引っかかる） */
  const FAKE = 'aaaabbbbccccddddeeee';
  const OTHER = 'zzzzyyyyxxxxwwwwvvvv';
  const supaUrl = (r) => 'https://' + r + '.supabase' + '.co';
  const CONF = { 'js/supa-config.js': "url:'" + supaUrl(FAKE) + "'" };
  console.log('\n[no-hardcoded-supa] ★わざと壊して赤になるか★');
  T('直書きを1つ混ぜたら赤になる（URLの形）', () => {
    const v = findViolations({ ...CONF, 'js/tc-db.js': "const URL='" + supaUrl(FAKE) + "';" });
    if (v.length !== 1) throw new Error('捕まえられなかった: ' + JSON.stringify(v));
  });
  T('裸の文字列でも赤になる（PROD_REF = "…" の形）', () => {
    const v = findViolations({ ...CONF, 'scripts/x.mjs': `const PROD_REF = '${FAKE}';` });
    if (v.length !== 1) throw new Error('捕まえられなかった: ' + JSON.stringify(v));
  });
  T('★repoが1つも知らないrefでも、URL/鍵の形なら赤になる（未知の倉庫）', () => {
    const v = findViolations({ 'scripts/z.mjs': "const U='" + supaUrl(OTHER) + "';" });
    if (v.length !== 1) throw new Error('捕まえられなかった: ' + JSON.stringify(v));
  });
  T('鍵(JWT)の中に隠れていても赤になる', () => {
    const payload = Buffer.from(JSON.stringify({ iss: 'supabase', ref: FAKE, role: 'anon' })).toString('base64url');
    const v = findViolations({ 'scripts/y.mjs': "const K='eyJhbGciOiJIUzI1NiJ9." + payload + ".sig';" });
    if (v.length !== 1) throw new Error('捕まえられなかった: ' + JSON.stringify(v));
  });
  T('★理由つきで許した物は赤にしない（誤検知が出ない）', () => {
    const v = findViolations(CONF);
    if (v.length !== 0) throw new Error('誤検知: ' + JSON.stringify(v));
  });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

console.log('\n[no-hardcoded-supa] 倉庫の向き先が、決められたファイル以外に書かれていないか');
const files = collect();
const violations = findViolations(files);

T('★向き先を直書きしているファイルが無い（許した物を除く）', () => {
  if (violations.length) {
    throw new Error('直書きが見つかりました。接続先は js/supa-config.js だけが持つこと:\n'
      + violations.map((v) => `   - ${v.file}  [${v.where}]`).join('\n'));
  }
});
T('★許可リストの各行に理由が書いてある', () => {
  for (const [f, why] of Object.entries(ALLOWED)) {
    if (!why || why.length < 15) throw new Error(f + ': 理由が短すぎる');
  }
});
T('★許可リストが現実から離れていない（消えたファイルが残っていない）', () => {
  const dead = Object.keys(ALLOWED).filter((f) => !fs.existsSync(path.join(ROOT, f)));
  if (dead.length) throw new Error('実在しない: ' + dead.join(', '));
});
T('検査が空振りしていない（実際にファイルを読み、倉庫を1つ以上見つけている）', () => {
  if (Object.keys(files).length < 15) throw new Error('読めたファイルが少なすぎます: ' + Object.keys(files).length);
  if (!files['js/supa-config.js']) throw new Error('js/supa-config.js を読めていない＝見る場所が間違っている');
  if (knownRefs(files).length < 1) throw new Error('倉庫のrefを1つも見つけられていない＝拾い方が壊れている');
});

console.log('\n── 実測 ──');
console.log(`  見たファイル: ${Object.keys(files).length}本`);
console.log(`  このrepoが知っている倉庫: ${knownRefs(files).length}件`);
console.log(`  理由つきで許している: ${Object.keys(ALLOWED).length}本`);
console.log(`  ★直書き: ${violations.length}本★`);
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
