/* nuri-check.test.mjs — ★画面にかぶせる物を 濃い色で ベタ塗りしていないか★（Timeally）
 * =============================================================================
 * ★司さん 2026-09-10★「全アプリでこんな濃い色使うなって言うてなかったか？」
 *   → 白地＋左に アプリの色の帯 に直した形を見て ★「絶対これがええ」★
 *   → 「他のアプリで 前みたいな重たい感じになってる所あったら 先に直せ」
 *
 * ★うちに 実際に 在りました★
 *   `.tc-toast` … `background:#2B2418`（明るさ 37／alpha 1）＝★画面に 濃い塊が 浮いていた★
 *   ★Exally が `#toast` / `.toast` の字で探した時は 見つかりませんでした★（うちは `.tc-toast`）
 *   ⇒★★字で探すと 漏れる。色は ★値に直して★ 比べる★★
 *
 * ここで見る物:
 *   ① position が fixed/absolute の規則の 塗り（background）を ★値に直して★ 明るさを出す
 *      ★明るさ = 0.299R+0.587G+0.114B が 170未満 かつ alpha 0.5以上★ なら 赤
 *   ② ★薄い覆いは 赤にしない★（alpha < 0.5）＝狼少年にしない
 *   ③ ★押す物（ボタン）は 免除★。ただし ★名指し＋理由★を ここに書く（黙って外さない）
 *   ④ ★塗りをやめた知らせには 帯が要る★（白地だけだと どこが知らせか 分からない）
 *
 * 使い方: node tests/nuri-check.test.mjs ／ node tests/nuri-check.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KURAI = 170;   /* 明るさの境目（Exally の手本と 同じ数） */
const KOI = 0.5;     /* これ以上の alpha は「ベタ塗り」 */

/* ★免除＝押す物だけ／★名指しで 理由を書く★（黙って外さない）★ */
export const MENJO = {
  '.tc-btn.tc-primary':
    '押す物（ボタン）＝面で 押せる事を 見せる物。知らせではない。戻す条件＝知らせに 使い回した時。',
};

const NAMED = {
  black: [0, 0, 0, 1], white: [255, 255, 255, 1], red: [255, 0, 0, 1], green: [0, 128, 0, 1],
  navy: [0, 0, 128, 1], gray: [128, 128, 128, 1], grey: [128, 128, 128, 1],
  darkgreen: [0, 100, 0, 1], teal: [0, 128, 128, 1], maroon: [128, 0, 0, 1],
  purple: [128, 0, 128, 1], transparent: [0, 0, 0, 0],
};

/** ★書き方が違っても 同じ値に直す★（#abc／#aabbcc／#aabbccdd／rgb()／rgba()／名前） */
export function toRGBA(v) {
  const s = String(v).trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length >= 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    if (p.length < 3 || p.some((x) => Number.isNaN(x))) return null;
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  }
  return NAMED[s] || null;
}
export const akarusa = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

export function files() {
  const out = fs.readdirSync(ROOT).filter((f) => /\.html$/.test(f));
  for (const f of fs.readdirSync(path.join(ROOT, 'css'))) if (/\.css$/.test(f)) out.push('css/' + f);
  return out;
}

/** ★かぶせる規則（fixed/absolute）で 濃くベタ塗りしている所★を 値で数える */
export function sagasu(src, rel) {
  const deta = [];
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().split('\n').pop().trim();
    const body = m[2];
    if (!/position\s*:\s*(fixed|absolute)/i.test(body)) continue;
    if (MENJO[sel]) continue;
    for (const bg of [...body.matchAll(/background(?:-color)?\s*:\s*([^;]+)/gi)].map((x) => x[1])) {
      for (const c of bg.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|[a-z]+/g) || []) {
        const q = toRGBA(c);
        if (!q) continue;
        if (q[3] >= KOI && akarusa(q) < KURAI) {
          deta.push({ rel, sel, iro: c, akarusa: Math.round(akarusa(q)), alpha: q[3] });
        }
      }
    }
  }
  return deta;
}

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

