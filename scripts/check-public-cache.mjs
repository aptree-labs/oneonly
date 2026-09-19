/** Bounded, read-only smoke test. No wallet, signing, mutations, or production load test. */
const origin = process.argv[2];
if (!origin || !/^https?:\/\//.test(origin)) throw new Error("Usage: node scripts/check-public-cache.mjs https://app.example.com");
const urls = ["tokens?sort=volume&pair=All&age=All&search=&page=0", "config", "session", "ticker?value=CACHETEST"];
const report = [];
for (const path of urls) {
  for (let pass = 0; pass < 3; pass++) {
    const start = performance.now();
    const response = await fetch(new URL(`/api/launchpad/${path}`, origin));
    const data = await response.json();
    report.push({ path, pass, status: response.status, ms: Math.round(performance.now() - start), cache: response.headers.get("x-vercel-cache"), age: response.headers.get("age"), control: response.headers.get("cache-control"), error: data.error });
    if (!response.ok) throw new Error(JSON.stringify(report));
    if ((path.startsWith("session") || path.startsWith("ticker")) && response.headers.get("x-vercel-cache") === "HIT") throw new Error("Private/authoritative data unexpectedly cached");
  }
}
console.log(JSON.stringify(report, null, 2));
