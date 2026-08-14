/* home-icon.test.mjs — ★ホーム画面に入れた時のアイコンと名前★（Timeally）
 * =============================================================================
 * 司さんの指示（2026-08-14）: ★ホーム画面にインストールしたら このアイコンになるように★
 *
 * ここで止めたい事故:
 *   ① ★アイコンのファイルが無い / 参照だけ在る★ … ホーム画面が白い四角になる
 *   ② ★正方形でない / 大きさが違う★           … iOS/Android が拒む・ぼやける
 *   ③ ★1画面でも apple-touch-icon が抜ける★   … その画面から追加した人だけ白いまま
 *   ④ ★★従業員の画面に manifest を付ける★★
 *        … manifest の start_url（index.html）が ★リンクの ?t=… を捨てる★。
 *          従業員がホーム画面から開くと ★社長のログイン画面に飛ぶ★。
 *          だから ★manifest を付けてよいのは社長の画面だけ★。
 *   ⑤ ホーム画面から開いた時に ★ファイルが同じ窓で開いて戻れなくなる★
 *        … 渡し口が target="_blank" を付けている事（ios-unsupported でも見ている）
 *
 * 使い方: node tests/home-icon.test.mjs
 *         node tests/home-icon.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const OWNER_PAGES = ['index.html', 'shukei.html', 'login.html'];
export const EMPLOYEE_PAGES = ['punch.html', 'kiroku.html'];
export const ICONS = {
  'icons/apple-touch-icon.png': 180,
  'icons/icon-192.png': 192,
  'icons/icon-512.png': 512,
  'icons/maskable-512.png': 512,
  'icons/favicon-32.png': 32,
};

/** PNGの幅と高さ（IHDR を読むだけ。ライブラリを足さない） */
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** ★PNGの四隅の色を実際に読む★（「白の余白が無い」を思い込みで済ませない）
 *  8bit の RGB / RGBA・非インターレースだけ読む（うちが作る物はこれ）。 */
