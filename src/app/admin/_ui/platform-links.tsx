"use client";

/**
 * 左側選單底部（使用者上方）：周家四個平台的圖示，點了開新分頁到那個平台。
 * 四個專案（chou-platform、chou-partner、chou-line-bot、chou-weather）各放一份同樣的檔案，只有 current 不同。
 * 圖示檔在各專案的 public/platforms/<id>.svg（和各平台自己的分頁圖示相同）。
 */
export const PLATFORMS = [
  { id: "chou-platform", name: "農場管理平台", url: "https://chou-platform.vercel.app" },
  { id: "chou-partner", name: "客戶管理系統", url: "https://chou-partner.vercel.app" },
  { id: "chou-line-bot", name: "LINE 客服", url: "https://chou-line-bot.vercel.app/admin" },
  { id: "chou-weather", name: "上巴陵天氣", url: "https://chou-weather.vercel.app" },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]["id"];

export function PlatformLinks({ current, mini, captionClass }: { current: PlatformId; mini: boolean; captionClass: string }) {
  const size = mini ? 28 : 34;
  return (
    <div className={mini ? "pb-2" : "px-2 pb-2"}>
      {!mini && <div className={`mb-1.5 text-xs ${captionClass}`}>周家平台（點了開新分頁）</div>}
      <div className={mini ? "flex flex-col items-center gap-2" : "flex gap-2.5"}>
        {PLATFORMS.map((p) =>
          p.id === current ? (
            <span
              key={p.id}
              title={`目前在這個平台：${p.name}`}
              aria-label={`目前在這個平台：${p.name}`}
              className="rounded-lg ring-2 ring-white/85 ring-offset-2 ring-offset-transparent"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/platforms/${p.id}.svg`} width={size} height={size} alt="" className="block" />
            </span>
          ) : (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`開新分頁：${p.name}`}
              aria-label={`開新分頁：${p.name}`}
              className="rounded-lg opacity-85 transition hover:-translate-y-0.5 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/platforms/${p.id}.svg`} width={size} height={size} alt="" className="block" />
            </a>
          ),
        )}
      </div>
    </div>
  );
}
