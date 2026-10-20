/* supa-config-matches-repo.test.mjs — ★repoの素性と 倉庫の向き先が 食い違ったら 赤★（Timeally）
 * =============================================================================
 * ★なぜ 要るか（2026-09-12 の 事故。客に 見えていた）★
 *   rakually の 本番投入で ★テスト線の js/supa-config.js が 本番へ 紛れ込んだ★。
 *     名札 env:'prod' → ★'test'★ ／ 倉庫 本番 → ★試験用★
 *   ⇒ 客の画面に 茶色の帯「テスト環境」が 出て、★客の書き込み先が 試験用の倉庫★に なっていた。
 *   原因＝★git archive | tar で 丸ごと 運んだ★＝運ぶ道具（scripts/mirror-to-prod.mjs）を 通らない
 *   ＝運ぶ道具の「supa-config.js は 運ばない」守りが 効かない。
 *   ⇒ ★運ぶ道具の守りだけでは 足りない。置かれた結果を CI で 見る。★
 *
 * ★Timeally には この検査が 1本も 無かった（2026-09-14 実測）★
 *   在る tests/env-badge.test.mjs は ★このrepoの名札を読んで、それに合う振る舞いか★ だけを見る。
 *   ＝設定が 名札ごと 丸ごと 入れ替わると ★自分の中では 筋が通ってしまい 緑のまま★。
 *   ＝だから ★repoの外から来る事実★ で 素性を 決める。
 *
 * ★素性は 何で 決めるか★
 *   ★js/supa-config.js を 見て 判定しては いけない★（それを 見張る 物なので 堂々巡り）。
 *   ⇒ ★git の origin の 名前★ で 決める。
 *      …-test で 終わる → テスト線（名札 test ／ 試験の倉庫）
 *      それ以外        → 本番    （名札 prod ／ 本番の倉庫）
 *
 * ★この検査だけは 倉庫のrefを2つ 持つ★（他のファイルは 1文字も 持たない）
 *   ＝「どちらを 向くのが 正しいか」を 突き合わせる 相手が 無いと 何も 言えない。
 *   同じ理由・同じ形が rakually の scripts/check-warehouse-pointers.mjs に 在る。
 *   ⇒ tests/no-hardcoded-supa.test.mjs の 許可リストに ★理由つきで★ 入れてある。
 *
 * 借りた形: rakually-test/tests/supa-config-env-matches-repo.test.mjs（Rakunally1・2026-09-13）
 *   ＝素性の決め方と「★tar で 運んで から 走らせる★」自己確認は そこから 写した。
 *   ★足した分★ ①倉庫のref自体も 縛る ②もう片方のrefが 混じっていないか ③鍵の中のrefも 見る
 *     （②③＝★片方だけ入れ替わる形★。名札は prod のまま 倉庫だけ 試験用＝帯も出ないので
 *       画面を 見ても 気づけない＝いちばん 見つけにくい）
 *
 * 使い方: node tests/supa-config-matches-repo.test.mjs
 *         node tests/supa-config-matches-repo.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CFG = 'js/supa-config.js';

/* ══════════ 何を正とするか（★このファイルだけが 両方の ref を 持つ★） ══════════ */
export const REFS = { prod: 'tnfwipbgfgjaymlszeid', test: 'khawdrnvssdenumbiwfg' };

