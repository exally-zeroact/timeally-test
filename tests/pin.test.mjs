/* pin.test.mjs — ★秘密は「暗証番号」1つだけ★（Timeally）
 * =============================================================================
 * ★テストを先に書いた★（司さんの指摘 2026-08-15）。ここが合格の線。
 *
 *   ・★従業員が触る秘密は 暗証番号1つだけ★（画面から「あいことば」が0件）
 *   ・★数字4〜6桁★（端＝3桁と7桁で止まり、4桁と6桁は通る）
 *   ・★1111 のような並びを止めない★（止めると人は紙に書く）
 *   ・★2回目からは決められない★（入口を作り直すまで）
 *   ・★倉庫(SQL)と画面(JS)が同じ線★
 *
 * 使い方: node tests/pin.test.mjs
 *         node tests/pin.test.mjs --self-test
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
const P = require_(path.join(ROOT, 'lib/tc-pin.js'));
const SQL = fs.readFileSync(path.join(ROOT, 'supabase/schema.sql'), 'utf8');

let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); pass++; console.log('  ✓ ' + n); } catch (e) { fail++; console.log('  ✗ ' + n + ' — ' + (e && e.message)); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
const ok = (v, m) => { if (!v) throw new Error(m || 'false'); };

console.log('\n[暗証番号] 秘密は1つだけ');

/* ── ① 桁の端（等号を実物で測る） ─────────────────────────────── */
T('★★4桁と6桁は通る／3桁と7桁は止まる（端）★★', () => {
  eq(P.check('1234').ok, true, '4桁');
  eq(P.check('123456').ok, true, '6桁');
  eq(P.check('123').ok, false, '★3桁が通ってしまう★');
  eq(P.check('1234567').ok, false, '★7桁が通ってしまう★');
  ok(/4桁から6桁/.test(P.check('123').msg), '止めた理由を言っていない: ' + P.check('123').msg);
});

T('★★1111 のような並びは止めない（止めると人は紙に書く）★★', () => {
  ['1111', '0000', '123456', '111111', '1234'].forEach(function (s) {
    eq(P.check(s).ok, true, '★' + s + ' を止めている★');
  });
});

T('★数字以外は止まる（理由も言う）', () => {
  ['abcd', '12a4', '１２３ａ'].forEach(function (s) {
    const r = P.check(s);
    eq(r.ok, false, s + ' が通ってしまう');
    ok(/数字/.test(r.msg), '理由が数字の話でない: ' + r.msg);
  });
  eq(P.check('').ok, false, '空');
  eq(P.check(null).ok, false, '空(null)');
  eq(P.check(undefined).ok, false, '空(undefined)');
});

T('★★全角の数字でも通る（スマホは全角になる事がある）★★', () => {
  eq(P.check('１２３４').ok, true, '全角4桁');
  eq(P.check('１２３４').pin, '1234', '★半角に直していない（倉庫に全角が入る）★');
  eq(P.check('12 34').pin, '1234', '空白は落とす');
  eq(P.check('12-34').pin, '1234', 'ハイフンは落とす');
});

T('★2つ入れてもらう時は 食い違いを止める', () => {
  eq(P.checkPair('1234', '1234').ok, true);
  eq(P.checkPair('1234', '1235').ok, false);
  ok(/違います/.test(P.checkPair('1234', '1235').msg), '理由: ' + P.checkPair('1234', '1235').msg);
  /* ★片方が全角でも同じ物として扱う★ */
  eq(P.checkPair('1234', '１２３４').ok, true, '全角と半角で食い違い扱いにしている');
  /* ★桁の間違いは 食い違いより先に言う★（人は「違います」より「4桁です」で直せる） */
  ok(/4桁から6桁/.test(P.checkPair('12', '99').msg), '桁の間違いを先に言っていない');
});

/* ── ② 倉庫(SQL)と同じ線か ────────────────────────────────── */
T('★★倉庫(SQL)と画面(JS)が同じ線（4〜6桁の数字）★★', () => {
  /* SQL 側: p_pin ~ '^[0-9]{4,6}$' */
  const m = /p_pin\s*!~\s*'(\^\[0-9\]\{4,6\}\$)'/.exec(SQL) || /p_pin\s*~\s*'(\^\[0-9\]\{4,6\}\$)'/.exec(SQL);
  ok(m, '★SQL 側に 4〜6桁の線が無い★');
  const sqlRe = new RegExp(m[1]);
  /* ★同じ入力で 同じ答えになるか 総当たりで確かめる★（3〜7桁＋文字） */
  const cases = ['1', '12', '123', '1234', '12345', '123456', '1234567', '0000', '9999', 'abcd', '12a4', ''];
  cases.forEach(function (s) {
    eq(P.check(s).ok, sqlRe.test(s), '★' + JSON.stringify(s) + ' で 倉庫と画面の答えが違う★');
  });
  console.log('     実測: ' + cases.length + '通りで 倉庫と画面が一致');
});

