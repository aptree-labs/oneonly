# Web Analytics

One Only uses Vercel Web Analytics for basic traffic reporting: visitors, page views, countries, referrers, pages, devices, and browsers.

Dashboard: https://vercel.com/kade/oneonly-app/analytics

The root layout mounts `Analytics` from `@vercel/analytics/next`, which tracks page loads and client-side navigation. No custom trading events are sent. Data collection starts when the integration is enabled and deployed; it does not backfill earlier visits.

The production integration is for `app.oneonly.lol` (Vercel project `oneonly-app`). The separately deployed marketing project needs its own release to receive this code.

When verifying enablement, an Analytics ID alone is insufficient: the feature must be enabled in Vercel, followed by a deployment. SDK v2 can use a generated script path supplied in the compiled client configuration instead of `/_vercel/insights/script.js`.
