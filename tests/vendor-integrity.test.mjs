/* vendor-integrity.test.mjs — ★借りてきた物を、こちらで書き換えていないか★（Timeally）
 * =============================================================================
 * ★ここで守れるのは「こちらで勝手に直していない」ことだけ★
 *   出どころ側（exally-prod / payslip-app）が変わったかは このrepoからは分からない。
 *   ⇒ ★給与の受け口(kintai-csv.js)を触った日は VENDOR.md を作り直す★（そう書いてある）
 *
 * 印は ★git の blob ハッシュ★（git hash-object と同じ計算）。
 *   ファイルの中身だけで決まるので、置き場所や日付では変わらない。
 *
 * 使い方: node tests/vendor-integrity.test.mjs
 *         node tests/vendor-integrity.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★VENDOR.md の表と同じ物★（片方だけ直すと ここで赤くなる） */
export const VENDOR = {
  'js/file-out.js': 'c7d8a926a29b82c932f796165691ce81380dd440',
  'lib/qr.js': 'df13f829bf41f36b82f0ed85751ed3b4c39cfeb8',
  'lib/xlsx.full.min.js': '21471af69ef0e4cda1613c2702c54101b92f48d2',
  'tests/vendor/kintai-csv.js': '49799e050a449fb9f55a7686894d6053b50867cc',
};

/** git の blob ハッシュ（"blob <長さ>\0" + 中身 の sha1） */
export function blobHash(buf) {
  const h = crypto.createHash('sha1');
  h.update('blob ' + buf.length + '\0');
  h.update(buf);
  return h.digest('hex');
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

if (process.argv.includes('--self-test')) {
  console.log('\n[vendor-integrity --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  S('① 1バイト足したら印が変わる', () => {
    const buf = fs.readFileSync(path.join(ROOT, 'js/file-out.js'));
    ok(blobHash(buf) === VENDOR['js/file-out.js'], '★本物の印が合っていない★');
    ok(blobHash(Buffer.concat([buf, Buffer.from(' ')])) !== VENDOR['js/file-out.js'], '作り物で変わらない＝空振り');
  });
  S('② 空のファイルの印は git の既知の値と一致する（計算が正しい）', () => {
    ok(blobHash(Buffer.alloc(0)) === 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', '計算が git と違う');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[借りてきた物]');

T('★4本すべてが 出どころと1バイトも違わない', () => {
  const bad = [];
  for (const [rel, want] of Object.entries(VENDOR)) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { bad.push(rel + ' が無い'); continue; }
    const got = blobHash(fs.readFileSync(p));
    if (got !== want) bad.push(rel + ' → ' + got + '（表は ' + want + '）');
  }
  ok(bad.length === 0, bad.join('\n   - '));
  console.log('     実測: ' + Object.keys(VENDOR).length + '本すべて一致');
});

T('★VENDOR.md にも同じ印が書いてある（片方だけ直すと赤）', () => {
  const md = fs.readFileSync(path.join(ROOT, 'VENDOR.md'), 'utf8');
  for (const [rel, want] of Object.entries(VENDOR)) {
    ok(md.indexOf(want) >= 0, rel + ' の印が VENDOR.md に無い');
    ok(md.indexOf(rel) >= 0, rel + ' が VENDOR.md に無い');
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
