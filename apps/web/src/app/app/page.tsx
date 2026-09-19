import { Explore } from "@/components/launchpad/explore";
import { discovery } from "@/lib/launchpad/discovery";

export default async function Page() {
  const initial = await discovery({
    sort: "volume",
    pair: "All",
    search: "",
    page: 0,
  }).catch(() => undefined);
  return <Explore initial={initial} />;
}
