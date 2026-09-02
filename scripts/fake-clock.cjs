/* fake-clock.cjs — ★「今日」を差し替えてから 試験を走らせる★（Timeally）
 * =============================================================================
 * ★なぜ要るか★（2026-09-02 実際に起きた）
 *   日付が 9/2 になった瞬間、★中身も画面も壊れていないのに★
 *   ui-sweep 2本・print-check 6件が 赤になった。
 *   ＝★試験が「今日が8月」に寄りかかっていた★（押す回数や月の名前を直に書いていた）。
 *   ★毎月1日に必ず赤くなる＝「たまに赤」の正体★になり、本当の赤を見なくさせる。
 *
 * ★この道具は 読むだけ★（倉庫も配信も触らない）。
 *   node の --require で先に読み込み、★Date だけ★を差し替える。
 *   子の試験にも効かせるため NODE_OPTIONS で渡す（scripts/clock-travel.mjs がやる）。
 *
 * ★アプリの名前を持たせない★（借り物が使えなかった件と同じ轍を踏まない）。
 */
/* ★名前は FAKE_NOW に揃える★（2026-09-02 経営者の決定＝他アプリの報告と突き合わせる為）
   ★前の名前(TA_FAKE_NOW)も 残す★（もう走っている物を 止めない）。 */
const iso = process.env.FAKE_NOW || process.env.TA_FAKE_NOW;
if (iso) {
  const fixed = new Date(iso).getTime();
  if (Number.isNaN(fixed)) throw new Error('FAKE_NOW が読めません: ' + iso);
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) { super(fixed); } else { super(...a); } }
    static now() { return fixed; }
  }
  globalThis.Date = FakeDate;
}
