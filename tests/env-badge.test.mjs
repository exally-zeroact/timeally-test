/* env-badge.test.mjs — ★テスト環境の帯★（Timeally）
 * =============================================================================
 * ここで止めたい事故（重い順）:
 *   ① ★本番に「テスト環境」と出る★  … 本番を軽く扱って壊す。いちばん危ない。
 *   ② ★1画面でも帯が出ない★        … 出ない画面を本番だと思い込む。
 *   ③ 帯のせいで ★画面の頭が隠れる★ … 上の帯・1行目が読めなくなる（iOSの前科）。
 *   ④ 帯の文が ★1文字ずつ縦に割れる★（前科3回）
 *
 * 使い方: node tests/env-badge.test.mjs
 *         node tests/env-badge.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const BADGE = require_(path.join(ROOT, 'js/env-badge.js'));

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

/* ★この検査も倉庫のIDを書かない★（向き先を持つのは js/supa-config.js だけ） */
const PROD = { env: 'prod' };
const TEST = { env: 'test' };

function shippedHtml() {
  return fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();
}
/** コメントを落としてから読む（説明文の env:'prod' を拾って誤読しない。実際に踏んだ） */
function stripJs(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
}

/* やってはいけない方の決め方＝ホスト名で決める（self-test の作り物） */
export function showByHost(host) {
  return String(host || '').indexOf('github.io') >= 0;
}

if (process.argv.includes('--self-test')) {
  console.log('\n[env-badge --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('① ホスト名で決める作り方は、配り方を変えた日に間違える（本物は倉庫で決める）', () => {
    ok(showByHost('exally-zeroact.github.io'), '作り物が判定していない＝この検査が空振り');
    ok(!showByHost('timeally.vercel.app'), '作り物が判定していない＝この検査が空振り');
    eq(BADGE.shouldShow(TEST), true, '本物がテストの倉庫で出さない');
    eq(BADGE.shouldShow(PROD), false, '★本物が本番の倉庫で出している★');
  });
  S('② 「分からない時は出す」に倒すと 本番に出てしまう（本物は出さない）', () => {
    const naive = (c) => !(c && c.env === 'prod');
    ok(naive(null) && naive({}), '作り物が出していない＝この検査が空振り');
    eq(BADGE.shouldShow(''), false, '★本物が「分からない」で出している★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n[テスト環境の帯]');

T('★本番の倉庫では絶対に出さない（いちばん危ない事故）', () => {
  eq(BADGE.shouldShow(PROD), false);
  eq(BADGE.shouldShow('prod'), false, '文字で渡しても本番なら出さない');
  eq(BADGE.shouldShow({ env: 'production' }), false, '知らない書き方は出さない');
  eq(BADGE.shouldShow({ env: 'TEST' }), false, '大文字違いは「知らない値」として出さない');
});

T('★どちらとも分からない時も出さない（安全側に倒す）', () => {
  eq(BADGE.shouldShow(''), false);
  eq(BADGE.shouldShow(null), false);
  eq(BADGE.shouldShow(undefined), false);
  eq(BADGE.shouldShow({}), false, '名札が無い');
  eq(BADGE.shouldShow({ url: 'https://example.supabase.co' }), false, '名札の無い接続設定');
});

T('★テストの倉庫だと分かった時だけ出す', () => {
  eq(BADGE.shouldShow(TEST), true);
  eq(BADGE.shouldShow('test'), true);
});

/* ★この検査ファイルは テストrepoと本番repoで【同じ物】★
   片方だけ直すと必ず腐るので、★このrepoの名札を読んで、期待する側を自分で決める★。
   （前科: staging だけ直して本番が6日そのままだった） */
T('★このrepoの名札(env)が読めて、そのrepoにふさわしい振る舞いになっている', () => {
  const cfg = stripJs(fs.readFileSync(path.join(ROOT, 'js/supa-config.js'), 'utf8'));
  const m = /env:\s*'([a-z]+)'/.exec(cfg);
  ok(m, "js/supa-config.js から env を読めない（帯が判定できない）");
  const env = m[1];
  ok(env === 'test' || env === 'prod', '知らない名札: ' + env);
  eq(BADGE.shouldShow({ env: env }), env === 'test',
    env === 'test' ? 'テスト線なのに帯が出ない' : '★本番線なのに帯が出る（いちばん危ない）★');
  console.log('     実測: このrepoの名札は ' + env + ' → 帯は ' + (env === 'test' ? '出る' : '出ない'));
});

T('★本番とテストの見分けは「今どの倉庫か」だけで決める（ホスト名を見ていない）', () => {
  const code = stripJs(fs.readFileSync(path.join(ROOT, 'js/env-badge.js'), 'utf8'));
  ok(!/location\s*\.\s*(host|hostname|href)/.test(code), 'ホスト名で決めている');
  ok(!/github\.io|vercel\.app/.test(code), '配り先の名前で決めている');
  ok(code.indexOf('SUPA') >= 0, '接続設定を見ていない');
  ok(!/[a-z0-9]{20}\.supabase\.co/.test(code), '倉庫のIDを直書きしている');
});

T('★配信される画面すべてが帯を読み込んでいる（1画面でも抜けたら赤）', () => {
  const files = shippedHtml();
  ok(files.length >= 5, '画面が少なすぎる（数え漏れ）: ' + files.length);
  const miss = files.filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').indexOf('env-badge.js') < 0);
  ok(miss.length === 0, '帯が入っていない画面: ' + miss.join(', '));
  console.log('     実測: ' + files.length + '画面すべてに入っている（' + files.join(' / ') + '）');
});

T('★帯より先に接続設定を読んでいる（読む順が逆だと判定できず出ない）', () => {
  for (const f of shippedHtml()) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const cfg = s.indexOf('supa-config.js');
    const bar = s.indexOf('env-badge.js');
    ok(cfg >= 0, f + ' が接続設定を読んでいない（帯が判定できない）');
    ok(cfg < bar, f + ' が帯より後に接続設定を読んでいる');
  }
});

T('★帯のぶんだけ中身を下げる（上の帯・1行目を隠さない）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/env-badge.js'), 'utf8');
  ok(/paddingTop/.test(src), '中身を下げていない（帯が1行目に被る）');
  ok(/sticky/.test(src), '画面の上に貼り付く物（appbar）をずらしていない');
  ok(/cs\.position !== 'sticky'/.test(src), 'fixed（ログイン画面・小窓）まで下げている');
  ok(!/cs\.position !== 'fixed'/.test(src), 'fixed を対象に含めている');
  ok(/offsetHeight/.test(src), '帯の高さを実際に測っていない（決め打ちは2行になった時に破れる）');
  ok(/resize/.test(src), '幅が変わった時に合わせ直していない');
});

