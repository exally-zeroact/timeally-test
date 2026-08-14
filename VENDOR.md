# 借りてきた物（★新規で作らなかった物★）

★作る前に「社内に同じ物が無いか」を機械で探して、見つかった物は【設計をなぞる】か【そのまま借りる】。★
下は **そのまま借りた（1バイトも変えていない）** ファイル。取り込み日 **2026-08-14**。

| このrepoの場所 | 出どころ（repo / パス） | 出どころの `origin/main` | git blob（同一の証拠） |
|---|---|---|---|
| `js/file-out.js` | `exally-prod` / `js/file-out.js` | `6ce32fb33aee646f3cae66773165f681ca716085` | `c7d8a926a29b82c932f796165691ce81380dd440` |
| `lib/qr.js` | `payslip-app` / `lib/qr.js` | `6e06a73c8dbf550339b4a17172a4de5f068516d6` | `df13f829bf41f36b82f0ed85751ed3b4c39cfeb8` |
| `lib/xlsx.full.min.js` | `exally-staging` / `lib/xlsx.full.min.js` | `9f99a65ee45ca69aacb1e39e609e1484ed144cf9` | `21471af69ef0e4cda1613c2702c54101b92f48d2` |
| `tests/vendor/kintai-csv.js` | `exally-prod` / `kyuyo/lib/kintai-csv.js` | `6ce32fb33aee646f3cae66773165f681ca716085` | `49799e050a449fb9f55a7686894d6053b50867cc` |

`tests/vendor-integrity.test.mjs` が **この表の blob と 実ファイルの blob が一致するか** を毎回数える。
（★ここで守れるのは「こちらで勝手に書き換えていない」ことだけ★。
　出どころ側が変わったかは分からない ⇒ **給与の受け口を触った日は、この表を作り直す**）

---

## 設計だけ なぞった物（コードは持ってきていない）

| 何 | 実物（読んだ場所） | なぞった理由 |
|---|---|---|
| ★従業員の入口（URL＋暗証番号＋端末記憶＋5回で15分ロック＋平文を持たない）★ | `payslip-app/supabase/schema.sql:75〜208`（`pay_meisai_pub` / `meisai_auth` / `meisai_set_password` / `meisai_verify`）★2026-07-06 本番適用+E2E検証済★ | 自分で作ると必ず抜ける（平文保存・総当たり・端末記憶）。**棚の名前が違う（`tc_pub`）だけで中身は同じ設計**。コードのコピーではなく、同じ守り方を `supabase/schema.sql` に書いた |
| ★カレンダーで日付を選ぶ（内部ISO・表示 M/D）★ | `Exally-test`(=daikou-seikyu) / `daikou-seikyu.html` の `.date-wrap` / `.date-show` / `.date-input` と `setEntryDate()` | 透明な `<input type="date">` を重ねて `showPicker()` を呼ぶ形。**iOSでも確実に出る**実績のある形をなぞった |
| ★テスト環境の帯★ | `exally-staging/js/env-badge.js` ＋ `tests/env-badge.test.mjs` | 仕組み（名札で決める・safe-area・sticky だけ下げる・縦割れ防止）は**そのまま**。色だけ主色の黄と混ざらない赤に替えた |
| ★倉庫の向き先の見張り★ | `exally-staging/tests/no-hardcoded-supa.test.mjs` | 「refは repo から形で学ぶ」考え方ごと持ってきた（このrepoにも本物のrefを1文字も書かない） |