export function pngCorners(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const depth = buf[24], color = buf[25], interlace = buf[28];
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) return null;
  const ch = color === 6 ? 4 : 3;
  let p = 8, idat = [];
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[q++];
    const line = raw.subarray(q, q + stride); q += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0, v = line[i];
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = v + a;
      else if (f === 2) r = v + b;
      else if (f === 3) r = v + ((a + b) >> 1);
      else { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      cur[i] = r & 0xff;
    }
  }
  const at = (x, y) => {
    const i = y * stride + x * ch;
    return '#' + [out[i], out[i + 1], out[i + 2]].map((v) => ('0' + v.toString(16)).slice(-2)).join('').toUpperCase();
  };
  return [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

if (process.argv.includes('--self-test')) {
  console.log('\n[home-icon --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  S('① PNGの大きさを読めている（読めなければ検査が空振り）', () => {
    const s = pngSize(fs.readFileSync(path.join(ROOT, 'icons/icon-192.png')));
    ok(s && s.w === 192 && s.h === 192, '実測: ' + JSON.stringify(s));
    ok(pngSize(Buffer.from('not a png')) === null, 'PNGでない物を通している');
  });
  S('② 従業員の画面に manifest を足した作り物を捕まえる（★?t= が捨てられる★）', () => {
    const bad = '<link rel="manifest" href="manifest.json" />';
    ok(/rel="manifest"/.test(bad), '作り物が判定できない＝この検査が空振り');
    EMPLOYEE_PAGES.forEach((p) => ok(!/rel="manifest"/.test(read(p)), '★本物の ' + p + ' に manifest が付いている★'));
  });
  S('③ start_url が index.html である（＝従業員に付けたら本当に飛ばされる）', () => {
    const m = JSON.parse(read('manifest.json'));
    ok(m.start_url === 'index.html', 'start_url: ' + m.start_url);
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[ホーム画面のアイコン]');

T('★アイコンの絵が実在して、正方形で、大きさが合っている', () => {
  const bad = [];
  for (const [rel, size] of Object.entries(ICONS)) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { bad.push(rel + ' が無い'); continue; }
    const s = pngSize(fs.readFileSync(p));
    if (!s) { bad.push(rel + ' がPNGとして読めない'); continue; }
    if (s.w !== size || s.h !== size) bad.push(rel + ' が ' + s.w + '×' + s.h + '（' + size + '×' + size + 'のはず）');
  }
  ok(bad.length === 0, bad.join(' / '));
  console.log('     実測: ' + Object.keys(ICONS).length + '枚すべて正方形・寸法どおり');
});

/* ★司さんの指示（2026-08-14）★「アイコンいっぱいに 白の余白がないように」
   ⇒ 四隅を ★実際に読んで★ 面の色である事を確かめる（見た目の思い込みで済ませない）。
   色は ★元の絵から拾った値★（承認済みのUI配色とは別物＝これは司さんが渡した絵）。 */
export const FACE = '#FBCD06';

T('★★アイコンの四隅に白い余白が無い（端まで面の色で埋まっている）★★', () => {
  const bad = [];
  for (const rel of Object.keys(ICONS)) {
    const corners = pngCorners(fs.readFileSync(path.join(ROOT, rel)));
    if (!corners) { bad.push(rel + ' の画素を読めない'); continue; }
    corners.forEach((c, i) => {
      if (c !== FACE) bad.push(rel + ' の隅' + (i + 1) + ' が ' + c + '（' + FACE + 'のはず）');
    });
  }
  ok(bad.length === 0, bad.join(' / '));
  console.log('     実測: ' + Object.keys(ICONS).length + '枚 × 四隅 = '
    + (Object.keys(ICONS).length * 4) + '点すべて ' + FACE + '（白 0点）');
});

T('★全部の画面に apple-touch-icon が入っている（1画面でも抜けたら そこから追加した人が白い四角）', () => {
  const files = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();
  const miss = files.filter((f) => read(f).indexOf('icons/apple-touch-icon.png') < 0);
  ok(miss.length === 0, '抜けている画面: ' + miss.join(', '));
  console.log('     実測: ' + files.length + '画面すべてに入っている');
});

T('★★従業員の画面に manifest を付けない（付けると ?t=… が捨てられて社長の画面へ飛ぶ）★★', () => {
  const bad = EMPLOYEE_PAGES.filter((f) => /rel="manifest"/.test(read(f)));
  ok(bad.length === 0, '★' + bad.join(', ') + ' に manifest が付いている★');
  const has = OWNER_PAGES.filter((f) => /rel="manifest"/.test(read(f)));
  ok(has.length === OWNER_PAGES.length, '社長の画面に manifest が無い: '
    + OWNER_PAGES.filter((f) => has.indexOf(f) < 0).join(', '));
  console.log('     実測: 社長 ' + has.length + '画面に在り / 従業員 ' + EMPLOYEE_PAGES.length + '画面に無し');
});

T('★manifest が読めて、アイコンの行が実物を指している', () => {
  const m = JSON.parse(read('manifest.json'));
  ok(m.name && m.short_name, '名前が無い');
  ok(m.short_name.length <= 12, 'short_name が長い（ホーム画面で切れる）: ' + m.short_name);
  ok(m.display === 'standalone', 'display が standalone でない');
  ok(m.start_url === 'index.html', 'start_url が index.html でない');
  ok(Array.isArray(m.icons) && m.icons.length >= 3, 'icons が足りない');
  m.icons.forEach((i) => {
    ok(fs.existsSync(path.join(ROOT, i.src)), '実物が無い: ' + i.src);
    const s = pngSize(fs.readFileSync(path.join(ROOT, i.src)));
    ok(i.sizes === s.w + 'x' + s.h, i.src + ' の sizes が実物(' + s.w + 'x' + s.h + ')と違う: ' + i.sizes);
  });
  ok(m.icons.some((i) => i.purpose === 'maskable'), '★maskable が無い（Androidで枠が切れる）★');
});

T('★色が承認済みのもの（帯とスプラッシュ）', () => {
  const m = JSON.parse(read('manifest.json'));
  ok(m.theme_color === '#FFC72C', 'theme_color: ' + m.theme_color);
  ok(m.background_color === '#FFFBF0', 'background_color: ' + m.background_color);
  const files = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f));
  const miss = files.filter((f) => !/name="theme-color" content="#FFC72C"/.test(read(f)));
  ok(miss.length === 0, 'theme-color が無い画面: ' + miss.join(', '));
});

T('★ホーム画面から開いても戻れなくならない（渡し口が target="_blank"）', () => {
  ok(/a\.target = '_blank'/.test(read('js/file-out.js')), '渡し口に target="_blank" が無い');
});

T('★アイコンと manifest も ?v= の材料に入っている（差し替えた日に古いまま出ない）', () => {
  const src = read('scripts/stamp-build.mjs');
  ok(/'icons'/.test(src), 'icons が材料に入っていない');
  ok(/manifest\.json/.test(src), 'manifest.json が材料に入っていない');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
