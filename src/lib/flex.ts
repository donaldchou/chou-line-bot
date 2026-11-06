import type { LineMessage } from "./line";
import type { OrderDraftDoc } from "./models";
import { SYS_INFO, queryPage, type OrderInfo, type Product, type Sys } from "./ll3";

/* LINE Flex 訊息（樣式同 UI 確認稿） */

const GREEN = "#2F7D4F";
const ORANGE = "#E07B2A";
const GREY = "#4A5563";
export const TRACK_URL = "https://www.t-cat.com.tw/inquire/trace.aspx";

const DELIVERY = { AM: "早上 08～12 點", FM: "中午 12～18 點", NIGHT: "晚上 18～22 點" } as const;
const PAY = { cod: "貨到付款", atm: "匯款或 ATM 轉帳", card: "刷卡繳費" } as const;
export const deliveryText = (d: keyof typeof DELIVERY) => DELIVERY[d];
export const payText = (p: keyof typeof PAY) => PAY[p];

const money = (n: number) => `${n.toLocaleString("zh-TW")} 元`;

const row = (label: string, value: string, opts: { bold?: boolean; color?: string; size?: string } = {}) => ({
  type: "box",
  layout: "horizontal",
  spacing: "md",
  contents: [
    { type: "text", text: label, size: opts.size ?? "sm", color: GREY, flex: 0 },
    { type: "text", text: value || "－", size: opts.size ?? "sm", align: "end", wrap: true, weight: opts.bold ? "bold" : "regular", color: opts.color ?? "#1F2933" },
  ],
});
const sep = { type: "separator", margin: "md" };
const header = (text: string, color: string) => ({
  type: "box",
  layout: "vertical",
  backgroundColor: color,
  paddingAll: "12px",
  contents: [{ type: "text", text, color: "#FFFFFF", weight: "bold", size: "md", wrap: true }],
});
const btn = (label: string, action: Record<string, string>, style: "primary" | "secondary" | "link" = "primary") => ({
  type: "button",
  style,
  height: "sm",
  color: style === "primary" ? GREEN : undefined,
  action: { label, ...action },
});

const flex = (altText: string, contents: unknown): LineMessage => ({ type: "flex", altText: altText.slice(0, 400), contents });

/** 3. 產品照片：左右滑動的卡片 */
export function productCarousel(sys: Sys, products: { p: Product; img: string | null }[]) {
  const bubbles = products.slice(0, 10).map(({ p, img }) => ({
    type: "bubble",
    size: "kilo",
    ...(img ? { hero: { type: "image", url: img, size: "full", aspectRatio: "4:3", aspectMode: "cover" } } : {}),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        { type: "text", text: p.name, weight: "bold", size: "md", wrap: true },
        { type: "text", text: `NT$ ${p.price.toLocaleString("zh-TW")} / 盒`, color: "#B45309", weight: "bold", size: "md" },
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        btn("訂這個", { type: "postback", data: `order:${sys}:${p.id}`, displayText: `我要訂${p.name}` }),
        ...(img ? [btn("看大張照片", { type: "postback", data: `photo:${sys}:${p.id}`, displayText: `看${p.name}的照片` }, "link")] : []),
      ],
    },
  }));
  return flex(`${SYS_INFO[sys].label}產品介紹`, { type: "carousel", contents: bubbles });
}

/** 5. 確認訂單卡 */
export function confirmCard(d: OrderDraftDoc) {
  const x = d.data;
  const q = d.quote;
  const recv = x.recipientSame ? "同訂購者" : `${x.recipientName} ${x.recipientPhone}`;
  return flex(`請確認您的訂單，總金額 ${q.total} 元`, {
    type: "bubble",
    header: header("請確認您的訂單", ORANGE),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        row("訂購者", `${x.buyerName} ${x.buyerPhone}`),
        row("收件者", recv),
        row("地址", x.address),
        row("送達時段", deliveryText(x.delivery)),
        row("付款方式", payText(x.pay)),
        ...(x.memo ? [row("備註", x.memo)] : []),
        sep,
        ...q.lines.map((l) => row(`${l.name} × ${l.qty}`, money(l.price * l.qty))),
        row(`運費（${q.boxes} 盒）`, q.ship ? money(q.ship) : "免運費"),
        ...(q.cod ? [row("貨到付款手續費", money(q.cod))] : []),
        sep,
        row("總金額", money(q.total), { bold: true, color: "#B45309", size: "md" }),
      ],
    },
    footer: {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        btn("確認下單", { type: "postback", data: `confirm:${d._id}`, displayText: "確認下單" }),
        btn("我要修改", { type: "postback", data: `edit:${d._id}`, displayText: "我要修改" }, "secondary"),
      ],
    },
  });
}

