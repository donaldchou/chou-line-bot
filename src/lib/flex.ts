import type { LineMessage } from "./line";
import type { OrderDraftDoc } from "./models";
import { SYS_INFO, queryPage, type OrderInfo, type Product, type Sys } from "./ll3";

/* LINE Flex 訊息（樣式同 UI 確認稿） */

const GREEN = "#2F7D4F";
const ORANGE = "#E07B2A";
const GREY = "#4A5563";
export const TRACK_URL = "https://www.t-cat.com.tw/inquire/trace.aspx";

const DELIVERY = { AM: "早上 08～13 點", FM: "中午 13～18 點", NIGHT: "晚上 18～22 點（已停用）" } as const;
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

/** 問答的照片：一區一則可左右滑的相簿，整張照片不裁切，點了看大圖 */
export function photoAlbum(title: string, urls: string[]) {
  const list = urls.slice(0, 12);
  const bubbles = list.map((url, i) => ({
    type: "bubble",
    size: "kilo",
    hero: { type: "image", url, size: "full", aspectRatio: "3:4", aspectMode: "fit", backgroundColor: "#F3F4F1", action: { type: "uri", uri: url } },
    body: {
      type: "box",
      layout: "horizontal",
      paddingAll: "10px",
      contents: [
        { type: "text", text: title, size: "sm", weight: "bold", color: GREEN, flex: 0 },
        { type: "text", text: list.length > 1 ? `${i + 1}／${list.length}　點照片看大圖` : "點照片看大圖", size: "xs", color: GREY, align: "end", gravity: "center" },
      ],
    },
  }));
  return flex(`${title}（${list.length} 張）`, { type: "carousel", contents: bubbles });
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
  return flex(`訂購成功！訂單流水號 ${orderId}`, {
    type: "bubble",
    header: header("訂購成功，謝謝您！", GREEN),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        row("訂單流水號", `${SYS_INFO[d.sys].label} ${orderId}`, { bold: true, size: "md" }),
        row("商品", q.lines.map((l) => `${l.name} × ${l.qty}`).join("、")),
        row("總金額", `${money(q.total)}（${payText(d.data.pay)}）`),
        sep,
        {
          type: "text",
          wrap: true,
          size: "sm",
          color: GREY,
          margin: "md",
          text: "查詢訂單：在這裡輸入「查訂單」，或按下面的按鈕看訂單進度、回報繳費。出貨時我們也會用 LINE 通知您。",
        },
      ],
    },
    footer: { type: "box", layout: "vertical", contents: [btn("查看訂單進度", { type: "uri", uri: queryPage(d.sys, d.data.buyerPhone) }, "secondary")] },
  });
}

const shipped = (o: OrderInfo) => o.schedule.includes("已送出") || o.waybills.length > 0;
const cancelled = (o: OrderInfo) => o.schedule.includes("取消");

/** 7. 查詢訂單：每筆一張卡（樣式同「訂購成功」卡：彩色標題列、左標籤右內容、下面一個按鈕）
 *  phone：客人查詢用的電話，「查看訂單進度」直接開這支電話的訂單頁（沒有就開查詢頁） */
export function orderCarousel(list: { sys: Sys; o: OrderInfo }[], phone?: string) {
  const bubbles = list.slice(0, 10).map(({ sys, o }) => {
    const [title, color] = cancelled(o)
      ? ["這筆訂單已取消", "#B3261E"]
      : shipped(o)
        ? ["已經寄出囉！", GREEN]
        : ["訂單處理中，尚未寄出", ORANGE];
    const w = o.waybills;
    return {
      type: "bubble",
      header: header(title, color),
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          row("訂單流水號", `${SYS_INFO[sys].label} ${o.id}`, { bold: true, size: "md" }),
          row("下單日期", (o.time ?? "").slice(0, 10)),
          row("商品", o.items.map((i) => `${i.name} × ${i.qty}`).join("、") + (o.extras ? `、${o.extras}` : "")),
          row("收件者", o.recipient),
          row("總金額", `${money(o.total)}${o.pay ? `（${o.pay}）` : ""}`),
          sep,
          ...(w.length
            ? w.flatMap((x) => [
                row(w.length > 1 ? `託運單 ${x.pkg}/${x.pkgTotal}` : "託運單號", x.obt, { bold: true }),
                row("寄送進度", x.status ? `${x.status}${x.statusTime ? `（${x.statusTime.slice(5)}）` : ""}` : "尚未更新"),
              ])
            : [
                {
                  type: "text",
                  wrap: true,
                  size: "sm",
                  color: GREY,
                  margin: "md",
                  text: cancelled(o) ? "這筆訂單已取消，有問題請直接留言給我們。" : "還沒寄出，寄出時我們會用 LINE 通知您。按下面的按鈕可以看訂單進度、回報繳費。",
                },
              ]),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          ...(w.length ? [btn("到黑貓查詢包裹", { type: "uri", uri: TRACK_URL })] : []),
          btn("查看訂單進度", { type: "uri", uri: queryPage(sys, phone) }, "secondary"),
        ],
      },
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
        row("訂單流水號", `${o.id}`, { bold: true }),
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
