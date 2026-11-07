/** 客戶分群（前後端共用）：機器人依對話和訂單自動分，一位客人可以同時在好幾群 */
export const SEGMENTS = [
  { key: "kaki", name: "甜柿客", bg: "#FCEBDA", fg: "#8F4708", dot: "#D9843A", rule: "問過甜柿，或在 LINE 買過甜柿的客人" },
  { key: "peach", name: "水蜜桃客", bg: "#FBE6EE", fg: "#93325A", dot: "#C9507F", rule: "問過水蜜桃，或在 LINE 買過水蜜桃的客人" },
  { key: "ask", name: "詢問未下單", bg: "#E3ECF7", fg: "#1D4E8F", dot: "#3F7FBF", rule: "問過產品，但還沒在 LINE 下過單（包含「沒有下單」）" },
  { key: "repeat", name: "回購客", bg: "#DFF2E7", fg: "#17613E", dot: "#1E9E5F", rule: "在 LINE 下過 2 筆以上訂單" },
  { key: "vip", name: "VIP", bg: "#14342A", fg: "#FFFFFF", dot: "#14342A", rule: "累計訂單筆數或金額達到 VIP 條件" },
] as const;

export type SegKey = (typeof SEGMENTS)[number]["key"];
export const SEG_KEYS: SegKey[] = SEGMENTS.map((s) => s.key);
export const isSegKey = (v: unknown): v is SegKey => SEG_KEYS.includes(v as SegKey);
export const segOf = (k: SegKey) => SEGMENTS.find((s) => s.key === k)!;

/** VIP 條件：符合其中一個就算（後台可以改） */
export type VipRule = { orders: number; amount: number };
export const DEFAULT_VIP: VipRule = { orders: 3, amount: 10000 };

export function segmentsFor(x: { asked: string[]; bought: string[]; orders: number; amount: number; asking: boolean }, vip: VipRule): SegKey[] {
  const out: SegKey[] = [];
  if (x.asked.includes("kaki") || x.bought.includes("kaki")) out.push("kaki");
  if (x.asked.includes("peach") || x.bought.includes("peach")) out.push("peach");
  if (x.orders === 0 && (x.asked.length > 0 || x.asking)) out.push("ask");
  if (x.orders >= 2) out.push("repeat");
  if ((vip.orders > 0 && x.orders >= vip.orders) || (vip.amount > 0 && x.amount >= vip.amount)) out.push("vip");
  return out;
}
