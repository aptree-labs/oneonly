# Fee escrow dependency review

Reviewed 2026-09-27. **Internal engineering review, not an independent security audit or mainnet approval.** The follow-up release branch includes the scoped Jayson UUID update described below; no deployment or environment was changed.

## Scope and result

The supplied `pnpm audit --prod --json` snapshot (`/private/tmp/oneonly-escrow-dependency-audit.json`) reports **0 critical, 5 high, and 2 moderate advisories**, across five package names. “Production dependency” in this report means dependency graph classification; it does not establish whether the vulnerable function executes in a production request.

Reviewed the workspace lockfile, installed dependency source, selected Next server build files, and a local Node module-load trace. Loading `@solana/web3.js`, then Anchor, then SPL Token showed Jayson’s browser client, TOML, and bigint-buffer respectively; it did not load stream-json, image-size, or Metro. No RPC calls were made by that trace. This is evidence about those entrypoints, not proof about every dynamic import or deployed function. Existing `.next` files are supplementary evidence and are not an attestation of the final deployment.

The most practical first changes are scoped UUID and TOML upgrades. The native bigint dependency needs an explicit deployment invariant or replacement. Stream-json and image-size require compatibility work; blind major-version overrides can break their parent packages.

## npm findings and reachability

### bigint-buffer 1.1.5 — high, no official patched version

**Path:** `@oneonly/fee-escrow → @solana/spl-token → @solana/buffer-layout-utils → bigint-buffer` (also available through other SPL Token users).

