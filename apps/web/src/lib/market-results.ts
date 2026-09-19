import type { Token } from "@/components/launchpad/explore";
export type MarketResults = {
  tokens: Token[];
  total: number;
  asOf?: string;
  usdReferenceTime?: number | null;
};
/** Preserve source age across server, CDN and browser caches. */
export function marketFreshUntil(
  value: MarketResults,
  receivedAt = Date.now(),
) {
  return Math.min(
    snapshotTime(value, receivedAt) + 5_000,
    referenceDeadline(value),
  );
}
export function marketUsableUntil(
  value: MarketResults,
  receivedAt = Date.now(),
) {
  return Math.min(
    snapshotTime(value, receivedAt) + 15_000,
    referenceDeadline(value),
  );
}
function snapshotTime(value: MarketResults, fallback: number) {
  const time = value.asOf === undefined ? fallback : Date.parse(value.asOf);
  return Number.isFinite(time) && time <= fallback ? time : 0;
}
function referenceDeadline(value: MarketResults) {
  const time = value.usdReferenceTime;
  return time == null
    ? Infinity
    : Number.isFinite(time) && time <= Date.now()
      ? time + 30_000
      : 0;
}
type Entry = { value: MarketResults; expires: number; usableUntil: number };
const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<MarketResults>>();
let generation = 0;
export function marketKey(params: URLSearchParams) {
  return new URLSearchParams({
    search: params.get("search")?.trim() ?? "",
    sort: params.get("sort") ?? "volume",
    pair: params.get("pair") ?? "All",
    age: params.get("age") ?? "All",
    page: params.get("page") ?? "0",
  }).toString();
}
export function peekMarket(key: string) {
  const entry = entries.get(key);
  // Brief stale-while-refresh is useful; a hours-old dialog result is not.
  return entry && entry.usableUntil > Date.now() ? entry.value : undefined;
}
export function seedMarket(key: string, value: MarketResults) {
  entries.delete(key);
  entries.set(key, {
    value,
    expires: marketFreshUntil(value),
    usableUntil: marketUsableUntil(value),
  });
  while (entries.size > 50) entries.delete(entries.keys().next().value!);
}
export function clearMarket() {
  generation++;
  entries.clear();
  pending.clear();
}
export async function loadMarket(
  key: string,
  force = false,
): Promise<MarketResults> {
  const cached = entries.get(key);
  if (!force && cached && cached.expires > Date.now()) return cached.value;
  const existing = pending.get(key);
  if (existing) return existing;
  const started = generation;
  const work = fetch(`/api/launchpad/tokens?${key}`, {
    cache: "default",
    signal: AbortSignal.timeout(15_000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error("Search couldn’t load. Try again.");
      const data = (await response.json()) as MarketResults;
      if (generation === started) seedMarket(key, data);
      return data;
    })
    .finally(() => {
      if (pending.get(key) === work) pending.delete(key);
    });
  pending.set(key, work);
  return work;
}
