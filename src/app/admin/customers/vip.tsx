"use client";

import { useState } from "react";
import type { VipRule } from "@/lib/segments";
import { call, errMsg, inputCls, useCodeGate } from "../_ui/kit";
import { useCanEdit } from "../_ui/me";
import { btn, card } from "../_ui/ui";

/** 客戶列表下方：VIP 條件（管理者可改，需要後台驗證碼） */
export function VipCard({ vip, onSaved }: { vip: VipRule; onSaved: () => void }) {
  const canEdit = useCanEdit();
  const [draft, setDraft] = useState<{ orders: string; amount: string } | null>(null);
  const gate = useCodeGate();
  const cur = draft ?? { orders: String(vip.orders), amount: String(vip.amount) };
  const changed = !!draft && (draft.orders !== String(vip.orders) || draft.amount !== String(vip.amount));

  const save = () =>
    gate.ask({
      title: "修改 VIP 條件",
      confirmLabel: "儲存",
      message: "修改分群的 VIP 條件需要驗證碼。",
      submit: async (code) => {
        try {
          await call("/api/admin/system/segments", { method: "PUT", json: { orders: Number(cur.orders), amount: Number(cur.amount) }, code });
          setDraft(null);
          onSaved();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: errMsg(e) };
        }
      },
    });

  return (
    <section aria-labelledby="vip-h" className={`${card} mt-5 flex flex-wrap items-center gap-3 px-5 py-4`}>
      <div className="mr-auto flex flex-col gap-0.5">
        <h2 id="vip-h" className="text-base font-bold">
          VIP 條件
        </h2>
        <span className="text-[13px] text-mute">符合其中一個就算 VIP；填 0 表示不用這個條件</span>
      </div>
      <label className="flex items-center gap-2 text-sm">
        累計訂單
        <input
          type="number"
          min={0}
          value={cur.orders}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...cur, orders: e.target.value })}
          className={`${inputCls} w-20`}
        />
        筆以上
      </label>
      <span className="text-sm text-mute">或</span>
      <label className="flex items-center gap-2 text-sm">
        累計金額 NT$
        <input
          type="number"
          min={0}
          step={1000}
          value={cur.amount}
          disabled={!canEdit}
          onChange={(e) => setDraft({ ...cur, amount: e.target.value })}
          className={`${inputCls} w-28`}
        />
        以上
      </label>
      {canEdit && (
        <>
          <button type="button" className={btn()} disabled={!changed} onClick={() => setDraft(null)}>
            取消
          </button>
          <button type="button" className={btn("pri")} disabled={!changed} onClick={save}>
            儲存
          </button>
        </>
      )}
      {gate.dialog}
    </section>
  );
}
