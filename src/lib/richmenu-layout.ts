/* 圖文選單的版型與格子位置（前後端共用，不能 import 伺服器端的東西） */

export const LAYOUTS = {
  large6: { label: "大型 6 格", width: 2500, height: 1686, cols: 3, rows: 2 },
  large4: { label: "大型 4 格", width: 2500, height: 1686, cols: 2, rows: 2 },
  small6: { label: "小型 6 格", width: 2500, height: 843, cols: 3, rows: 2 },
  small3: { label: "小型 3 格", width: 2500, height: 843, cols: 3, rows: 1 },
} as const;
export type LayoutKey = keyof typeof LAYOUTS;
export const LAYOUT_KEYS = Object.keys(LAYOUTS) as LayoutKey[];
export const isLayout = (v: unknown): v is LayoutKey => typeof v === "string" && v in LAYOUTS;

/** 每一格在圖片上的位置（像素），由左到右、由上到下：A、B、C… */
export function cells(layout: LayoutKey) {
  const { width: W, height: H, cols, rows } = LAYOUTS[layout];
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = Math.round((W * c) / cols);
      const y = Math.round((H * r) / rows);
      out.push({ x, y, w: Math.round((W * (c + 1)) / cols) - x, h: Math.round((H * (r + 1)) / rows) - y });
    }
  return out;
}

export const cellLetter = (i: number) => String.fromCharCode(65 + i);

/** 圖片大小上限（LINE 規定 1MB） */
export const MAX_MENU_IMAGE = 1_000_000;
export const CHAT_BAR_MAX = 14;
export const TEXT_MAX = 300;
export const NAME_MAX = 30;
/** 換過的選單最多留幾個 */
export const HISTORY_KEEP = 10;

export type AreaAction = { type: "message" | "uri"; value: string };
export type MenuArea = { x: number; y: number; w: number; h: number } & AreaAction;

export interface MenuView {
  id: string;
  name: string;
  /** LayoutKey，或從 LINE 匯入、格子對不上的 custom */
  layout: string;
  width: number;
  height: number;
  image: string;
  areas: MenuArea[];
  chatBarText: string;
  selected: boolean;
  status: "active" | "history" | "test";
  appliedAt: string | null;
  appliedBy: string;
  createdAt: string;
}

export interface MenuPageData {
  active: MenuView | null;
  history: MenuView[];
  test: MenuView | null;
  /** 讀不到 LINE 目前的預設選單（連線錯誤）時的訊息 */
  lineError: string;
  me: { lineName: string; bound: boolean; bindCode: string | null; bindExp: string | null };
  commands: { text: string; desc: string }[];
  qas: string[];
}

/** 比對題目用：去掉空白和標點（跟機器人 exactQa 一樣） */
export const qaKey = (s: string) => s.replace(/[\s?？!！。，,.、~～]/g, "");