T('★★倉庫は「2回目は決められない」を自分で止める（画面だけに任せない）★★', () => {
  const body = SQL.split('create or replace function public.tc_pin_set')[1].split('end $$;')[0];
  ok(/pw_hash is not null/.test(body), '★すでに決まっているかを見ていない★');
  ok(/already_set/.test(body), '2回目を断る返しが無い');
  ok(/p_pin\s*!~/.test(body), '★倉庫で桁を見ていない（画面を直せば何でも入る）★');
  /* ★初回コード(init_code)は もう要らない★＝引数から消えている事 */
  ok(!/p_init/.test(body), '★まだ初回コードを受け取っている（秘密が2つのまま）★');
});

T('★★決めた／作り直した を 追記で残す（社長が身に覚えを確かめられる）★★', () => {
  const body = SQL.split('create or replace function public.tc_pin_set')[1].split('end $$;')[0];
  ok(/insert into timeally\.tc_close/.test(body), '★決めた事を残していない★');
  ok(/'pin_set'/.test(body), 'pin_set として残していない');
  ok(/check \(action in \('close','reopen','export','pin_set','pin_reissue'\)\)/.test(SQL),
    '★帳面が pin_set / pin_reissue を受け付けない★');
});

/* ── ③ 言葉（画面に「あいことば」を残さない） ──────────────── */
T('★★「あいことば」という言葉が どの画面にも無い（言葉は1つ）★★', () => {
  const files = ['punch.html', 'kiroku.html', 'index.html', 'login.html', 'shukei.html',
    'js/emp-app.js', 'js/owner-app.js', 'lib/tc-pin.js'];
  const bad = [];
  files.forEach(function (f) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    /* ★コメントの中は見逃す★（作り直した経緯を書き残しているため） */
    const stripped = f.endsWith('.html')
      ? src.replace(/<!--[\s\S]*?-->/g, ' ')
      : src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
    if (stripped.indexOf('あいことば') >= 0) bad.push(f);
  });
  eq(bad.length, 0, '★まだ「あいことば」が残っている★: ' + bad.join(', '));
  console.log('     実測: ' + files.length + '本を見て「あいことば」0件');
});

T('★★スマホで数字キーボードが出る（inputmode）★★', () => {
  ['punch.html', 'kiroku.html'].forEach(function (f) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const pins = src.match(/<input[^>]*id="(pin|pin1|pin2)"[^>]*>/g) || [];
    ok(pins.length >= 1, f + ' に暗証番号の欄が無い');
    pins.forEach(function (tag) {
      ok(/inputmode="numeric"/.test(tag), '★' + f + ' の ' + tag.slice(0, 40) + '… に inputmode が無い★');
      ok(/maxlength="6"/.test(tag), '★6桁までに絞っていない★');
      /* ★入力欄は16px★（小さいと iPhone が勝手に拡大してスクロールが壊れる）
         → css で全部の input を16pxにしてあるので、ここでは font-size を打ち消していない事を見る */
      ok(!/font-size:\s*1[0-5]px/.test(tag), '★16px より小さい文字にしている★');
    });
  });
});

/* ── self-test：わざと壊して赤になるか ───────────────────────── */
if (process.argv.includes('--self-test')) {
  console.log('\n[pin --self-test] わざと壊して赤になるか');
  let sp = 0, sf = 0;
  const S = (n, fn) => { try { fn(); sp++; console.log('  ✓ ' + n); } catch (e) { sf++; console.log('  ✗ ' + n + ' — ' + e.message); } };

  S('①「8文字以上の文字列」に戻した作り物は 4桁を止める（本物は通す）', () => {
    const wrong = (s) => String(s).length >= 8;
    eq(wrong('1234'), false, '作り物が壊れていない＝この検査が空振り');
    eq(P.check('1234').ok, true, '★本物が4桁を止めている★');
  });
  S('② 1111 を禁止した作り物は 人に紙を書かせる（本物は通す）', () => {
    const wrong = (s) => !/^(\d)\1+$/.test(s);
    eq(wrong('1111'), false, '作り物が壊れていない');
    eq(P.check('1111').ok, true, '★本物が 1111 を止めている★');
  });
  S('③ 全角を半角に直さない作り物は 倉庫に全角を入れる（本物は直す）', () => {
    const wrong = (s) => String(s);
    eq(wrong('１２３４'), '１２３４', '作り物が壊れていない');
    eq(P.check('１２３４').pin, '1234', '★本物が全角のまま通している★');
  });
  console.log('\n[self-test] ' + sp + ' passed, ' + sf + ' failed');
  if (sf) process.exit(1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
