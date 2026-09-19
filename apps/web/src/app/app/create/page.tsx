import { createPrefill } from "@/lib/create-prefill";
import { CreateToken } from "@/components/launchpad/create";
export const metadata = {
  title: "Launch a token",
  alternates: { canonical: "https://oneonly.lol/app/create" },
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { ticker, quote } = createPrefill(
    typeof params.ticker === "string" ? params.ticker : "",
    typeof params.quote === "string" ? params.quote : "SOL",
  );
  return (
    <CreateToken
      key={`${ticker}:${quote}`}
      initialTicker={ticker}
      initialQuote={quote}
    />
  );
}
