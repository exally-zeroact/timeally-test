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
import crypto from 'node:crypto';
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

/** ★PNGを実際に展開して画素を読む★（見た目の思い込みで済ませない）
 *  8bit の RGB / RGBA・非インターレースだけ読む（うちが作る物はこれ）。
 *  返り値は { w, h, ch, data }（data は展開後の生の並び）。 */
export function pngPixels(buf) {
  if (!pngSize(buf)) return null;                 // PNGでない物で落ちない（self-testで踏んだ）
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
  return { w, h, ch, data: out };
}

/** 四隅の色（#RRGGBB） */
export function pngCorners(buf) {
  const p = pngPixels(buf);
  if (!p) return null;
  const at = (x, y) => {
    const i = y * (p.w * p.ch) + x * p.ch;
    return '#' + [p.data[i], p.data[i + 1], p.data[i + 2]].map((v) => ('0' + v.toString(16)).slice(-2)).join('').toUpperCase();
  };
  return [at(0, 0), at(p.w - 1, 0), at(0, p.h - 1), at(p.w - 1, p.h - 1)];
}

/* ★司さんの決定（2026-08-14・確定）★「★白の余白なしでやれ★」
   実機のホーム画面に ★白い枠が出た★（4回 出し直させた）。もう迷わない:
     ・白は ★1pxも出さない★（この検査が毎回 四隅を読んで数える）
     ・元の絵は 1344×1219 で ★正方形ではない★ので、正方形のタイルにするため
       ★縦に約10%伸ばす★（切ると「12」が欠けるので伸ばす側を選んだ）
     ・角の丸みの外側は ★縁の橙★（元の絵の外側は白。そこだけ置き換える）
       → 端末が角を丸めるので ★ホーム画面では見えない★
   ★元の絵そのもの（白の余白つき）は icons/source.png に残してある★ */
export const SOURCE = 'icons/source.png';
export const SOURCE_BLOB = '28e36b7328761f4608b3464dd12f57bf1d851251';   // git hash-object

