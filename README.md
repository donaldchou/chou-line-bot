# chou-line-bot — 拉拉山周家農場 LINE AI 客服

Next.js 16（只有 API）＋ Gemini ＋ MongoDB Atlas。訂單寫進 ll3 舊訂單系統（甜柿 `/kaki_order`、水蜜桃 `/order`）。

## 功能
| 功能 | 位置 |
|---|---|
| AI 回覆常見問題（參考最近 15 筆對話） | `src/lib/bot.ts`、`src/lib/knowledge.ts`（FAQ 在這裡改） |
| 產品照片卡片（照片、價格來自網站後台 product 表） | `send_product_photos` → `src/lib/flex.ts` |
| 收集訂購者／收件者資料 → 確認卡 → 客人按「確認下單」才建單 | `prepare_order`、`confirmOrder` → ll3 `line_api.asp?a=create` |
| 查訂單（訂購者姓名或電話） | `lookup_orders` → ll3 `line_api.asp?a=query` |
| 沒下單：每 6 小時關心，最多 2 次（09:00～21:00 才傳） | `src/lib/followup.ts`、`/api/cron/followup` |
| 寄出通知（寄出卡＋託運單照片＋黑貓查詢） | ll3 vieworder「LINE 通知客人寄出」按鈕 → `/api/notify/shipped`；或後台「LINE 訂單」頁的按鈕 |
| 管理後台（RWD）：客戶進度看板、需要處理的客戶、聊天內容、真人回覆、LINE 訂單 | `/admin`（`/login` 輸入 `ADMIN_PASSWORD`）、`src/app/admin`、`src/lib/admin-*.ts`、`src/lib/progress.ts` |

### 後台的客戶進度
詢問中 → 填資料中 → 確認卡未按 → 已下單 → 已寄出，另外一欄是「沒有下單」（關心 2 次、再過 6 小時客人都沒回）。
- 進度由機器人自動更新：問產品、填資料（AI 回報）、送出確認卡、按確認下單、寄出通知。已下單或已寄出的客人再來問，就開始新的一輪。
- 「需要你處理」：AI 答不出來、客人想找真人／抱怨或損傷（AI 呼叫 `flag_customer`）、確認卡超過 3 小時沒按、已印託運單但還沒傳寄出通知。
- 真人回覆：用 push 傳（算訊息則數），傳送後機器人暫停 12 小時，可手動恢復；暫停期間也不會自動關心。

## 環境變數（`.env.local`，Vercel 也要設一樣的）
- `MONGODB_URI`：Atlas，資料庫 `chou-line-bot`
- `GEMINI_API_KEY`（可選 `GEMINI_MODEL`，預設 gemini-3.6-flash，失敗改 3.5-flash-lite）
- `LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`
- `LL3_LINE_KEY`：與 ll3 `line_config.asp` 共用的金鑰
- `BOT_BASE_URL`：例 `https://chou-line-bot.vercel.app`（圖片連結用）
- `CRON_SECRET`、`IMG_SIGN_KEY`
- `ADMIN_PASSWORD`：管理後台密碼（改密碼後所有已登入的裝置都要重新登入）
- `LL3_HOST`：只在本機測試時設定

## ll3 主機要上傳的檔案
`ll3\build.ps1` 產生 Big5 檔案到 `ll3\dist\kaki_order`、`ll3\dist\order`（含金鑰，已 gitignore）：
- `line_config.asp`、`line_api.asp`、`line_token.asp`（新檔）
- `vieworder_suda.asp`（線上版本＋include＋`LineNotifyBox`）

`vieworder_suda.asp` 是拿 chou-suda-print 的 `asp_change_code` / `peach_asp_change_code` 來改的。那邊的版本更新之後，要重新跑一次 build。
第一次呼叫 API 時會自動建立 `Line_Order` 資料表（機器人建立的訂單和 LINE 使用者的對應）。

## 上線步驟
1. LINE Developers 建立 Messaging API channel，取得 Channel secret / Channel access token。
2. Vercel 建立專案，設定環境變數後部署。
3. LINE Developers → Messaging API → Webhook URL：`https://<網域>/api/line/webhook`，開啟 Use webhook；LINE 官方帳號管理後台關閉「自動回應訊息」。
4. 上傳 ll3 檔案（`ll3\dist`）。
5. cron-job.org 每小時呼叫：`https://<網域>/api/cron/followup?key=<CRON_SECRET>`。
6. 圖文選單：在 LINE 官方帳號管理後台建立 6 格選單，各格送出文字「我要訂購」「產品介紹」「查訂單」「常見問題」，「聯絡農場」用電話連結、「農場位置」用地圖連結。

## 注意
- 回覆用 reply（免費）；主動關心與寄出通知是 push 訊息，會算 LINE 官方帳號的每月訊息則數。
- Gemini 免費額度每天約 20 次，正式使用需要付費方案。
