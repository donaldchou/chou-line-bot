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
| 管理後台（RWD）：客戶進度看板、需要處理的客戶、聊天內容、真人回覆、LINE 訂單 | `/admin`（`/login` 用 email＋密碼登入）、`src/app/admin`、`src/lib/admin-*.ts`、`src/lib/progress.ts` |
| 左側選單（照 chou-platform）：桌機浮動、可收合成圖示、分組可展開收合（記在瀏覽器）；手機用抽屜 | `src/app/admin/_ui/shell.tsx` |
| 後台管理（只有管理者）：使用者管理、頁面權限、所有資料（檢視／搜尋／刪除）、驗證碼解鎖 | `/admin/system`、`src/app/api/admin/system/*`、`src/lib/auth.ts`、`src/lib/page-access.ts` |

| 分群標籤（甜柿客／水蜜桃客／詢問未下單／回購客／VIP）、總覽「機器人表現」 | `src/lib/segments.ts`、`botStats()`（`src/lib/admin-data.ts`） |
| 接單設定：各規格 接單中／本週額滿／停止接單、每週上限盒數（只算 LINE 訂單），機器人照設定回覆、不收單 | `/admin/capacity`、`src/lib/capacity.ts` |
| 群發訊息：選分群、文字＋產品卡片、馬上或排定（09:00～21:00）、7 天內收過的排除、紀錄含 7 天內回覆／下單 | `/admin/push`、`src/lib/broadcast.ts`（排程由 `/api/cron/followup` 一起處理） |

### 帳號與權限
- 身分分「管理者」和「一般使用者」。一般使用者只能檢視（不能回覆客人、暫停機器人、傳寄出通知），看得到哪些頁面由「頁面權限」決定。
- 第一次使用（還沒有任何帳號）時，登入頁會要求輸入 `ADMIN_PASSWORD` 建立第一個管理者；之後的帳號都從「後台管理 → 使用者管理」新增。
- 後台管理的新增／修改／刪除都要輸入驗證碼 `ADMIN_CODE`，也可以在後台上方「驗證碼解鎖」1～12 小時。
- 密碼用 scrypt 雜湊存在 `adminUsers` 集合；登入憑證是 HMAC 簽章的 cookie（`AUTH_SECRET`），7 天有效。

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
- `ADMIN_PASSWORD`：初始密碼，只在還沒有任何帳號時用來建立第一個管理者
- `AUTH_SECRET`：登入憑證的簽章金鑰（至少 32 個字元；改掉後所有人都要重新登入）
- `ADMIN_CODE`：後台管理的驗證碼（新增／修改／刪除帳號、頁面權限、刪除資料）
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
5. cron-job.org 每 15 分鐘呼叫（同時處理 6 小時關心和排程群發）：`https://<網域>/api/cron/followup?key=<CRON_SECRET>`。
6. 圖文選單：在 LINE 官方帳號管理後台建立 6 格選單，各格送出文字「我要訂購」「產品介紹」「查訂單」「常見問題」，「聯絡農場」用電話連結、「農場位置」用地圖連結。

## 注意
- 回覆用 reply（免費）；主動關心與寄出通知是 push 訊息，會算 LINE 官方帳號的每月訊息則數。
- Gemini 免費額度每天約 20 次，正式使用需要付費方案。
