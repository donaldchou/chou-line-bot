export default function Home() {
  return (
    <main className="mx-auto max-w-xl p-8 font-sans text-gray-800">
      <h1 className="text-2xl font-bold text-green-800">拉拉山周家農場 LINE 客服機器人</h1>
      <p className="mt-3 text-sm text-gray-600">這裡是 LINE 官方帳號的後端服務，客人請直接在 LINE 與我們對話。</p>
      <a href="/admin" className="mt-6 inline-block rounded-lg bg-green-800 px-4 py-2.5 text-sm font-bold text-white">
        進入管理後台
      </a>
      <ul className="mt-6 list-disc space-y-1 pl-5 text-sm text-gray-600">
        <li>Webhook：/api/line/webhook</li>
        <li>寄出通知：/api/notify/shipped（ll3 後台按鈕）</li>
        <li>6 小時關心排程：/api/cron/followup</li>
      </ul>
    </main>
  );
}
