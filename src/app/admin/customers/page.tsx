import { Suspense } from "react";
import { CustomersView } from "./view";

export default function CustomersPage() {
  return (
    <Suspense fallback={<p className="px-8 py-7 text-mute">載入中…</p>}>
      <CustomersView />
    </Suspense>
  );
}
