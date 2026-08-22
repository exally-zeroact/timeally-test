/* ★試験は 登録するまで 1本も走らない★ ＋ ★return の直後の改行は undefined を返す★
 * ─────────────────────────────────────────────────────────────
 *  ★このファイル1本で どのrepoでも動きます★（repo名・パス・アプリ名を 決め打ちしていません）
 *    置き場所 … <repoの好きな所>/scripts/tests-registered.mjs（置いた所から上へ .git を探して根を決める）
 *    走らせ方 … node scripts/tests-registered.mjs
 *               node scripts/tests-registered.mjs --self-test   ← ★わざと壊して赤になるか★
 *               node scripts/tests-registered.mjs --list         ← 数えるだけ（赤にしない）
 *    CIへの載せ方 … 上の2行を そのまま2ステップに入れる（★--self-test も必ず載せる★）
 *
 *  なぜ要るか（★同じ型を3回 踏んだ★）
 *    ① アマかせ … 見張り7本のうち ★2本しか回っていなかった★（2026-08-17）
 *    ② 決まり  … 新しい tests/ は ★CI＋見張り2つの3か所に登録するまで 1本も走らない★
 *    ③ Rakually … 試験11本が ci.yml に1行も無く、★走らせたら2件 赤★（2026-08-21）
 *                  その2件は「登録の直後に袋小路にしない」＝★客が入れなくなる穴★だった。
 *    ＝★「CI緑」は「試験が全部 走った」ではない★。在る試験と 走る試験を 突き合わせる。
 *
 *  ★見張り自身が 嘘をついた事が 4回ある（全部 直して 自己確認に入れた）★（2026-08-21）
 *    (a) CIの本文だけ読み、tests/run.js が中で走らせている4本を「走っていない」と言った
 *    (b) 自分が置いてある場所の repo を測り、★14repoで走らせて 14回とも同じ数★を返した
 *    (c) 走らせ役の名前だけ見て、vitest の ★拾う範囲★ を読まず、
 *        飲み屋で ★走っている9本を「走っていない」と赤にした（嘘の赤）★
 *        さらに直す途中で「vitest」の字が依存に在るだけで 既定の拾う範囲を当て、
 *        ★誰も走らせていない試験を「走っている」と言いかけた（嘘の緑）★
 *    (d) ★「名前がどこかに書いてあれば 走っている」にしていた（緩めすぎ）★
 *        exally-staging の kyuyo/tests/exally-login.test.mjs を名前で持っているのは
 *        tests/ci-coverage.test.mjs だけ。それは ★走らせる物ではなく「CIから外れた試験が
 *        無いか見張る物」★で、中の
 *            'kyuyo/tests/exally-login.test.mjs': { …戻す条件… }
 *        は ★除外リストの鍵★。それを「走っている」と読んで 131本/5本 → 142本/0本 にした。
 *        ⇒ ★実際に走らせている書き方か★で見る（下の collectExecuted）
 *           ○ node <path> ／ npx … <path> ／ execFile・spawn 等
 *             ／ ★走らせる物（exec を持つ file）の 一覧に載っている★
 *           ✕ 除外リストの鍵（'…': {…}）／覚書の中／ただの文字列の突き合わせ
 *           ★見分けが付かない時は 緑にせず「未測定」で赤★
 *
 *  ★拾う範囲まで読みます★
 *    vitest … vitest.config / vite.config の include・exclude・dir（無ければ vitest の既定）
 *    playwright … playwright.config の testDir・testMatch（無ければ既定）
 *    jest … jest.config の testMatch・roots（無ければ既定）
 *    ★どれも「本当に叩いている命令」（package.json の scripts と CI の run:）に在る時だけ見る★
 *    ★拾う範囲が 変数や関数で書いてあって読めない時は 緑にせず「未測定」で赤★
 *    ★走っていると分かった試験が 中で呼んでいる試験も 走っていると見る★
 *      （走っていない試験の中身は読まない＝そこから広げたら 嘘になる）
 *
 *  ★昔の嘘★（2026-08-21）
 *    ci.yml だけ読んで、tests/run.js が中で走らせている4本を「走っていない」と言った。
 *    ⇒ ★CIから呼ばれている「まとめて走らせる子」の中も読む★（下の registered()）。
 *
 *  ついでに見る物 … ★return の直後の改行★
 *    JS は ; を勝手に入れるので ★undefined を返す★。構文は正しいので lint も試験も気づかない。
 *      function f(){ return          ← ここで終わってしまう
 *        + '…'; }                    ← ここは 誰も通らない
 *    Rakually の直しの最中に 自分で1回 踏んだので、同じファイルで見る事にした。
 *
 *  ★見張り自身の 5つめの嘘（指示役が実物を開いて見つけた・2026-08-22）★
 *    (e) ★「子プロセスを起こす＝試験の一覧を持っている」と決めていた★
 *        ・nomiya scripts/compare-repos.mjs … execFileSync("git", […]) ＝叩いているのは ★git★
 *        ・exally-staging mobile-labels.test.mjs ほか … spawnSync(process.execPath, [★自分自身★])
 *          ＝★自己診断で 自分を1回 走らせているだけ★
 *        この4件を「一覧が読めない（未測定）」＝赤にしていた。★4件とも 嘘の赤★。
 *        ⇒ ★走らせている「先」まで見る★（runnerKind）
 *           ○ node / npx / process.execPath / fork で 何かを叩いている
 *           ○ require(f) / import(x) のように 変数を渡して読み込んでいる（＝一覧を順に走らせる形）
 *           ✕ git など ★別のexe★ を叩くだけ ／ ✕ ★自分自身★ を叩くだけ（自己診断）
 *
 *  ★出す形（2026-08-22）★ … ★1つの数にしない★
 *    「11件 直すまで進めない」と1つで出したので、★本物の赤1件と 道具の誤検知10件が 同じ顔★になり、
 *    受け取った側が「試験が11本 死んでいる」と読み違えた。⇒ 3行に分けて出す。
 *      1行目 在る試験 N本（走らせないと決めた／道具＝試験ではない）
 *      2行目 ★本物の赤★ … 登録していない試験・一覧の食い違い・undefined を返す return
 *      3行目 ★未測定★   … 拾う範囲や 走らせる一覧が 読めない
 *    ★どちらも赤にする★（未測定を緑にしない）。★数は分けて出す★。
 *
 *  走らせない試験の書き方（★黙って外さない★）
 *    repoの根に tests-no-ci.json を置く。★理由(why)と 戻す条件(back)が無い物は 赤★。
 *      { "tests/live-roundtrip.mjs": { "why": "本物の倉庫へつなぐ（鍵が要る）", "back": "CIに鍵を置いた日" } }
 *    ★tests/ に在る .mjs だから試験、と 名前で決めない★（指示役 2026-08-22）
 *    ★試験ではなく 手で走らせる道具★は "kind":"tool" と書く。
 *      { "tests/dbtest-seed.mjs": { "kind":"tool", "why": "種を撒く道具", "back": "確かめる試験にした日" } }
 *    道具は「走っていない試験」に数えない。★理由と戻す条件は 道具でも必須★。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ── repoの根を 自分で見つける（パスを決め打ちしない） ────────── */
