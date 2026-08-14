/* supa-config.js — ★テスト用DB★ (timeally-test)
 * ============================================================================
 * ★このrepoで 倉庫の向き先（URL・鍵・ref）を持ってよいのは このファイルだけ★
 *   他のどのファイルにも書かない。tests/no-hardcoded-supa.test.mjs が破りを赤にする。
 *
 * ★repo名を環境の証拠にするな★
 *   実際に `Exally-test` という名前のフォルダの中身が【代行請求の本番】だった事故がある
 *   （それを信じて本番を22時間 壊した）。判断は ★remote と この env★ でする。
 *
 * ★このファイルを本番repo(timeally)に絶対にコピーしない★
 *   本番は 本番倉庫を指し、env:'prod'。前科: 直書きがスナップショットに付いてきて
 *   「テストのつもりで本番倉庫を触った」／staging だけ直して本番が6日そのままだった。
 *
 * env = この配信がどの環境か（'test' | 'prod'）
 *   画面の一番上に「テスト環境」の帯を出すかを、これ1つで決める（js/env-badge.js）。
 *   ★本番の supa-config.js は env:'prod'。だから本番に帯は出ない。★
 *
 * 倉庫: DB-test（exally-staging / payslip-app-test と同じテスト倉庫を共有）
 *   ＝1つのテストアカウントで全アプリを触れる（本番と同じ倉庫共有の形）。
 * 部屋(schema): timeally。アプリは public の同名の窓口(view)ごしに読む
 *   （窓は security_invoker=true ＝ 呼んだ人の権利で開く＝実の棚のRLSがそのまま効く）。
 */
window.SUPA = {
  url: 'https://khawdrnvssdenumbiwfg.supabase.co',
  key: 'sb_publishable_UrRIobyVFbaJI_85RBxBOA_GZ4OUxPm',
  env: 'test'
};