[GHSA-3gc7-fjrx-p6mg / CVE-2025-3194](https://github.com/advisories/GHSA-3gc7-fjrx-p6mg) describes a native `toBigIntLE` buffer overflow, affecting versions through 1.1.5, with no patched release listed.

Local evidence:

- `@solana/buffer-layout-utils/lib/cjs/bigint.js` calls these conversion functions. Its exported u64/u128/u192/u256 layouts use fixed 8/16/24/32-byte buffers, reducing arbitrary-length input exposure in those paths. The generic layout helper still exists, so this is not a complete reachability exclusion.
- `bigint-buffer/dist/node.js` attempts to load the native addon and falls back to JavaScript if unavailable. The installed package has no `.node` binary, and local execution reports the pure JavaScript fallback. Its browser entry is also JavaScript.
- `pnpm-workspace.yaml` permits build scripts only for `sharp` and `esbuild`, which prevents this package’s ordinary native build in the reviewed installation flow.

**Mitigation:** retain the install-script restriction and add a release artifact check that fails if the bigint native addon is present or loaded. Prefer an upstream SDK migration removing this dependency, or a reviewed, API-compatible pure JavaScript patch with integer-layout regressions. Do not replace a financial dependency with an unreviewed third-party fork merely to silence audit output.

**Residual:** absence locally is not proof of absence in Vercel artifacts, restored caches, or manually built environments. The vulnerable package remains in the lockfile even when its vulnerable native implementation is disabled. Treat the artifact check as required before relying on this mitigation.

### uuid 8.3.2 — moderate

**Path:** `apps/web → @solana/web3.js → jayson → uuid`.

[GHSA-w5hq-g745-h8pq / CVE-2026-41907](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq) concerns bounds checks in UUID v3/v5/v6 optional output-buffer handling. Patched branches include 11.1.1, 12.0.1, and 13.0.1; do not infer that 12.0.0 or 13.0.0 is safe from a broad numeric comparison.

`@solana/web3.js/lib/index.cjs.js` imports `jayson/lib/client/browser`. That client and `jayson/lib/generateRequest.js` use `require('uuid').v4()` without an output buffer, outside the affected methods. Existing `rpc-websockets>uuid: 11.1.1` does not cover Jayson.

**Recommended candidate:** add scoped `jayson>uuid: 11.1.1`. That release preserves CommonJS support; newer ESM-only majors are not a drop-in replacement for `require`. Run RPC request construction, transaction tests, and the production build after the change. [UUID 11.1.1 release](https://github.com/uuidjs/uuid/releases/tag/v11.1.1).

**Applied follow-up:** the release branch pins `jayson>uuid: 11.1.1` and updates the lockfile. An isolated installation passed CommonJS and browser-client JSON-RPC request/response checks with generated UUIDs. The shared development installation was not changed; the final frozen-lockfile installation and deployment artifact still need verification.

### stream-json 1.9.1 — moderate

**Path:** `apps/web → @solana/web3.js → jayson → stream-json`.

[GHSA-528h-pc64-c93x / CVE-2026-71429](https://github.com/uhop/stream-json/security/advisories/GHSA-528h-pc64-c93x) concerns quadratic work in deeply nested input processed by Pick/Ignore/Filter/Replace path filters. The advisory lists 3.5.0 as patched and excludes the ordinary streamers from that particular defect.

The app’s Solana entrypoint uses Jayson’s browser client, which parses responses with `JSON.parse` and does not load this dependency. Even Jayson’s generic `lib/utils.js` imports `streamers/StreamValues` and `utils/Verifier`, not the affected filter family. No direct application import of the affected filters was found.

**Mitigation:** upgrade Jayson or patch its dependency compatibly when upstream support is available. Do not blindly override to stream-json 3.5+: current 3.x is ESM with changed exported paths, while Jayson 4.3.0 expects old CommonJS paths. Verify both import resolution and actual JSON-RPC streaming if changing it. [Maintainer package manifest](https://github.com/uhop/stream-json/blob/master/package.json).

**Residual:** lockfile finding remains, but no affected-function path was found in the reviewed app/SDK entrypoints. This does not establish general JSON parsing resource limits.

### toml 3.0.0 — two high advisories

**Path:** `@oneonly/protocol → @coral-xyz/anchor → toml`.

[GHSA-82x6-q7mm-w9cf / CVE-2026-77465](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-82x6-q7mm-w9cf) covers parser recursion denial of service, fixed in 4.2.0. [GHSA-v5mp-jgw5-2x6j / CVE-2026-63376](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-v5mp-jgw5-2x6j) covers prototype pollution, fixed in 4.1.2. Version 4.2.0 covers both.

Anchor’s CommonJS index loads its workspace module, which imports TOML. The parser is invoked when `anchor.workspace` resolves a program from a local `Anchor.toml`. The reviewed application constructs programs from explicit IDLs; no application use of `anchor.workspace` or untrusted TOML parsing was found. TOML is nevertheless present in the local server bundle and module-load trace.

**Recommended candidate:** scoped `@coral-xyz/anchor>toml: 4.2.0`. The [4.2.0 entrypoint](https://github.com/BinaryMuse/toml-node/blob/v4.2.0/index.js) retains CommonJS `parse`, but requires Node >=20 and changes parser behavior. Verify the deployment Node version, parse the repository’s Anchor configuration, exercise SDK construction, and build before accepting the override. Do not expose uploaded/user-provided TOML to the existing parser.

**Residual:** no remote request path to vulnerable parsing was identified, but the module is shipped and future workspace/config use could change that assessment.

### image-size 1.2.1 — two high advisories

**Path:** `apps/web → @solana/wallet-adapter-react → @solana-mobile/wallet-adapter-mobile → react-native → @react-native/community-cli-plugin → metro → image-size`.

[GHSA-5p2g-fcmc-qvqq / CVE-2025-71329](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) and [GHSA-w3rx-r6r6-pgpr / CVE-2025-71330](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) describe image-parser infinite loops in JXL/HEIF and ICNS respectively. The audit identifies 2.0.3 as the fixed version. Verify registry provenance and availability before pinning: the maintainer’s GitHub release page inspected during this review still showed 2.0.2 as latest.

Metro’s `src/Assets.js` imports image-size. OneOnly is built with Next, not a Metro server. The reviewed upload handler (`apps/web/src/app/api/launchpad/[...path]/route.ts`) uses Sharp with `limitInputPixels: 16_000_000`, not this parser; no direct app use of image-size was found. The Node SDK load trace did not load Metro or image-size.

**Mitigation:** prefer a wallet-adapter/React Native/Metro dependency update which accepts the patched parser, or an explicitly tested compatible patch. Do not blindly override 1.x to 2.x: the [major release changes image APIs](https://github.com/image-size/image-size/releases). Test Metro’s exact callable import and buffer/file-path use if retaining that toolchain. Avoid processing untrusted assets through the affected Metro parser.

**Residual:** principally a transitive tooling path in the reviewed web app, but still a production-graph audit finding. Absence of an identified Next request path is not a claim that every installed tool is safe.

## Rust dependency review

The initial manual comparison was followed by an actual **cargo-audit 0.22.2** run, installed into a temporary tool directory. It reported **zero vulnerability findings, two unmaintained warnings, one unsoundness warning, and no yanked warning**. The tool’s default exit code was zero because warnings are not denied by default; this is not a warning-free audit. A read-only checkout of the official [RustSec advisory database](https://github.com/RustSec/advisory-db) at commit `e2111519ba6d14a5da59a7b2e5c8083ae8a37c01` was compared with `packages/fee-escrow/Cargo.lock`. Forty non-withdrawn package-name matches were checked against patched/unaffected ranges; three installed-version matches remain:

| Dependency           | Finding                                                                                               | Local reachability / disposition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rand 0.7.3`         | [RUSTSEC-2026-0097](https://rustsec.org/advisories/RUSTSEC-2026-0097.html), informational unsoundness | Path: Solana program dependencies → `solana-secp256k1-recover 2.2.1` → `libsecp256k1 0.6.0` → rand. The vulnerable condition requires logging plus a custom logger reentering thread RNG during reseeding. Reviewed features do not enable rand’s `log`; no such logger was found. More importantly, this libsecp dependency is under `cfg(not(target_os = "solana"))`, so this path is host-only, not the SBF program. The separately installed rand 0.8.8 is patched. Track upstream Solana dependency updates; do not force a semver-incompatible rand replacement. |
| `libsecp256k1 0.6.0` | [RUSTSEC-2025-0161](https://rustsec.org/advisories/RUSTSEC-2025-0161.html), unmaintained              | Same host-only Solana compatibility dependency. An unmaintained notice is not evidence of a new exploitable defect. Prefer an upstream Solana upgrade; do not replace cryptographic internals ad hoc.                                                                                                                                                                                                                                                                                                                                                                  |
| `bincode 1.3.3`      | [RUSTSEC-2025-0141](https://rustsec.org/advisories/RUSTSEC-2025-0141.html), unmaintained              | Used by Anchor/Solana compatibility code, including loader/account decoding. No patched version listed. Changing serializers can break chain wire compatibility; retain bounded, owner-checked account handling and track upstream replacement.                                                                                                                                                                                                                                                                                                                        |

Other package-name matches were patched or explicitly unaffected at the installed versions, including Anchor 0.31.2 and curve25519-dalek 4.1.3. The subsequent cargo-audit run included the normal yanked-crate check. Neither check establishes safety across all target/feature combinations, source provenance, malicious packages, or unknown vulnerabilities. Retain dated and narrowly justified warning dispositions rather than suppressing entire classes of findings.

## SBF build warnings

The build reports unresolved names such as `sol_curve_validate_point`, memory/logging helpers, PDA helpers, CPI, and sysvar syscalls. A post-processing warning alone is not proof these fail on the deployed runtime: the compiled program executed successfully in LiteSVM, including the curve-validation syscall, real Ed25519 verification, SPL-token transfers, and control/rotation tests. The focused SBF runtime suite passed 27 cases; native Rust tests passed 11 cases during this work.

An actual earlier failure from calling `Pubkey::is_on_curve` in SBF was fixed to use the runtime curve-validation syscall, and its negative/positive cases were rerun. That concrete runtime test is stronger evidence than dismissing the warning generically. It still does not prove every symbol/path on every validator version. `abort` remains relevant to panic paths. Macro deprecation and disabled-LTO warnings are separate maintenance/build warnings, not demonstrated payout failures.

Before release, rebuild from the reviewed lockfiles, record the exact artifact hash, rerun the SBF/real-Meteora integration suites, and complete the authorized devnet lifecycle using that exact artifact. Do not substitute a locally passing artifact for proof about a different deployed build.

## Required follow-through

1. Keep the now-tested scoped UUID 11.1.1 and TOML 4.2.0 overrides; repeat audit and build checks on future dependency changes.
2. Prove the deployed bigint implementation cannot load the vulnerable native addon, or replace it with a reviewed compatible implementation.
3. Record stream-json/image-size reachability exceptions with versions and review dates until compatible upgrades are verified. Recheck if new import paths or image-processing services are introduced.
4. Add repeatable npm and Rust dependency checks in CI. Keep audit exceptions specific and visible.
5. Complete artifact-matched devnet and independent contract review before treating this dependency triage as part of a mainnet decision. It is not a substitute for either.

## Follow-through evidence

- Scoped `jayson>uuid: 11.1.1` was applied by the release owner and separately checked with CommonJS/browser-RPC construction.
- TOML 4.2.0 was fetched from the official npm registry into an isolated temporary directory with install scripts disabled. On Node 22.18.0, its CommonJS parser produced an identical result to 3.0.0 for the repository’s `Anchor.toml`. Injecting it at Anchor’s real CommonJS import point also passed explicit `AnchorProvider`/`Program` construction without any RPC request. This establishes the targeted compatibility check; a subsequent clean frozen-lockfile installation including both scoped overrides passed all five workspace type checks, the full Next production build, and 466 automated tests.
- `scripts/check-native-bigint.mjs` scans installed workspace dependencies (following symlinks), Next standalone files, Next file traces, and either root or web-local Vercel output. It rejects native `.node` files under bigint-buffer, including arbitrary filenames and declared trace entries not copied yet. It does not execute packages or read environment files. It is an addon-presence guard, not a general malicious-code scanner.
- `apps/web/package.json` runs the guard before and after `next build`; the post-build check requires a build ID and Next traces. Both repository Vercel configs use `pnpm build`. An external project build-command override would need to preserve this hook. Vercel packaging happens after the Next build: the post-build hook checks Next traces/standalone output, while `node scripts/check-native-bigint.mjs --require-build` should also run after `vercel build` when reviewing final `.vercel/output` locally.
- `pnpm check:dependencies` runs the Node regression suite and guard. All **10 guard tests passed**, covering symlinked dependencies, standalone output, Vercel function output, traced native files, malformed/missing traces, and permitted unrelated Sharp binaries. The current local dependency tree and **59 existing Next traces passed**. The release owner then repeated the guard on a fresh isolated production build: all 32 new Next traces passed. This does not substitute for checking the final Vercel-packaged output. No CI workflow existed to amend; build-script enforcement was used instead.

Reproducible Rust audit (temporary tool installation is not a project dependency):

```sh
cargo install cargo-audit --locked --version 0.22.2 --root /private/tmp/oneonly-cargo-audit
/private/tmp/oneonly-cargo-audit/bin/cargo-audit audit \
  --file packages/fee-escrow/Cargo.lock \
  --db /private/tmp/oneonly-rustsec-review-20260927 --no-fetch --format json
```

The database checkout is pinned to the commit listed above; the report was retained at `/private/tmp/oneonly-cargo-audit-final.json`. For future release checks, fetch a current official database and use `--deny warnings` if the release policy is to require explicit disposition of all three remaining notices. The strict rerun with `--deny warnings` exited 1 as expected, proving these notices remain visible to a release gate. No blanket ignore list was added.

## Patched lockfile audit

The fresh frozen-lockfile installation was audited with `pnpm audit --prod --json` after both overrides. It reports **0 critical, 3 high, 1 moderate** findings: native bigint-buffer, two image-size parser findings, and stream-json. UUID and both TOML advisories are removed. The remaining exposure/mitigation analysis above remains applicable; these findings are not represented as patched or absent. The fresh Next build guard rejects the native bigint addon, and the reviewed web request paths do not use the affected Metro image parser or stream-json filters.