function findRoot(from) {
  let d = from;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(d, '.git')) || fs.existsSync(path.join(d, '.github'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return from;
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = findRoot(HERE);

/* ★★この見張りは 自分が置いてある場所の repo を測ります★★（2026-08-21 指示役が踏んだ）
   14個の repo で走らせたら ★14回とも 同じ数（110本／0本）★ が出た。
   ＝★どの repo から走らせても、黙って「自分の家」を測って 緑を返していた★。
   ⇒ ① ★測った所を いちばん上に1行 出す★（見れば すぐ気づける）
      ② ★走らせた場所が 測った根の外なら 赤★（コピーせずに 外から走らせる使い方を塞ぐ）
   ⇒ ★使い方は「測りたい repo の中へ このファイルを1本 置いて、その repo の中で走らせる」★ */
function isInside(root, cwd) {
  const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  const r = path.relative(norm(root), norm(cwd));
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}
function whereLine(root) {
  return '測った所 … ' + path.resolve(root) + '（' + path.basename(path.resolve(root)) + '）';
}

const SKIP_FILE = 'tests-no-ci.json';
const SEP = String.fromCharCode(47);      /* /  */
const BS = String.fromCharCode(92);       /* 円記号（Windowsの区切り） */
const Q = String.fromCharCode(39);        /* '  */
const D = String.fromCharCode(34);        /* "  */
const NL = String.fromCharCode(10);

const rel = (root, p) => path.relative(root, p).split(BS).join(SEP);

/* ── 何を「試験」と見るか ──────────────────────────
   ★どのrepoでも同じ★＝「tests」という名前の入れ物の中の .mjs / .test.js。
   _ で始まる物は 部品（本体ではない）ので数えない。 */
const SKIPDIR = /^(node_modules|vendor|dist|build|coverage|worktrees?)$/;

function findTestDirs(root) {
  const out = [];
  const walk = (d, depth) => {
    if (depth > 6) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (SKIPDIR.test(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.name === 'tests' || e.name === 'test') out.push(p);
      else walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

function listTests(root) {
  /* ★tests の下の 入れ子も数える★（2026-08-21 tests/e2e/*.spec.js を1本も数えていなかった＝また網の穴） */
  const ok = (f) => /\.mjs$/.test(f) || /\.(test|spec)\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f);
  const out = [];
  const walk = (d, depth) => {
    if (depth > 4) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIPDIR.test(e.name)) continue;
        /* 見本や取り込む物を置く所は 試験ではない */
        if (/^(fixtures?|__snapshots__|data|golden|assets|helpers?|utils?)$/.test(e.name)) continue;
        walk(p, depth + 1); continue;
      }
      if (ok(e.name)) out.push(rel(root, p));
    }
  };
  for (const dir of findTestDirs(root)) walk(dir, 0);
  return out.sort();
}

/* ── 何を「走らせている」と見るか ────────────────────
   ★走らせ役の名前を読むだけでは 嘘をつく★（2026-08-21 指示役が飲み屋で踏んだ）
   飲み屋は "test": "vitest run" ＋ vitest.config.js の include に「tests の下の .test.js を全部」と書いてあり
   9本とも走っていたのに、この見張りは ★「9本 走っていない」と赤を出した★＝★嘘の赤★。
   ⇒ ★「拾う範囲」まで読む★ … vitest(include/exclude/dir) / playwright(testDir/testMatch) / jest。
   ⇒ ★読めない形の設定に当たったら 緑にせず「拾う範囲が読めません（未測定）」で赤★
      ＝★読めない物を「走っている」と決めない★ */

/* 星取り用の ごく小さい glob（** / * / ? / {a,b} / ?(a|b) だけ） */
function globToRe(g) {
  let re = '', i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 3; }
      else { re += '.*'; i += 2; }
      continue;
    }
    if (c === '*') { re += '[^/]*'; i++; continue; }
    if (c === '?' && g[i + 1] === '(') {            /* ?(c|m) ＝ 有っても無くてもよい */
      const end = g.indexOf(')', i);
      if (end < 0) { re += '\\?'; i++; continue; }
      re += '(?:' + g.slice(i + 2, end).split('|').map(esc).join('|') + ')?';
      i = end + 1; continue;
    }
    if (c === '@' && g[i + 1] === '(') {            /* @(spec|test) ＝ どれか1つ */
      const end = g.indexOf(')', i);
      if (end < 0) { re += '@'; i++; continue; }
      re += '(?:' + g.slice(i + 2, end).split('|').map(esc).join('|') + ')';
      i = end + 1; continue;
    }
    if (c === '{') {
      const end = g.indexOf('}', i);
      if (end < 0) { re += '\\{'; i++; continue; }
      re += '(?:' + g.slice(i + 1, end).split(',').map(esc).join('|') + ')';
      i = end + 1; continue;
    }
    if (c === '[') {                                 /* [jt] はそのまま使える */
      const end = g.indexOf(']', i);
      if (end < 0) { re += '\\['; i++; continue; }
      re += g.slice(i, end + 1); i = end + 1; continue;
    }
    if (c === '?') { re += '[^/]'; i++; continue; }
    re += esc(c); i++;
  }
  return new RegExp('^' + re + '$');
}
function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, (m) => '\\' + m); }