/** コメントを落としてから読む（説明文の env:'prod' を拾って誤読しない。env-badge.test.mjs で実際に踏んだ） */
export function stripJs(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
}
export function envOf(src) {
  const m = /env:\s*'([a-z]+)'/.exec(stripJs(src));
  return m ? m[1] : '';
}
export function urlRefOf(src) {
  const m = /https:\/\/([a-z0-9]{16,})\.supabase\.co/.exec(stripJs(src));
  return m ? m[1] : '';
}
/** 鍵の中の ref。★sb_publishable_ の形は ref を持っていない★ので '' を返す（無い事と 読めない事を 混ぜない） */
export function keyRefOf(src) {
  const m = /eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]{20,})\./.exec(stripJs(src));
  if (!m) return '';
  try {
    const b = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(Buffer.from(b + '='.repeat((4 - (b.length % 4)) % 4), 'base64').toString('utf8'));
    return typeof o.ref === 'string' ? o.ref : '';
  } catch (e) { return ''; }
}
export function keyShape(src) {
  const s = stripJs(src);
  if (/key:\s*'eyJ/.test(s)) return 'JWT（中に ref を 持つ）';
  if (/key:\s*'sb_publishable_/.test(s)) return 'publishable（ref を 持たない形）';
  return '不明';
}
/* ★origin の 名前★（.git を 落とす）。読めなければ 空 */
export function originName(root) {
  try {
    const u = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const last = u.split('/').pop() || '';
    return last.replace(/\.git$/, '');
  } catch (e) { return ''; }
}

/* ★物差しそのもの★＝origin の名前と 設定ファイルの中身を 渡すと「よいか」を 返す
   （git も 実ファイルも 使わずに 確かめられる 形＝自己確認が 本物に なる） */
export function au(name, src, refs = REFS) {
  if (!name) return { ok: false, riyuu: ['origin の 名前が 読めない（★読めない物を 緑に しない★）'] };
  const gawa = /-test$/.test(name) ? 'test' : 'prod';
  const hoshii = { env: gawa, ref: refs[gawa], hoka: refs[gawa === 'test' ? 'prod' : 'test'] };
  const env = envOf(src), url = urlRefOf(src), key = keyRefOf(src);
  const riyuu = [];
  if (env !== 'test' && env !== 'prod') riyuu.push('名札 env が test でも prod でも ない: ' + JSON.stringify(env));
  else if (env !== hoshii.env) riyuu.push('★repo は ' + name + ' なのに 名札が ' + env + '★（欲しい ' + hoshii.env + '）');
  if (!url) riyuu.push('倉庫の URL が 読めない（' + CFG + ' に url が 無い）');
  else if (url !== hoshii.ref) {
    riyuu.push('★repo は ' + name + ' なのに 倉庫が ' +
      (url === hoshii.hoka ? 'もう片方の線' : '知らない倉庫') + '★: ' + url);
  }
  if (key && url && key !== url) riyuu.push('★URL と 鍵の中の ref が 食い違う★: URL=' + url + ' 鍵=' + key);
  /* ★★数え方（2026-09-14 指示役1 の 注意）★★
     ★「反対側の ref の 字が 在る＝悪い」では ない★。説明文（コメント）に 反対側の 字は 普通に 出る。
     ★悪いのは 既定＝実際に 使う 値が 反対側★＝だから ★コメントを 落とした コードだけ★を 数える。
     （この 数え方を 間違えて 指示役1 が 09-14 に 誤報を 1件 流している。手本＝
       Daikou-app/tests/unit/dougu-no-mukisaki.test.js「悪いのは 既定が 反対側 だけ」）
     コメントに 出てくる分は ★赤に しない・声だけ 出す★（狼少年に しない）。 */
  const koe = [];
  if (hoshii.hoka) {
    const code = stripJs(src);
    let kazu = code.split(hoshii.hoka).length - 1;
    if (url === hoshii.hoka) kazu -= 1;           /* url の分は すぐ上で もう 言っている（二重に 言わない） */
    if (kazu > 0) riyuu.push('★もう片方の線の ref が コードに 生きている（url 以外の 所に ' + kazu + '件）★: ' + hoshii.hoka);
    else if (String(src).indexOf(hoshii.hoka) >= 0) {
      koe.push('説明文（コメント）に もう片方の ref が 出てくる … ★赤には しない★（既定が 反対側かだけを 数える）');
    }
  }
  return { ok: riyuu.length === 0, riyuu, koe, gawa, hoshii, env, url, key };
}

/* ★読み込まれた だけでは 走らない★（2026-10-20）＝tests/mirror-match.test.mjs が REFS と 物差しを 借りる 為。
   import した 先で 自己確認や 判定が 走って exit すると、借りた 側の 見張りが 黙って 止まる */
const RUN_DIRECT = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
/* 直に 走らせたのに 道の 突き合わせが 外れたら（ドライブの 字・junction 等）黙って 0 で 終わらず 赤 */
if (!RUN_DIRECT && /supa-config-matches-repo\.test\.mjs$/.test(process.argv[1] || '')) {
  console.log('★赤★ 直に 走らせたのに RUN_DIRECT が 偽＝判定が 1行も 走らない（道の 突き合わせが 外れた）');
  process.exit(1);
}

/* ══════════ 自己確認（★わざと 食い違わせたら 赤に なるか★） ══════════ */
if (RUN_DIRECT && process.argv.includes('--self-test')) {
  console.log('\n[supa-config-matches-repo --self-test] わざと 食い違わせたら 赤に なるか');
  let ng = 0;
  const iu = (nm, good) => { if (!good) ng++; console.log('  ' + (good ? '✓' : '✗') + ' ' + nm + (good ? '' : '  ★思っていたのと 違う★')); };

  /* ★作り物の ref（本物は この自己確認では 使わない）★ */
  const F = { prod: 'aaaabbbbccccddddeeee', test: 'zzzzyyyyxxxxwwwwvvvv' };
  const THIRD = 'mmmmnnnnooooppppqqqq';
  const Q = String.fromCharCode(39);   /* ' … 入れ子で 書かない */
  const NL = String.fromCharCode(10);
  const jwt = (ref) => 'eyJhbGciOiJIUzI1NiJ9.' +
    Buffer.from(JSON.stringify({ iss: 'supabase', ref: ref, role: 'anon' })).toString('base64url') + '.sig';
  /* keyRef: undefined＝url と 同じ ref の JWT ／ null＝publishable（ref を 持たない） ／ 文字＝その ref の JWT */
  const cfg = (env, ref, keyRef) =>
    'window.SUPA = {' + NL +
    '  url: ' + Q + 'https://' + ref + '.supabase' + '.co' + Q + ',' + NL +
    '  key: ' + Q + (keyRef === null ? 'sb_publishable_XXXX' : jwt(keyRef === undefined ? ref : keyRef)) + Q + ',' + NL +
    '  env: ' + Q + env + Q + NL +
    '};' + NL;

  iu('★09-12 の形（本番に テスト線の設定が 丸ごと）… 赤', !au('timeally', cfg('test', F.test), F).ok);
  iu('テスト線に 本番の設定が 丸ごと … 赤', !au('timeally-test', cfg('prod', F.prod), F).ok);
  iu('★名札だけ 入替（倉庫は 本番・名札 test）… 赤', !au('timeally', cfg('test', F.prod), F).ok);
  iu('★倉庫だけ 入替（名札 prod・倉庫が 試験用）… 赤（帯が出ない＝画面では 気づけない形）',
    !au('timeally', cfg('prod', F.test), F).ok);
  iu('★鍵の中だけ もう片方（URL 本番・鍵 試験）… 赤', !au('timeally', cfg('prod', F.prod, F.test), F).ok);
  iu('知らない倉庫（第三の ref）… 赤', !au('timeally', cfg('prod', THIRD), F).ok);
  iu('知らない 名札（staging）… 赤', !au('timeally', cfg('staging', F.prod), F).ok);
  iu('名札が 空 … 赤', !au('timeally', cfg('', F.prod), F).ok);
  iu('倉庫の URL が 無い … 赤', !au('timeally', 'window.SUPA = { env: ' + Q + 'prod' + Q + ' };', F).ok);
  iu('origin が 読めない … 赤（★未測定を 緑に しない★）', !au('', cfg('prod', F.prod), F).ok);
  /* ★★「字が 在る＝悪い」では ない★★＝説明文の分は 赤に しない・声だけ 出す（09-14 指示役1 の 注意） */
  const setsumei = au('timeally', '/* ' + F.test + ' を 見ていた頃の 名残（説明） */' + NL + cfg('prod', F.prod), F);
  iu('★説明文だけに もう片方の ref … 緑（狼少年に しない）', setsumei.ok);
  iu('★その時 声は 出す（黙って 通さない）', (setsumei.koe || []).length === 1);
  iu('★コードに もう片方の ref が 生きている（url 以外・前の値の 置き忘れ）… 赤',
    !au('timeally', cfg('prod', F.prod) + 'const OLD_REF = ' + Q + F.test + Q + ';' + NL, F).ok);
  iu('本番 × 本番 … 緑（★狼少年に しない★）', au('timeally', cfg('prod', F.prod), F).ok);
  iu('テスト線 × テスト線 … 緑', au('timeally-test', cfg('test', F.test), F).ok);
  iu('★publishable の 鍵（ref を 持たない形）でも 本筋が 合っていれば 緑',
    au('timeally-test', cfg('test', F.test, null), F).ok);

  /* ★★09-12 に 実際に 使われた 手で 運んで から 走らせる★★
     ＝字で 真似るのでは なく、本当に git archive | tar で 運ぶ（rakually-test から 写した形） */
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'timeally-supacfg-'));
  const mk = (dir, origin, env, ref) => {
    fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'js', 'supa-config.js'), cfg(env, ref));
    execFileSync('git', ['-C', dir, 'init', '-q'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'https://github.com/x/' + origin + '.git'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' });
    execFileSync('git', ['-C', dir, '-c', 'user.email=a@b', '-c', 'user.name=a', 'commit', '-q', '-m', 'x'], { stdio: 'ignore' });
  };
  const tesuto = path.join(tmp, 'timeally-test'), honban = path.join(tmp, 'timeally');
  mk(tesuto, 'timeally-test', 'test', F.test);
  mk(honban, 'timeally', 'prod', F.prod);
  const yomu = (d) => fs.readFileSync(path.join(d, 'js/supa-config.js'), 'utf8');
  iu('運ぶ前の 本番は 緑（作り物の repo でも 素性が 読める）', au(originName(honban), yomu(honban), F).ok);
  /* ★Windows の 逆斜線を sh に 渡すな★＝逃がし記号と 見なされて 落ちる。C:/… に 直す。 */
  const sl = (p) => p.split(path.sep).join('/');
  execFileSync('sh', ['-c', 'git -C "' + sl(tesuto) + '" archive HEAD | tar -x -C "' + sl(honban) + '"'], { stdio: 'ignore' });
  iu('★git archive | tar で 運ぶと 本番の 名札が test に なる（事故の 再現）★', envOf(yomu(honban)) === 'test');
  iu('★その後に この見張りを 走らせると 赤★（09-12 の形を 捕まえられる）', !au(originName(honban), yomu(honban), F).ok);
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(ng ? '\n★自己確認 ' + ng + '件 おかしい★' : '\n自己確認 OK（わざと 食い違わせると 赤に なる）');
  process.exit(ng ? 1 : 0);
}

