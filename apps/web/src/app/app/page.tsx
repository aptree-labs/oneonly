import { Explore } from "@/components/launchpad/explore";
import { discovery } from "@/lib/launchpad/discovery";
import { Suspense } from "react";
async function Market() {
  const initial = await discovery({
    sort: "volume",
    pair: "All",
    search: "",
    page: 0,
  }).catch(() => undefined);
  return <Explore initial={initial} />;
}
export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="lp-empty" role="status">
          Loading market…
        </div>
      }
    >
      <Market />
    </Suspense>
  );
}