/* 設定ファイルから 一覧か1本の字を取り出す。取り出せない形なら null（＝読めない） */
function pickList(src, key) {
  const at = src.search(new RegExp('(^|[\\s,{])' + key + '\\s*:'));
  if (at < 0) return undefined;                       /* 書いていない＝既定を使う */
  const rest = src.slice(src.indexOf(':', at) + 1).replace(/^\s+/, '');
  if (rest[0] === '[') {
    const end = rest.indexOf(']');
    if (end < 0) return null;
    const body = rest.slice(1, end);
    if (/[`$]|\w\s*\(/.test(body)) return null;       /* 変数や関数が混ざる＝読めない */
    const out = [...body.matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
    return out.length ? out : null;
  }
  if (rest[0] === "'" || rest[0] === '"') {
    const q = rest[0], end = rest.indexOf(q, 1);
    return end < 0 ? null : [rest.slice(1, end)];
  }
  return null;                                        /* 変数を指している＝読めない */
}

const VITEST_DEFAULT = ['**/*.{test,spec}.?(c|m)[jt]s?(x)'];
const PW_DEFAULT = ['**/*.@(spec|test).?(c|m)[jt]s?(x)'];
const JEST_DEFAULT = ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'];

function findConfig(root, names) {
  for (const n of names) {
    for (const e of ['.js', '.mjs', '.cjs', '.ts', '.mts']) {
      const p = path.join(root, n + e);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/* 走らせ役ごとに「拾う範囲」を出す。unreadable が付いたら ★赤（未測定）★ */
function pickRanges(root, scriptsText) {
  const ranges = [];     /* {name, dir, include:[], exclude:[]} */
  const unreadable = [];

  const one = (name, cfgNames, keyInc, keyDir, def) => {
    if (!new RegExp('\\b' + name + '\\b').test(scriptsText)) return;
    const cfg = findConfig(root, cfgNames);
    if (!cfg) { ranges.push({ name: name + '（既定）', dir: '', include: def, exclude: [] }); return; }
    let src;
    try { src = fs.readFileSync(cfg, 'utf8'); }
    catch { unreadable.push(rel(root, cfg) + '（開けない）'); return; }
    const inc = pickList(src, keyInc);
    const dir = pickList(src, keyDir);
    const exc = pickList(src, 'exclude');
    if (inc === null || dir === null || exc === null) {
      unreadable.push(rel(root, cfg) + '（' + keyInc + '/' + keyDir + '/exclude が 変数や関数で書かれている）');
      return;
    }
    ranges.push({
      name: name + '（' + rel(root, cfg) + '）',
      dir: (dir && dir[0]) ? dir[0].replace(/^\.\//, '').replace(/\/$/, '') : '',
      include: inc || def, exclude: exc || [],
    });
  };

  one('vitest', ['vitest.config', 'vite.config'], 'include', 'dir', VITEST_DEFAULT);
  one('playwright', ['playwright.config'], 'testMatch', 'testDir', PW_DEFAULT);
  one('jest', ['jest.config'], 'testMatch', 'roots', JEST_DEFAULT);
  return { ranges, unreadable };
}

function coveredByRanges(ranges, relPath) {
  for (const r of ranges) {
    const base = r.dir ? r.dir + '/' : '';
    const p = relPath;
    if (base && !p.startsWith(base)) continue;
    const inner = base ? p.slice(base.length) : p;
    const hit = r.include.some((g) => globToRe(g).test(inner) || globToRe(g).test(p));
    if (!hit) continue;
    if (r.exclude.some((g) => globToRe(g).test(inner) || globToRe(g).test(p))) continue;
    return r.name;
  }
  return null;
}

/* ★「名前が出てくる」＝走っている ではない★（2026-08-21 指示役が exally-staging で踏んだ）
   exally-staging の kyuyo/tests/exally-login.test.mjs を名前で持っているのは
   tests/ci-coverage.test.mjs だけで、それは ★走らせる物ではなく「CIから外れた試験が無いか見張る物」★。
   その中の
       'kyuyo/tests/exally-login.test.mjs': { …戻す条件… }
   という ★除外リストの鍵★ を見つけて「走っている」と言い、131本/5本 → 142本/0本 にした＝★嘘の緑★。
   ⇒ ★実際に走らせている書き方か★で見る。
      ○ node <path> ／ npx … <path> ／ execFile・spawn 等で <path>
        ／ ★走らせる物（exec を持つ file）の中の 一覧に 載っている★
      ✕ 除外リストの鍵（'…': {…}）／覚書の中／ただの文字列の突き合わせ
   ⇒ ★見分けが付かない時は 緑にせず「走らせているか読めません（未測定）」で赤★ */

/* 覚書を取り除く（文字列の中は 消さない）。1本で持ち運ぶため ここに置く。 */
function stripComments(src) {
  let out = '', i = 0; const n = src.length;
  let q = null, last = '';
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (q) {
      if (c === BS) { out += c + (d || ''); i += 2; continue; }
      if (c === q) q = null;
      out += c; i++; continue;
    }
    if (c === Q || c === D || c === '`') { q = c; out += c; last = c; i++; continue; }
    if (c === '/' && d === '/') { while (i < n && src[i] !== NL) { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === NL ? NL : ' '; i++; }
      i += 2; continue;
    }
    out += c; if (!/\s/.test(c)) last = c; i++;
  }
  return out;
}

/* 文字列を すべて取り出す。★鍵（'…': ）は 走らせる物ではない★ので 印を付ける。 */
function literals(src) {
  const rx = new RegExp('([' + Q + D + '`])([^' + Q + D + '`]{1,300}?)' + BS + '1', 'g');
  const out = [];
  for (const m of src.matchAll(rx)) {
    const after = src.slice(m.index + m[0].length, m.index + m[0].length + 4);
    out.push({ v: m[2], at: m.index, isKey: /^\s*:/.test(after) });
  }
  return out;
}

const FILE_RX = /\.(mjs|cjs|js)$/;
/* ★「走らせる物（＝試験の一覧を持つ物）」かどうかの見分け★
   ─────────────────────────────────────────────────────────
   ★穴④（指示役が実物を開いて見つけた・2026-08-22）★
     昔は「子プロセスを起こしていれば 一覧を持っている」と決めていた。だから
       ・nomiya scripts/compare-repos.mjs   execFileSync("git", […]) ＝走らせているのは ★git★
       ・exally-staging mobile-labels.test.mjs ほか  spawnSync(process.execPath, [★自分自身★])
         ＝★自己診断で 自分を1回 走らせているだけ★
     を「一覧を持つ物」と読み、★一覧が読めない（未測定）＝赤★を4件 出した。★全部 嘘の赤★。
   ⇒ 今は ★走らせている先まで見る★
       ○ ★node / npx / process.execPath / fork★ で 何かを叩いている
       ○ require(f) / import(x) のように ★変数を渡して★ 読み込んでいる（＝一覧を順に走らせる形）
       ✕ ★git など 別のexe★ を叩いているだけ
       ✕ ★自分自身★ を叩いているだけ（import.meta.url / __filename / process.argv[1]）
       ✕ 除外リストの鍵（'…': {…}）／覚書の中／ただの文字列の突き合わせ
   ★require('assert') のような 決め打ちの読み込みは 数えない★
   （どのファイルにも在るので、数えると 除外リストの見張りまで「走らせる物」になってしまう） */
const EXEC_RX = /\b(execFileSync|execFile|execSync|spawnSync|spawn|fork)\s*\(/g;
const DYN_LOAD = /\b(require|import)\s*\(\s*[A-Za-z_$][\w$]*\s*[),.[]/;
const SELF_RX = /import\.meta\.url|__filename|process\.argv\[\s*1\s*\]/;
const NODE_BIN = /(^|[\\/])(node|node\.exe|npx|npx\.cmd)$/;

/* ( … ) の中を 釣り合いを見て取り出す（at は '(' の位置） */
function parenArgs(src, at) {
  let d = 0;
  for (let i = at; i < src.length && i < at + 4000; i++) {
    if (src[i] === '(') d++;
    else if (src[i] === ')') { d--; if (!d) return src.slice(at + 1, i); }
  }
  return src.slice(at + 1, at + 4000);
}

/* ★この道具の中では 正規表現に 引用符の字を書かない★（literals() が文字列と誤読する。
   2026-08-22 に私が1回 破って、★自分自身を「一覧が読めない」と言い出した★） */
const BT = String.fromCharCode(96);       /* `  */
const QUOTES = Q + D + BT;
const isQuote = (c) => QUOTES.indexOf(c) >= 0;
const unquote = (s) => (isQuote(s[0]) ? s.slice(1).replace(new RegExp('[' + QUOTES + ']$'), '') : s);

/* ★叩いている先が「今 調べているファイル自身」か★（＝自己診断）
   ★文字列で比べない。パスに直してから比べる★（指示役 2026-08-22・誤検知3件）
     spawnSync(process.execPath, [ path.join(__dirname, '自分と同じファイル名') ])
   という形は import.meta.url / __filename / process.argv[1] を1つも書かないので
   ★昔の 'self' 判定に入らず、一覧を持つ物として読んで「一覧が読めない」＝嘘の赤★ を3件 出した。
   （exally-staging mobile-labels.test.mjs:170 / grid-sort.test.mjs:211 / grid-freeze.test.mjs:307） */
const samePath = (a, b) => (process.platform === 'win32'
  ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  : path.resolve(a) === path.resolve(b));

function pointsAtSelf(args, absFile) {
  if (SELF_RX.test(args)) return true;                 /* 自分を指す言い回し */
  if (!absFile) return false;
  const dir = path.dirname(absFile);
  /* ★組み立てている先を パスに直して 自分と同じか見る★
     path.join(__dirname, 'x.mjs') ／ HERE + '/x.mjs' ／ './x.mjs' … どれも同じに扱う */
  for (const L of literals(args)) {
    if (L.isKey || !FILE_RX.test(L.v)) continue;
    const v = L.v.split(SEP).join(path.sep);
    if (samePath(path.resolve(dir, v), absFile)) return true;
    if (path.isAbsolute(v) && samePath(v, absFile)) return true;
  }
  return false;
}

/* 'runner' = 試験の一覧を持つ物 ／ 'self' = 自己診断だけ ／ 'other' = 別のexe・exec なし */
function runnerKind(src, absFile) {
  let runner = false, self = false;
  EXEC_RX.lastIndex = 0;
  let m;
  while ((m = EXEC_RX.exec(src))) {
    const fn = m[1];
    const args = parenArgs(src, m.index + m[0].length - 1);
    const first = (args.split(',')[0] || '').trim();
    const lit = unquote(first);
    /* fork は必ず node。execSync は命令の字ごと来るので 中の node/npx を見る */
    const nodeish = fn === 'fork'
      || /process\.execPath/.test(first)
      || NODE_BIN.test(lit)
      || (isQuote(first[0]) && /(^|[\s;&|])(node|npx)[\s]/.test(lit));
    if (!nodeish) continue;                                 /* ★git など 別のexe＝一覧ではない★ */
    if (pointsAtSelf(args, absFile)) { self = true; continue; } /* ★自分自身＝自己診断・一覧ではない★ */
    runner = true;
  }
  if (DYN_LOAD.test(src)) runner = true;               /* 変数を渡す読み込み＝一覧を順に走らせる形 */
  return runner ? 'runner' : (self ? 'self' : 'other');
}
const IMPORT_NEAR = /\b(import|require|from)\b[^\n]{0,40}$/;

/* 命令の字から「node/npx で叩いている物」を拾う */
function fromCommands(text) {
  const out = [];
  for (const m of text.matchAll(/(?:^|[\s;&|(])(?:node|npx)\s+((?:--?\S+\s+)*)([\w./@-]+\.(?:mjs|cjs|js))/g)) out.push(m[2]);
  return out;
}

/* ★走らせている物★を集める。unknown が付いたら 赤（未測定）。 */
function collectExecuted(root, cmds) {
  const runs = [];                 /* 走らせていると分かった書き方 */
  const unknown = [];
  const seen = new Set();
  const queue = [];

  fromCommands(cmds).forEach((p) => { runs.push(p); queue.push(p); });

  for (let depth = 0; depth < 3 && queue.length; depth++) {
    const now = queue.splice(0, queue.length);
    for (const rel0 of now) {
      const key = rel0.replace(/^\.\//, '');
      if (seen.has(key)) continue;
      seen.add(key);
      const abs = path.join(root, key);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      let src;
      try { src = stripComments(fs.readFileSync(abs, 'utf8')); } catch { continue; }

      /* ★走らせる物かどうか★＝走らせている先まで見る（穴④）。
         'self'（自分を1回 走らせるだけの自己診断）と 'other'（git など・exec なし）は
         ★一覧ではない★＝ここで黙って外して良い。★未測定にしない（嘘の赤を出さない）★ */
      if (runnerKind(src, abs) !== 'runner') continue;

      /* 中で叩いている物（node … の形） */
      fromCommands(src).forEach((p) => { runs.push(p); queue.push(p); });

      /* 一覧に載っている物（★鍵は数えない★） */
      const lits = literals(src).filter((L) => !L.isKey && FILE_RX.test(L.v));
      if (!lits.length) {
        unknown.push(key + ' … 走らせる物だが、走らせる一覧が 変数や組み立てで書かれていて 読めません');
        continue;
      }
      const dir = path.dirname(key);
      lits.forEach((L) => {
        const v = L.v.replace(/^\.\//, '');
        runs.push(v);
        const joined = (dir === '.' ? v : dir + SEP + v).split(SEP).filter((x) => x !== '.').join(SEP);
        runs.push(joined);
        queue.push(joined);
      });
    }
  }
  return { runs, unknown };
}

function hitsRun(runs, t) {
  const base = t.split(SEP).pop();
  return runs.some((r) => r === t || r === base || r.endsWith(SEP + base) || r.endsWith(SEP + t));
}

function registered(root) {
  const parts = [];
  const wf = path.join(root, '.github', 'workflows');
  if (fs.existsSync(wf)) {
    for (const f of fs.readdirSync(wf)) {
      if (/\.ya?ml$/.test(f)) parts.push(fs.readFileSync(path.join(wf, f), 'utf8'));
    }
  }
  const pkg = path.join(root, 'package.json');
  if (fs.existsSync(pkg)) parts.push(fs.readFileSync(pkg, 'utf8'));

  /* CIが名前を出している .js/.mjs は「まとめて走らせる子」かもしれない＝中も読む（1段だけ）。
     ★試験そのものは ここでは読まない★（走っていない試験の中の名前を「登録」と数えたら 嘘になる）。
     ★走っていると分かった試験の中身は 後で読む★（下の広げ方）。 */
  const head = parts.join(NL);
  const seen = new Set();
  for (const m of head.matchAll(/[\w./-]+\.(?:mjs|js)/g)) {
    const r = m[0];
    if (seen.has(r)) continue;
    seen.add(r);
    if (/(^|\/)tests?\//.test(r) && !/run\.(mjs|js)$/.test(r)) continue;
    const p = path.join(root, r);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) {
      try { parts.push(fs.readFileSync(p, 'utf8')); } catch { /* 読めない物は足さない */ }
    }
  }
  return parts.join(NL);
}

function loadSkip(root) {
  const p = path.join(root, SKIP_FILE);
  if (!fs.existsSync(p)) return { map: {}, bad: [] };
  let j;
  try { j = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return { map: {}, bad: ['★' + SKIP_FILE + ' が読めない★ ' + e.message] }; }
  const bad = [];
  for (const k of Object.keys(j)) {
    const v = j[k] || {};
    if (!v.why || !v.back) bad.push('★' + SKIP_FILE + ' の「' + k + '」に 理由(why)か 戻す条件(back)が無い★（黙って外さない）');
  }
  return { map: j, bad };
}

/* ── return の直後の改行（; が入って undefined を返す） ────────── */
function scanASI(root) {
  const bad = [];
  const walk = (d, depth) => {
    if (depth > 8) return;
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIPDIR.test(e.name) || e.name.startsWith('.')) continue;
        walk(p, depth + 1); continue;
      }
      if (!/\.(js|mjs|cjs)$/.test(e.name)) continue;
      let lines;
      try { lines = fs.readFileSync(p, 'utf8').split(NL); } catch { continue; }
      for (let i = 0; i < lines.length - 1; i++) {
        if (!/\breturn[ \t]*\r?$/.test(lines[i])) continue;
        const nx = (lines[i + 1] || '').trim();
        if (!nx || /^(\/\/|\/\*|\*)/.test(nx)) continue;
        if (/^[+\-*/.?]/.test(nx)) {
          bad.push(rel(root, p) + ':' + (i + 1) + '  return の次の行が「' + nx.slice(0, 40) + '」＝undefined を返している');
        }
      }
    }
  };
  walk(root, 0);
  return bad;
}

/* ── 数える ──────────────────────────────── */
/* 本当に叩いている命令だけを集める（覚書や依存の一覧は 見ない） */
function runCommands(root) {
  const cmds = [];
  const pkgPath = path.join(root, 'package.json');
  let scripts = {};
  if (fs.existsSync(pkgPath)) {
    try { scripts = (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).scripts) || {}; } catch { scripts = {}; }
  }
  const wf = path.join(root, '.github', 'workflows');
  if (fs.existsSync(wf)) {
    for (const f of fs.readdirSync(wf)) {
      if (!/\.ya?ml$/.test(f)) continue;
      const y = fs.readFileSync(path.join(wf, f), 'utf8');
      for (const m of y.matchAll(/^\s*(?:-\s*)?run:\s*(?:\||>)?\s*(.*)$/gm)) cmds.push(m[1]);
    }
  }
  /* npm test / npm run X は 中身に置き換える（1段だけ） */
  const out = [...cmds];
  for (const c of cmds) {
    for (const m of c.matchAll(/npm\s+(?:run\s+)?([\w:-]+)/g)) {
      const k = m[1] === 'test' ? 'test' : m[1];
      if (scripts[k]) out.push(scripts[k]);
    }
  }
  /* CI が無い repo もある＝scripts は そのまま全部 見る */
  out.push(...Object.values(scripts));
  return out.join(NL);
}

function run(root, label) {
  const ci = registered(root);
  const { map: SKIP, bad: skipBad } = loadSkip(root);
  /* ★tests/ に在る .mjs だから試験、と 名前で決めない★（指示役 2026-08-22）
     tests-no-ci.json に "kind":"tool" と書いた物は ★道具（試験ではない）★＝
     「走っていない試験」に数えない。理由(why)と戻す条件(back)は 道具でも必須。 */
  const allFiles = listTests(root);
  const TOOLS = Object.keys(SKIP).filter((k) => ((SKIP[k] || {}).kind === 'tool'));
  const tests = allFiles.filter((t) => TOOLS.indexOf(t) < 0);

  /* ★走らせ役の「拾う範囲」を読む★（読めない設定は 緑にしない）
     ★「vitest」という字が どこかに在る＝使っている、ではない★（2026-08-21 自分で踏んだ）
     覚書や devDependencies の字を拾って、この repo に無い vitest の既定の拾う範囲を当ててしまい、
     ★誰も走らせていない試験を「走っている」と言いかけた＝いちばん悪い嘘の緑★。
     ⇒ ★本当に叩いている命令だけ★を見る（package.json の scripts の中身と CI の run: の行）。 */
  const { ranges, unreadable } = pickRanges(root, runCommands(root));

  /* ★走らせている書き方か★で見る（名前が出てくるだけでは 走っていない） */
  const { runs, unknown: execUnknown } = collectExecuted(root, runCommands(root));

  /* ① 走らせている物・拾う範囲に入る物 */
  const why = {};
  for (const t of tests) {
    if (hitsRun(runs, t)) { why[t] = '走らせている'; continue; }
    const g = coveredByRanges(ranges, t);
    if (g) why[t] = g;
  }
  /* ② ★走っている試験が import/require している試験も 走っている★
        （飲み屋の app-source.mjs は nomiya-deploy.test.js が import している）
        ★走っていない試験の中身は読まない★／★鍵（'…': {…}）は 呼び出しではない★ */
  for (let round = 0; round < 5; round++) {
    let added = 0;
    for (const t of tests) {
      if (!why[t]) continue;
      let src;
      try { src = stripComments(fs.readFileSync(path.join(root, t), 'utf8')); } catch { continue; }
      const lits = literals(src).filter((L) => {
        if (L.isKey) return false;                       /* 除外リストの鍵は 呼び出しではない */
        const head = src.slice(Math.max(0, L.at - 40), L.at);
        return IMPORT_NEAR.test(head);                   /* import / require / from の直後だけ */
      }).map((L) => L.v);
      for (const u of tests) {
        if (why[u]) continue;
        const base = u.split(SEP).pop();
        if (lits.some((L) => L === u || L === base || L.endsWith(SEP + base) || L.endsWith(SEP + u))) {
          why[u] = t + ' が呼んでいる'; added++;
        }
      }
    }
    if (!added) break;
  }

  const missing = tests.filter((t) => !SKIP[t] && !why[t]);
  /* 走らせないと書いたのに もう無い物 … 一覧が古い＝これも直す（★道具も見る★） */
  const stale = Object.keys(SKIP).filter((k) => allFiles.indexOf(k) < 0);
  const asi = scanASI(root);
  execUnknown.forEach((u) => unreadable.push(u));

  console.log(whereLine(root));
  if (ranges.length) {
    ranges.forEach((r) => console.log('拾う範囲 … ' + r.name
      + (r.dir ? '  場所 ' + r.dir : '') + '  拾う [' + r.include.join(', ') + ']'
      + (r.exclude.length ? '  外す [' + r.exclude.join(', ') + ']' : '')));
  }
  /* ★1行目を2つに割る（指示役 2026-08-22）★
     昔は「11件 直すまで進めない」と1つの数で出していたので、
     ★本物の赤1件と 道具の誤検知10件が 同じ顔★になり、受け取った側が
     「試験が11本 死んでいる」と読み違えた（指示役が実際に読み違えかけた）。
     ⇒ ★本物の赤（直す物）★ と ★未測定（読めない物）★ を 別の行にする。 */
  const red = missing.length + stale.length + skipBad.length + asi.length;
  const unmeasured = unreadable.length;
  console.log('[' + label + '] 在る試験 ' + tests.length + '本'
    + '（走らせないと決めた ' + (Object.keys(SKIP).length - TOOLS.length) + '本'
    + ' ／ 道具＝試験ではない ' + TOOLS.length + '本）');
  console.log('  ★本物の赤 ' + red + '件★ … 登録していない試験 ' + missing.length + '本'
    + ' ／ ' + SKIP_FILE + ' の食い違い ' + (stale.length + skipBad.length) + '件'
    + ' ／ undefined を返す return ' + asi.length + '件');
  console.log('  ★未測定（読めない）' + unmeasured + '件★'
    + ' … 拾う範囲や 走らせる一覧が 読めない（★読めない物を「走っている」と決めない★）');
  /* ★読めない物を「走っている」と決めない★＝未測定は 緑にせず 赤で出す */
  unreadable.forEach((u) => console.log('  ★拾う範囲が読めません（未測定）★ ' + u
    + ' … 一覧で書き直すか、この見張りに読める形にしてください'));
  missing.forEach((t) => console.log('  ★登録していない＝1本も走っていない★ ' + t));
  stale.forEach((t) => console.log('  ★' + SKIP_FILE + ' に在るのに 試験が無い★ ' + t));
  skipBad.forEach((t) => console.log('  ' + t));
  asi.forEach((t) => console.log('  ★undefined を返す return★ ' + t));
  /* ★どちらも赤にする★（未測定を緑にしない）。ただし ★数は分けて返す★ */
  return { red: red, unmeasured: unmeasured, total: red + unmeasured };
}

/* ★走らせた場所が 測った根の外なら 赤★（--self-test でも同じ。黙って別の repo を測らせない）
   ★2026-08-21 この見張りを 自分で2回 開けた★
     1回目 … そもそも 外から走らせても 自分の家を測って緑（指示役が14repoで踏んだ）
     2回目 … 拾う範囲を足す時に ★この塊ごと 差し替えで消してしまい★、穴が戻っていた
              （気づいたのは ★直したあと もう一度 外から走らせて 戻り値を見た★から）
   ⇒★直したら 必ず もう一度 外から走らせて 戻り値1 を見る★ */
if (!isInside(ROOT, process.cwd())) {
  console.error(whereLine(ROOT));
  console.error('★走らせた場所 … ' + process.cwd());
  console.error('');
  console.error('★測った所と 走らせた場所が 違います★');
  console.error('　この見張りは ★自分が置いてある repo★ を測ります。外から走らせると');
  console.error('　黙って「置いてある方の repo」を測って 緑を返してしまいます（指示役が14repoで踏んだ）。');
  console.error('　⇒ ★測りたい repo の中へ このファイルを1本 置いて、その repo の中で走らせてください★');
  process.exit(1);
}

/* ── わざと壊して 赤になるか ───────────────────── */
if (process.argv.includes('--self-test')) {
  const tmp = fs.mkdtempSync(path.join(ROOT, '.tr-'));
  const W = (p, s) => { fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), s); };
  let ng = 0, tried = 0;   /* ★件数は 手で書かない（前に21→25で手直しした）★ */
  const R = (dir, label) => run(dir, label).total;   /* 自己診断は 合計で見る */
  const must = (want, got, why) => {
    tried++;
    if (want !== got) { console.error('  ★自己診断 失敗★ ' + why + '（欲しい ' + want + ' / 出た ' + got + '）'); ng++; }
    else console.log('  ✓ ' + why);
  };
  try {
    console.log('[自己診断]');
    W('.github/workflows/ci.yml', 'steps:' + NL + '  - run: node app/tests/a.mjs' + NL);
    W('app/tests/a.mjs', 'export const x=1;' + NL);
    must(0, R(tmp, '① そろっている'), 'そろっていれば緑');

    W('app/tests/b.mjs', 'export const y=2;' + NL);
    must(1, R(tmp, '② 登録していない試験を足した'), '登録していない試験を見つける');

    /* ★CIの本文だけ見ると嘘をつく★＝まとめて走らせる子の中も読めているか */
    W('.github/workflows/ci.yml', 'steps:' + NL + '  - run: node tests/run.js' + NL);
    /* ★exec を持たない run.js は「走らせる物」ではない★＝実物に合わせて execFileSync を入れる */
    W('tests/run.js', 'const { execFileSync } = require(' + Q + 'child_process' + Q + ');' + NL
      + 'const FILES=[' + Q + '../app/tests/a.mjs' + Q + ',' + Q + '../app/tests/b.mjs' + Q + '];' + NL
      + 'FILES.forEach(function(f){ execFileSync(' + Q + 'node' + Q + ',[f]); });' + NL);
    must(0, R(tmp, '③ 走らせ役(run.js)の中も読む'), 'run.jsの中を読めば緑（前はここで嘘をついた）');

    /* 走らせない物は 理由と戻す条件が要る */
    W('app/tests/c.mjs', 'export const z=3;' + NL);
    W(SKIP_FILE, JSON.stringify({ 'app/tests/c.mjs': { why: '本物の倉庫へつなぐ' } }));
    must(1, R(tmp, '④ 理由だけで 戻す条件が無い'), '戻す条件が無ければ赤');
    W(SKIP_FILE, JSON.stringify({ 'app/tests/c.mjs': { why: '本物の倉庫へつなぐ', back: '鍵を置いた日' } }));
    must(0, R(tmp, '⑤ 理由と 戻す条件を書いた'), '両方書けば緑');
    W(SKIP_FILE, JSON.stringify({ 'app/tests/mou-nai.mjs': { why: 'x', back: 'y' } }));
    must(2, R(tmp, '⑥ 一覧が古い（試験がもう無い）'), '古い一覧も赤（c.mjs が走らなくなる＋古い1本）');
    fs.rmSync(path.join(tmp, SKIP_FILE));

    /* return の直後の改行 */
    W('.github/workflows/ci.yml', 'steps:' + NL + '  - run: node tests/run.js' + NL + '  - run: node app/tests/c.mjs' + NL);
    W('src/x.js', 'function f(){ return ' + NL + '  + "x"; }' + NL);
    must(1, R(tmp, '⑦ return の次の行が + '), 'undefined を返す return を見つける');
    W('src/x.js', 'function f(){ return ' + NL + '  // ただの覚書' + NL + '  1; }' + NL);
    must(0, R(tmp, '⑧ return の次が覚書なら 数えない'), '覚書で誤検知しない');

    /* ★拾う範囲（vitest / playwright）を読めているか★（指示役が飲み屋で踏んだ穴）
       ここを読まずに「走らせ役の名前」だけ見ると ★走っている9本を「走っていない」と赤にする★ */
    console.log('[自己診断] ⑨〜⑬ 拾う範囲');
    fs.rmSync(path.join(tmp, '.github'), { recursive: true, force: true });
    fs.rmSync(path.join(tmp, 'app'), { recursive: true, force: true });
    fs.rmSync(path.join(tmp, 'tests'), { recursive: true, force: true });
    fs.rmSync(path.join(tmp, 'src'), { recursive: true, force: true });
    W('package.json', JSON.stringify({ scripts: { test: 'vitest run', e2e: 'playwright test' } }));
    W('vitest.config.js', 'export default { test: { include: [' + Q + 'tests/**/*.test.js' + Q + '] } };' + NL);
    W('playwright.config.js', 'export default { testDir: ' + Q + './tests/e2e' + Q + ', testMatch: ' + Q + '**/*.spec.js' + Q + ' };' + NL);
    W('tests/a.test.js', 'test();' + NL);
    must(0, R(tmp, '⑨ vitest の include で拾える物は 走っている'), '★include で拾える物を「走っていない」と言わない');

    W('tests/e2e/smoke.spec.js', 'test();' + NL);
    must(0, R(tmp, '⑩ playwright の testDir/testMatch も読む'), 'playwright の拾う範囲も読む');

    W('tests/yobareru.mjs', 'export const x=1;' + NL);
    must(1, R(tmp, '⑪ 誰も呼んでいない .mjs は 走っていない'), '拾う範囲に無い .mjs は 走っていない');
    W('tests/b.test.js', 'import ' + Q + './yobareru.mjs' + Q + ';' + NL);
    must(0, R(tmp, '⑫ 走っている試験が呼んでいる物も 走っている'), '★走っている試験が呼ぶ物は 走っている');
    /* ★名前の部分一致で広げない★（自分で踏んだ＝嘘の緑）
       payroll-calc.test.js の中に calc.test.js が入っているだけで「呼ばれている」と言い、
       ★本物の repo で わざと1本 外しても 赤にならなかった★。 */
    W('tests/payroll-c.test.js', 'const s=' + Q + 'payroll-c.test.js' + Q + ';' + NL);
    W('tests/c.test.js', 'test();' + NL);
    W('tests/dare-mo.mjs', 'export const z=1;' + NL);
    W('vitest.config.js', 'export default { test: { include: [' + Q + 'tests/**/*.test.js' + Q + '] } };' + NL);
    must(1, R(tmp, '⑬ 名前の一部が入っているだけでは 呼ばれていない'),
      '★payroll-c.test.js が在っても c.mjs 相当を「呼ばれている」と言わない');
    /* ★足した物は 片づける★（次の診断の数が ずれる＝自分で踏んだ） */
    ['tests/dare-mo.mjs', 'tests/payroll-c.test.js', 'tests/c.test.js']
      .forEach((f) => fs.rmSync(path.join(tmp, f), { force: true }));

    W('vitest.config.js', 'import { P } from ' + Q + './p.js' + Q + ';' + NL + 'export default { test: { include: P } };' + NL);
    must(4, R(tmp, '⑭ 拾う範囲が 変数で書かれている＝読めない'), '★読めない設定を 緑にしない（未測定で赤）');

    /* ★字が在るだけでは 使っているとしない★（自分で踏んだ＝嘘の緑） */
    fs.rmSync(path.join(tmp, 'vitest.config.js'));
    fs.rmSync(path.join(tmp, 'playwright.config.js'));
    W('package.json', JSON.stringify({ devDependencies: { vitest: '1.0.0' }, scripts: { test: 'node tests/run.js' } }));
    W('tests/run.js', 'const { execFileSync } = require(' + Q + 'child_process' + Q + ');' + NL
      + 'const F=[' + Q + './a.test.js' + Q + ',' + Q + './b.test.js' + Q + ',' + Q + './yobareru.mjs' + Q + '];' + NL
      + 'F.forEach(function(f){ execFileSync(' + Q + 'node' + Q + ',[f]); });' + NL);
    must(1, R(tmp, '⑮ vitest は 依存に在るだけ＝使っていない'), '★字が在るだけで 既定の拾う範囲を当てない');

    /* ★測った所と 走らせた場所が 違ったら赤★（指示役が14repoで踏んだ穴） */

    /* ★「名前が出てくる」＝走っている ではない★（指示役が exally-staging で踏んだ穴）
       除外リストの鍵を見つけて「走っている」と言い、131本/5本 → 142本/0本 にした＝嘘の緑。 */
    console.log('[自己診断] ⑯〜⑲ 走らせている書き方か');
    ['tests', 'kyuyo/tests', 'app', 'src', '.github/workflows'].forEach(
      (d) => fs.rmSync(path.join(tmp, d), { recursive: true, force: true }));
    fs.rmSync(path.join(tmp, 'vitest.config.js'), { force: true });
    fs.rmSync(path.join(tmp, 'playwright.config.js'), { force: true });
    W('package.json', JSON.stringify({ scripts: {} }));
    W('.github/workflows/ci.yml', 'steps:' + NL + '  - run: node tests/run.js' + NL + '  - run: node tests/ci-coverage.test.mjs' + NL);
    W('tests/run.js', 'const { execFileSync } = require(' + Q + 'child_process' + Q + ');' + NL
      + 'const F=[' + Q + '../kyuyo/tests/a.test.mjs' + Q + '];' + NL
      + 'F.forEach(function(f){ execFileSync(' + Q + 'node' + Q + ',[f]); });' + NL);
    W('kyuyo/tests/a.test.mjs', 'export const a=1;' + NL);
    must(0, R(tmp, '⑯ run.js の一覧に在って 実行されている'), '★一覧に在って 実行されていれば 走っている');

    W('kyuyo/tests/hazure.test.mjs', 'export const b=1;' + NL);
    W('tests/ci-coverage.test.mjs', 'import fs from ' + Q + 'node:fs' + Q + ';' + NL
      + 'const KNOWN = { ' + Q + 'kyuyo/tests/hazure.test.mjs' + Q + ': { why: ' + Q + '未展開' + Q
      + ', back: ' + Q + '戻す条件' + Q + ' } };' + NL + 'console.log(Object.keys(KNOWN).length);' + NL);
    must(1, R(tmp, '⑰ 除外リストの鍵に 名前だけ在る'), '★除外リストの鍵を「走っている」と言わない');

    /* 見張る物（exec を持たない）の 一覧に 素で並んでいても 走っていない */
    W('tests/ci-coverage.test.mjs', 'import fs from ' + Q + 'node:fs' + Q + ';' + NL
      + 'const LIST = [' + Q + 'kyuyo/tests/hazure.test.mjs' + Q + '];' + NL + 'console.log(LIST.length);' + NL);
    must(1, R(tmp, '⑱ 見張る物の一覧に 並んでいるだけ'), '★走らせない物の一覧は「走っている」ではない');

    /* 走らせる物なのに 一覧が変数＝読めない → 緑にしない */
    W('tests/ci-coverage.test.mjs', 'console.log(1);' + NL);
    W('tests/run.js', 'const { execFileSync } = require(' + Q + 'child_process' + Q + ');' + NL
      + 'const F = buildList();' + NL + 'F.forEach(function(f){ execFileSync(' + Q + 'node' + Q + ',[f]); });' + NL);
    must(3, R(tmp, '⑲ 走らせる物だが 一覧が読めない'), '★読めない時は 緑にせず 未測定で赤');

    /* ★⑳〜㉔ 穴④＝走らせている「先」まで見る（指示役 2026-08-22）★
       昔は「子プロセスを起こす＝試験の一覧を持つ」と決めていたので、
       git を叩くだけの物・自分自身を叩くだけの自己診断を ★未測定（赤）★ にしていた＝嘘の赤。 */
    console.log('[自己診断] ⑳〜㉔ 走らせている先まで見る（穴④）');
    ['tests', 'kyuyo', 'scripts', '.github/workflows'].forEach(
      (d) => fs.rmSync(path.join(tmp, d), { recursive: true, force: true }));
    fs.rmSync(path.join(tmp, SKIP_FILE), { force: true });
    W('.github/workflows/ci.yml', 'steps:' + NL + '  - run: node app/tests/a.mjs' + NL
      + '  - run: node scripts/cmp.mjs' + NL);
    W('app/tests/a.mjs', 'export const a=1;' + NL);
    W('scripts/cmp.mjs', 'import { execFileSync } from ' + Q + 'node:child_process' + Q + ';' + NL
      + 'execFileSync(' + Q + 'git' + Q + ',[' + Q + '-C' + Q + ',d,' + Q + 'ls-files' + Q + ']);' + NL);
    must(0, R(tmp, '⑳ git を叩くだけの物'), '★別のexe(git)は 試験の一覧ではない＝未測定にしない');

    W('scripts/cmp.mjs', 'import { spawnSync } from ' + Q + 'node:child_process' + Q + ';' + NL
      + 'spawnSync(process.execPath,[__filename,' + Q + '--self-test' + Q + ']);' + NL);
    must(0, R(tmp, '㉑ 自分自身を叩くだけ'), '★自己診断(自分を1回 走らせる)は 一覧ではない');

    /* ★㉑-b 自分自身の 別の叩き方★（指示役が exally-staging で見つけた誤検知3件・2026-08-22）
       実物 … tests/grid-freeze.test.mjs:307 ほか2本
         spawnSync(process.execPath, [path.join(__dirname, 'grid-freeze.test.mjs')], {…})
       ★実物を写して確かめた事★（当てずに測った）
         その3本は ★正規表現の中に引用符★ を持っていて、ファイル全体の文字列の対が崩れ、
         ★236個の文字列を拾っても .mjs で終わる物が 0個★になる。だから昔は
         「走らせる物なのに 一覧が読めない」＝★未測定（赤）★ になっていた。
       ⇒ ここでも ★同じ形（正規表現の中の引用符）★ を入れないと この試験は空振りする。
         （最初 入れずに書いて ★昔の姿に戻しても緑のまま＝空振り★ だったので 実物を読み直した） */
    W('scripts/cmp.mjs', 'import { spawnSync } from ' + Q + 'node:child_process' + Q + ';' + NL
      + 'import path from ' + Q + 'node:path' + Q + ';' + NL
      + 'spawnSync(process.execPath,[path.join(__dirname,' + Q + 'cmp.mjs' + Q + '),'
      + Q + '--self-test' + Q + ']);' + NL);
    must(0, R(tmp, '㉑-b __dirname＋自分のファイル名'), '通しでも 緑（★この1本だけでは 昔の姿でも緑＝空振り★）');

    /* ★㉑-b2 ここが 本当の見張り★
       通しの形（上）は ★昔の姿に戻しても緑のまま＝空振り★ だった。実物を写して測ったら、
       実物は ★ファイル全体の引用符の対が崩れて 自分の名前を拾えない★ ので未測定になっていた。
       その崩れ方は 作り物では再現しにくい ⇒ ★実物の1行を そのまま判定に渡す★。
       出典（読んだだけ・1文字も書いていない）:
         exally-staging tests/grid-freeze.test.mjs:307 ／ grid-sort.test.mjs:211 ／
         mobile-labels.test.mjs:170 */
    const REAL = 'const { spawnSync } = await import(' + Q + 'node:child_process' + Q + ');' + NL
      + 'const isRed = spawnSync(process.execPath, [path.join(__dirname, ' + Q + 'grid-freeze.test.mjs'
      + Q + ')], { encoding: ' + Q + 'utf8' + Q + ', env }).status !== 0;' + NL;
    const realFile = path.join(tmp, 'tests', 'grid-freeze.test.mjs');
    must('self', runnerKind(REAL, realFile), '★実物の形（__dirname＋自分の名前）を self と見る');
    must('runner', runnerKind(REAL.split('grid-freeze.test.mjs').join('hoka.test.mjs'), realFile),
      '★組み立てた先が別のファイルなら runner のまま（緩めすぎない）');

    /* ★逆★＝組み立てた先が ★別のファイル★なら ちゃんと一覧として読む（緩めすぎない） */
    W('scripts/cmp.mjs', 'import { spawnSync } from ' + Q + 'node:child_process' + Q + ';' + NL
      + 'import path from ' + Q + 'node:path' + Q + ';' + NL
      + 'spawnSync(process.execPath,[path.join(__dirname,' + Q + '../app/tests/b.mjs' + Q + ')]);' + NL);
    W('app/tests/b.mjs', 'export const b=1;' + NL);
    must(0, R(tmp, '㉑-c 組み立てた先が別のファイル'), '★別のファイルなら 走らせていると数える');
    fs.rmSync(path.join(tmp, 'app/tests/b.mjs'), { force: true });

    W('scripts/cmp.mjs', 'import { execFileSync } from ' + Q + 'node:child_process' + Q + ';' + NL
      + 'const F = buildList();' + NL
      + 'F.forEach(function(f){ execFileSync(' + Q + 'node' + Q + ',[f]); });' + NL);
    must(1, R(tmp, '㉒ node で叩くが 一覧が読めない'), '★node を叩く物で 一覧が読めなければ 未測定で赤');

    /* ★道具（試験ではない）★＝tests/ に在る .mjs でも 名前で試験と決めない */
    W('scripts/cmp.mjs', 'console.log(1);' + NL);
    W('tests/seed.mjs', 'export const seed=1;' + NL);
    must(1, R(tmp, '㉓ tests/ の道具を 何も書かずに置く'), '何も書かなければ 走っていない試験として赤');
    W(SKIP_FILE, JSON.stringify({ 'tests/seed.mjs': { kind: 'tool', why: '種を撒く道具' } }));
    must(1, R(tmp, '㉔ 道具でも 戻す条件が無い'), '★道具でも 理由と戻す条件が無ければ赤');
    W(SKIP_FILE, JSON.stringify({ 'tests/seed.mjs': { kind: 'tool', why: '種を撒く道具', back: '確かめる試験にした日' } }));
    must(0, R(tmp, '㉕ 道具と書いた（理由と戻す条件つき）'), '★道具は「走っていない試験」に数えない');

    /* ★㉖ 本物の赤と 未測定を 分けて数える★（1つの数にすると 読み違える） */
    W('app/tests/b.mjs', 'export const b=1;' + NL);                    /* 登録していない＝本物の赤1 */
    W('.github/workflows/ci.yml', 'steps:' + NL + '  - run: node app/tests/a.mjs' + NL
      + '  - run: node scripts/cmp.mjs' + NL);
    W('scripts/cmp.mjs', 'import { execFileSync } from ' + Q + 'node:child_process' + Q + ';' + NL
      + 'const F = buildList();' + NL
      + 'F.forEach(function(f){ execFileSync(' + Q + 'node' + Q + ',[f]); });' + NL); /* 未測定1 */
    const split = run(tmp, '㉖ 赤と未測定を分ける');
    must(1, split.red, '★本物の赤（登録していない試験）を 別に数える');
    must(1, split.unmeasured, '★未測定（読めない）を 別に数える');
    must(2, split.total, '合計は どちらも赤にする');

    console.log('[自己診断] ㉗〜 測った所と 走らせた場所');
    must(true, isInside(tmp, path.join(tmp, 'app', 'tests')), '★repoの中から走らせたら 通す');
    must(false, isInside(tmp, path.dirname(tmp)), '★repoの外から走らせたら 止める');
    must(true, isInside(tmp, tmp), '根そのものは 中');
    must(false, isInside(path.join(tmp, 'app'), tmp), '親から子を測ろうとしたら 止める');
    /* ★測った所を いちばん上に出しているか★（出ていなければ 指示役は気づけない） */
    must(true, /^測った所 … /.test(whereLine(tmp)), '★測った所を 1行目に出す');
    must(true, whereLine(tmp).indexOf(path.basename(tmp)) > 0, '★repo名も出す');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  if (ng) { console.error(NL + '★自己診断 ' + ng + '件 失敗★'); process.exit(1); }
  console.log(NL + '自己診断 ' + tried + '件 とも 正しい');
  process.exit(0);
}

const out = run(ROOT, 'tests-registered');
const bad = out.total;
if (process.argv.includes('--list')) process.exit(0);
if (bad) { console.error(NL + '★' + bad + '件★ 直すまで進めない（登録しないと 1本も走りません）'); process.exit(1); }
console.log('OK（在る試験は 全部 走っている）');