if (process.argv.includes('--self-test')) {
  console.log('\n[nuri-check --self-test] ★わざと 濃く塗って 赤になるか★');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };
  const tsukuru = (bg) => '.x{position:fixed;background:' + bg + ';}';
  S('①4通りの書き方を 同じ値に直す（#abc／#aabbcc／rgb()／rgba()）', () => {
    ok(JSON.stringify(toRGBA('#000')) === JSON.stringify([0, 0, 0, 1]), '#abc が直せない');
    ok(JSON.stringify(toRGBA('#2B2418')) === JSON.stringify([43, 36, 24, 1]), '#aabbcc が直せない');
    ok(JSON.stringify(toRGBA('rgb(43,36,24)')) === JSON.stringify([43, 36, 24, 1]), 'rgb() が直せない');
    ok(toRGBA('rgba(43,36,24,.9)')[3] === 0.9, 'rgba() の alpha が直せない');
  });
  S('②4通りとも ★同じ1件★として 捕まえる（字ではなく 値で見ている）', () => {
    for (const bg of ['#2B2418', 'rgb(43,36,24)', 'rgba(43,36,24,1)', 'rgba(43, 36, 24, .9)']) {
      ok(sagasu(tsukuru(bg), 'x').length === 1, '捕まえられない: ' + bg);
    }
  });
  S('③薄い覆い（alpha 0.4）は ★赤にしない★（狼少年にしない）', () => {
    ok(sagasu(tsukuru('rgba(0,0,0,.4)'), 'x').length === 0, '薄い覆いを 赤にしている');
  });
  S('④白地は 赤にしない', () => {
    ok(sagasu(tsukuru('#FFFFFF'), 'x').length === 0, '白を 赤にしている');
  });
  S('⑤かぶせない規則（position 無し）は 見ない', () => {
    ok(sagasu('.y{background:#2B2418;}', 'x').length === 0, 'かぶせない物まで 見ている');
  });
  S('⑥免除は ★名指し＋理由（20字以上）＋戻す条件★が 書いてある', () => {
    for (const [k, why] of Object.entries(MENJO)) {
      ok(why && why.length >= 20, k + ': 理由が短い');
      ok(/戻す条件/.test(why), k + ': 戻す条件が無い');
    }
  });
  S('⑦★免除に 逃げていない★（知らせの類を 免除に入れていない）', () => {
    const nige = Object.keys(MENJO).filter((k) => /toast|snack|notice|alert|知らせ/i.test(k));
    ok(nige.length === 0, '★知らせを 免除に 入れている★: ' + nige.join(', '));
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[かぶせる物を 濃くベタ塗りしていないか]');

const zenbu = [];
let kisoku = 0;
for (const rel of files()) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  kisoku += [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => /position\s*:\s*(fixed|absolute)/i.test(m[2])).length;
  zenbu.push(...sagasu(src, rel));
}

T('★かぶせる物に 濃いベタ塗りが 無い（明るさ170未満・alpha0.5以上）', () => {
  console.log('     実測: かぶせる規則 ' + kisoku + '個 ／ 免除 ' + Object.keys(MENJO).length
    + '個（理由つき）／★濃いベタ塗り ' + zenbu.length + '個★');
  for (const d of zenbu) console.log('       ★濃い★ ' + d.rel + ' … ' + d.sel + ' … ' + d.iro
    + '（明るさ ' + d.akarusa + '／alpha ' + d.alpha + '）');
  ok(zenbu.length === 0, '濃いベタ塗り: ' + zenbu.map((d) => d.sel + ' ' + d.iro).join(', '));
});

/* ★塗りをやめた知らせには 帯が要る★（白地だけだと どこが知らせか 分からない）
   ★数を 焼き込まない★＝「知らせの規則が 在れば その中に 帯が 在る」で見る */
T('★知らせ（.tc-toast）は 白地＋左に アプリの色の帯', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/timeally.css'), 'utf8');
  const m = /\.tc-toast\s*\{([^}]*)\}/.exec(css);
  ok(m, '.tc-toast が 無い');
  const b = m[1];
  const bg = toRGBA((/background(?:-color)?\s*:\s*([^;]+)/i.exec(b) || [])[1] || '');
  ok(bg && akarusa(bg) >= 200, '★白地では ありません★');
  const obi = /border-left\s*:\s*(\d+)px\s+solid\s+([^;]+)/i.exec(b);
  ok(obi, '★左の帯が 有りません★（白地だけだと どこが知らせか 分からない）');
  ok(Number(obi[1]) >= 3, '帯が 細すぎます: ' + obi[1] + 'px');
  const iro = toRGBA(obi[2].trim());
  ok(iro && akarusa(iro) < 235, '帯の色が 薄すぎます（白地に 見えません）');
  ok(/text-align\s*:\s*left/i.test(b), '★左寄せに なっていません★');
  console.log('     実測: 地 ' + Math.round(akarusa(bg)) + '（明るいほど白）／帯 '
    + obi[1] + 'px ' + obi[2].trim() + '（明るさ ' + Math.round(akarusa(iro)) + '）');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