/** 5. 下單完成卡 */
export function successCard(d: OrderDraftDoc, orderId: number) {
  const q = d.quote;
  return flex(`訂購成功！訂單編號 No.${orderId}`, {
    type: "bubble",
    header: header("訂購成功，謝謝您！", GREEN),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        row("訂單編號", `${SYS_INFO[d.sys].label} No.${orderId}`, { bold: true, size: "md" }),
        row("商品", q.lines.map((l) => `${l.name} × ${l.qty}`).join("、")),
        row("總金額", `${money(q.total)}（${payText(d.data.pay)}）`),
        sep,
        {
          type: "text",
          wrap: true,
          size: "sm",
          color: GREY,
          margin: "md",
          text: "查詢訂單：在這裡輸入「查訂單」，或到訂單查詢網頁，輸入訂購者姓名或電話。出貨時我們也會用 LINE 通知您。",
        },
      ],
    },
    footer: { type: "box", layout: "vertical", contents: [btn("開啟訂單查詢網頁", { type: "uri", uri: queryPage(d.sys) }, "secondary")] },
  });
}

const shipped = (o: OrderInfo) => o.schedule.includes("已送出") || o.waybills.length > 0;
const cancelled = (o: OrderInfo) => o.schedule.includes("取消");

/** 7. 查詢訂單：每筆一張卡 */
export function orderCarousel(list: { sys: Sys; o: OrderInfo }[]) {
  const bubbles = list.slice(0, 10).map(({ sys, o }) => {
    const badge = cancelled(o) ? ["已取消", "#B3261E"] : shipped(o) ? ["已寄出", GREEN] : ["處理中", ORANGE];
    const w = o.waybills;
    return {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            contents: [
              { type: "text", text: `${SYS_INFO[sys].label} No.${o.id}`, weight: "bold", size: "md", flex: 1 },
              { type: "text", text: badge[0], color: badge[1], weight: "bold", size: "sm", align: "end", flex: 0 },
            ],
          },
          row("下單日期", (o.time ?? "").slice(0, 10)),
          row("商品", o.items.map((i) => `${i.name} × ${i.qty}`).join("、") + (o.extras ? `、${o.extras}` : "")),
          row("收件者", o.recipient),
          row("總金額", money(o.total)),
          sep,
          ...(w.length
            ? w.flatMap((x) => [
                row(w.length > 1 ? `託運單 ${x.pkg}/${x.pkgTotal}` : "託運單號", x.obt, { bold: true }),
                row("寄送進度", x.status ? `${x.status}${x.statusTime ? `（${x.statusTime.slice(5)}）` : ""}` : "尚未更新"),
              ])
            : [{ type: "text", text: cancelled(o) ? "此訂單已取消" : "尚未寄出，寄出時會用 LINE 通知您。", size: "sm", color: GREY, wrap: true, margin: "md" }]),
        ],
      },
      ...(w.length ? { footer: { type: "box", layout: "vertical", contents: [btn("到黑貓查詢包裹", { type: "uri", uri: TRACK_URL })] } } : {}),
    };
  });
  return flex(`找到 ${list.length} 筆訂單`, { type: "carousel", contents: bubbles });
}

/** 8. 寄出通知卡 */
export function shippedCard(sys: Sys, o: OrderInfo, hasImages: boolean) {
  const w = o.waybills;
  return flex(`您的${SYS_INFO[sys].label}已經寄出囉！託運單號 ${w.map((x) => x.obt).join("、")}`, {
    type: "bubble",
    header: header(`您的${SYS_INFO[sys].label}已經寄出囉！`, GREEN),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        row("訂單編號", `No.${o.id}`, { bold: true }),
        row("商品", o.items.map((i) => `${i.name} × ${i.qty}`).join("、")),
        row("收件者", o.recipient),
        row("宅配", "黑貓宅急便・預計明天送達"),
        sep,
        ...w.map((x) => row(w.length > 1 ? `託運單號 ${x.pkg}/${x.pkgTotal}` : "託運單號", x.obt, { bold: true, color: "#B3261E", size: "md" })),
        ...(hasImages ? [{ type: "text", text: "託運單照片在下一則訊息，可以點開放大。", size: "sm", color: GREY, wrap: true, margin: "md" }] : []),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        btn("到黑貓查詢寄送進度", { type: "uri", uri: TRACK_URL }),
        btn("複製託運單號", { type: "clipboard", clipboardText: w.map((x) => x.obt).join(" ") }, "secondary"),
      ],
    },
  });
}