T('★iOSの時計に潜らない（safe-area を足している）', () => {
  ok(/env\(safe-area-inset-top\)/.test(BADGE.CSS), 'safe-area を見ていない');
});

T('★帯の文が1文字ずつ縦に割れない書き方（前科3回）', () => {
  ok(!/word-break\s*:\s*break-all/.test(BADGE.CSS), 'break-all がある');
  ok(/white-space\s*:\s*normal/.test(BADGE.CSS), '折り返せない');
  ok(/overflow-wrap\s*:\s*break-word/.test(BADGE.CSS), '長い語がはみ出す');
  ok(!/display\s*:\s*flex|display\s*:\s*grid/.test(BADGE.CSS), 'flex/grid の箱に文を入れている');
});

T('★紙には出さない（印刷したら消える）', () => {
  ok(/@mediaprint\{#tc-envbar\{display:none/.test(BADGE.CSS.replace(/\s/g, '')), '刷った紙に帯が出る');
});

T('★文言が「何が起きるか」を言っている（ただの札にしない）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/env-badge.js'), 'utf8');
  ok(/テスト環境/.test(src), '見出しが無い');
  ok(/本番には入りません/.test(src), '「ここで入れた物は本番に入らない」と言っていない');
});

T('★帯の色は主色の黄と混ざらない（注意は赤に寄せる・橙を使わない）', () => {
  ok(/#B3261E/i.test(BADGE.CSS), '赤を使っていない');
  ok(!/#FFC72C|#F0B400|#FFE08A/i.test(BADGE.CSS), '★帯に主色の黄を使っている＝画面に溶ける★');
  ok(!/#92500A|#FF9900/i.test(BADGE.CSS), '注意の橙を使っている（主色と混ざる）');
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