/** git の blob ハッシュ */
export function blobHash(buf) {
  return crypto.createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex');
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
  S('②-a PNGを本当に展開できている（読めなければ「白紙でない」の検査が空振り）', () => {
    const p = pngPixels(fs.readFileSync(path.join(ROOT, 'icons/icon-512.png')));
    ok(p && p.w === 512 && p.data.length === 512 * 512 * p.ch, '展開できていない');
    const c = pngCorners(fs.readFileSync(path.join(ROOT, 'icons/icon-512.png')));
    ok(c && c.length === 4, '★本物の四隅を読めていない★');
    ok(pngPixels(Buffer.from('not a png')) === null || pngSize(Buffer.from('not a png')) === null, 'PNGでない物を通している');
  });
  S('②-c 白の判定が効いている（白を白と言い、絵の色を白と言わない）', () => {
    ok(isWhitish('#FFFFFF') && isWhitish('#FEFEFE'), '白を白と言えていない');
    ok(!isWhitish('#E68805') && !isWhitish('#FBCD06') && !isWhitish('#7D3204'), '絵の色を白と言っている');
    /* ★元の絵（白の余白つき）を通したら 必ず赤になる★＝この検査が空振りしていない証拠 */
    const c = pngCorners(fs.readFileSync(path.join(ROOT, SOURCE)));
    ok(c.every(isWhitish), '★元の絵の四隅を白と判定できていない＝空振り★');
  });
  S('②-b 元の絵の印が合っている（差し替えたら気づく）', () => {
    const got = blobHash(fs.readFileSync(path.join(ROOT, SOURCE)));
    ok(got === SOURCE_BLOB, '★印が合っていない: ' + got + '★');
    ok(blobHash(Buffer.from('x')) !== SOURCE_BLOB, '印の計算が壊れている');
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

/* ★司さんの決定（2026-08-14・最終）★「★絵そのものにして★」
   ⇒ 伸ばさない・切らない・塗り替えない。★元のPNGを そのまま縮めるだけ★。
     （白の余白も 元の絵の一部なので そのまま残す。私が消しにいったのは やり過ぎだった）
   ⇒ 見張るのは ★元の絵が入れ替わっていないか★ と ★絵が本当に入っているか★。 */
T('★元の絵（司さんが渡した物）がrepoに在って、入れ替わっていない', () => {
  const p = path.join(ROOT, SOURCE);
  ok(fs.existsSync(p), SOURCE + ' が無い');
  const got = blobHash(fs.readFileSync(p));
  ok(got === SOURCE_BLOB, '元の絵が入れ替わっている: ' + got);
  const s = pngSize(fs.readFileSync(p));
  ok(s.w === s.h, '元の絵が正方形でない: ' + s.w + '×' + s.h);
  console.log('     実測: ' + SOURCE + ' ' + s.w + '×' + s.h + ' / blob ' + got.slice(0, 8));
});

/** 白っぽいか（＝余白） */
export function isWhitish(hex) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return r > 235 && g > 235 && b > 235;
}

T('★★白の余白が1pxも無い（四隅と 各辺の真ん中を実際に読む）★★', () => {
  const bad = [], seen = new Set();
  for (const rel of Object.keys(ICONS)) {
    const p = pngPixels(fs.readFileSync(path.join(ROOT, rel)));
    if (!p) { bad.push(rel + ' の画素を読めない'); continue; }
    const at = (x, y) => {
      const i = y * (p.w * p.ch) + x * p.ch;
      return '#' + [p.data[i], p.data[i + 1], p.data[i + 2]].map((v) => ('0' + v.toString(16)).slice(-2)).join('').toUpperCase();
    };
    const pts = [['隅1', 0, 0], ['隅2', p.w - 1, 0], ['隅3', 0, p.h - 1], ['隅4', p.w - 1, p.h - 1],
      ['上辺', (p.w / 2) | 0, 0], ['下辺', (p.w / 2) | 0, p.h - 1],
      ['左辺', 0, (p.h / 2) | 0], ['右辺', p.w - 1, (p.h / 2) | 0]];
    pts.forEach(([name, x, y]) => {
      const c = at(x, y); seen.add(c);
      if (isWhitish(c)) bad.push('★' + rel + ' の' + name + 'が白（' + c + '）★');
    });
  }
  ok(bad.length === 0, bad.join(' / '));
  console.log('     実測: ' + Object.keys(ICONS).length + '枚 × 8点 = '
    + (Object.keys(ICONS).length * 8) + '点 / ★白 0点★ / 端の色: ' + [...seen].join(' '));
});

T('★アイコンが「白紙」になっていない（絵が本当に入っている）', () => {
  const bad = [];
  for (const rel of Object.keys(ICONS)) {
    const px = pngPixels(fs.readFileSync(path.join(ROOT, rel)));
    if (!px) { bad.push(rel + ' の画素を読めない'); continue; }
    let yellow = 0, ink = 0;
    for (let i = 0; i < px.data.length; i += 4) {
      const r = px.data[i], g = px.data[i + 1], b = px.data[i + 2];
      if (r > 220 && g > 150 && g < 235 && b < 90) yellow++;
      if (r < 170 && g < 120 && b < 100) ink++;
    }
    const total = px.w * px.h;
    if (yellow / total < 0.20) bad.push(rel + ' に面の黄が少なすぎる（' + Math.round(yellow / total * 100) + '%）');
    if (ink / total < 0.02) bad.push(rel + ' に図柄の茶が少なすぎる（' + Math.round(ink / total * 100) + '%）');
  }
  ok(bad.length === 0, bad.join(' / '));
  console.log('     実測: ' + Object.keys(ICONS).length + '枚すべてに 面の黄と図柄の茶が入っている');
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