/* ══════════ 本番の判定 ══════════ */
if (RUN_DIRECT) {
const name = originName(ROOT);
const src = fs.readFileSync(path.join(ROOT, CFG), 'utf8');
const r = au(name, src);

console.log('\n[supa-config-matches-repo] repo の 素性と 倉庫の向き先が 合っているか');
console.log('  origin の 名前 … ' + (name || '（読めない）'));
console.log('  この線 … ' + (r.gawa === 'test' ? 'テスト線' : '本番')
  + '（欲しい 名札 ' + (r.hoshii ? r.hoshii.env : '？') + ' ／ 欲しい 倉庫 ' + (r.hoshii ? r.hoshii.ref : '？') + '）');
console.log('  ' + CFG + ' の 名札 env … ' + (r.env || '（読めない）'));
console.log('  ' + CFG + ' の 倉庫 url … ' + (r.url || '（読めない）'));
console.log('  鍵の形 … ' + keyShape(src) + (r.key ? '／中の ref … ' + r.key : ''));
for (const k of (r.koe || [])) console.log('  ・声 … ' + k);
if (r.ok) { console.log('  ✓ 合っている'); process.exit(0); }
for (const x of r.riyuu) console.log('  ✗ ' + x);
console.log('    ★直し方★ この repo の ' + CFG + ' を この線の 値に 戻す（もう片方から 写すな）。');
console.log('    ★運ぶ時は scripts/mirror-to-prod.mjs を 通す★（' + CFG + ' を 運ばない 守りが 入っている）。');
process.exit(1);
}
