/* Wallet Standard only; no extension private-key access or browser-side sending. */
const $ = (id) => document.getElementById(id);
const capability = location.hash.slice(1);
history.replaceState(null, "", "/");
const wallets = new Set();
const registry = {
  register(...items) {
    items.forEach((wallet) => wallets.add(wallet));
    return () => items.forEach((wallet) => wallets.delete(wallet));
  },
};
window.addEventListener("wallet-standard:register-wallet", (event) =>
  event.detail(registry),
);
window.dispatchEvent(
  new CustomEvent("wallet-standard:app-ready", { detail: registry }),
);
let state,
  wallet,
  account,
  prepared,
  busy = false,
  batchSupported = false;
const encode = (bytes) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
const decode = (value) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
function message(text, error = false) {
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function rows(id, entries) {
  const fragment = document.createDocumentFragment();
  for (const [key, value] of entries) {
    const dt = document.createElement("dt"),
      dd = document.createElement("dd");
    dt.textContent = key;
    dd.textContent = String(value);
    fragment.append(dt, dd);
  }
  $(id).replaceChildren(fragment);
}
async function api(path, body = {}) {
  const response = await fetch(`/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Deployment-Capability": capability,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Local deployment request failed");
  return result;
}
function controls() {
  const available =
    !!account && $("reviewed").checked && !busy && !state?.pending;
  $("next").disabled = !available || !!state?.complete;
  $("recover").disabled = !available || !$("recovery-check").checked;
  $("rebroadcast").disabled = busy || !state?.pending;
  $("sign").disabled = busy || !prepared || !available;
  $("connect").disabled = busy;
  $("cancel").disabled = busy;
  $("refresh").disabled = busy;
  $("batch").disabled = busy || !batchSupported;
}
async function refresh() {
  state = await api("status");
  const m = state.manifest;
  rows("plan", [
    ["Network", m.network],
    ["Artifact SHA256", m.artifactSha256],
    ["Plan SHA256", state.planHash],
    ["Wallet / authority", m.wallet],
    ["Program", m.program],
    ["Upload buffer", m.buffer],
    ["Total approval budget", `${m.maxTotalLamports} lamports`],
    ["Fee ceiling per step", `${m.maxFeePerTransactionLamports} lamports`],
  ]);
  rows("costs", [
    ["Conservative reservations", `${state.reservedLamports} lamports`],
    ["Verified transaction fees", `${state.actualFeesLamports} lamports`],
    [
      "Net account funding",
      `${state.netAccountFundingLamports} lamports (negative means refund)`,
    ],
    ["Buffer refundable now", `${state.refundableLamports} lamports`],
    [
      "Receipt accounting",
      state.accountingComplete ? "Complete" : "Pending verification",
    ],
  ]);
  $("progress").textContent = state.complete
    ? "Deployment verified: exact build and wallet authority match."
    : state.pending
      ? `Waiting for finality: ${state.pending.count ?? 1} transaction(s).`
      : `${state.missingChunks} upload chunks remaining. Next: ${state.next?.kind || "none"}.`;
  controls();
}
async function run(action) {
  if (busy) return;
  busy = true;
  controls();
  try {
    await action();
  } catch (error) {
    message(error.message || "Operation failed", true);
  } finally {
    busy = false;
    controls();
  }
}
$("connect").onclick = () =>
  run(async () => {
    wallet = [...wallets].find(
      (w) =>
        /jupiter/i.test(w.name) &&
        w.features["standard:connect"] &&
        w.features["solana:signTransaction"],
    );
    if (!wallet)
      throw new Error(
        "Jupiter Wallet Standard was not found. Enable the Jupiter browser extension and reopen this local page.",
      );
    const result = await wallet.features["standard:connect"].connect();
    account = result.accounts.find(
      (a) =>
        a.address === state.manifest.wallet &&
        a.chains.includes("solana:devnet"),
    );
    if (!account)
      throw new Error(
        "Select the nominated deployment wallet with devnet support in Jupiter.",
      );
    const feature = wallet.features["solana:signTransaction"];
    batchSupported =
      feature.version === "1.0.0" &&
      feature.supportedTransactionVersions?.includes("legacy") &&
      account.features?.includes("solana:signTransaction");
    $("batch").checked = batchSupported;
    $("batch-status").textContent = batchSupported
      ? "Up to 16 independent upload writes per approval. Your wallet may show each transaction."
      : "Batch signing is not advertised by this wallet. Single-step approvals remain available.";
    message("Jupiter connected. Review the plan before continuing.");
  });
async function prepare(recover) {
  prepared = await api(recover ? "recover" : "prepare", {
    batchSize: batchSupported && $("batch").checked ? 16 : 1,
  });
  if (prepared.complete) {
    prepared = null;
    await refresh();
    message("No further action is needed.");
    return;
  }
  rows("step", [
    ["Action", prepared.kind],
    ["Transactions", prepared.count ?? 1],
    [
      "Exact message SHA256",
      (prepared.transactions ?? [prepared])
        .map(
          (item) =>
            `${item.offset === undefined ? item.kind : `Offset ${item.offset}`}: ${item.messageSha256}`,
        )
        .join("\n"),
    ],
    ["Network fee", `${prepared.feeLamports} lamports`],
    ["Maximum account funding", `${prepared.maximumFundingLamports} lamports`],
    ["New reserved budget", `${prepared.reservedLamports} lamports`],
  ]);
  $("approval").hidden = false;
  message("Review this step, then approve it in Jupiter.");
}
$("next").onclick = () => run(() => prepare(false));
$("recover").onclick = () => run(() => prepare(true));
$("cancel").onclick = () => {
  if (busy) return;
  prepared = null;
  $("approval").hidden = true;
  controls();
  message("Preparation cancelled. Nothing was signed.");
};
$("sign").onclick = () =>
  run(async () => {
    if (!prepared || !account)
      throw new Error("Prepare a step and connect the nominated wallet first");
    const approvedStep = prepared;
    const items = approvedStep.transactions ?? [approvedStep];
    if (items.length > 1 && !batchSupported)
      throw new Error(
        "Batch signing is unavailable. Cancel and choose single-step mode.",
      );
    let result;
    try {
      result = await wallet.features["solana:signTransaction"].signTransaction(
        ...items.map((item) => ({
          account,
          chain: "solana:devnet",
          transaction: decode(item.transaction),
        })),
      );
    } catch (error) {
      throw new Error(
        items.length > 1
          ? "Batch approval was not completed. Nothing was submitted. Retry the batch, or cancel and uncheck batch signing for single-step approvals."
          : error.message || "Wallet approval was not completed",
      );
    }
    if (
      !Array.isArray(result) ||
      result.length !== items.length ||
      result.some((item) => !item?.signedTransaction)
    )
      throw new Error(
        "Wallet returned an incomplete batch. Nothing was submitted. Cancel and choose single-step mode if needed.",
      );
    const submitted = await api("submit", {
      id: approvedStep.id,
      transactions: result.map((item) => encode(item.signedTransaction)),
    });
    prepared = null;
    $("approval").hidden = true;
    message(
      submitted.message ||
        "Signed transaction saved and submitted. Check status for finality.",
    );
    await refresh();
  });
$("refresh").onclick = () =>
  run(async () => {
    await refresh();
    message(
      state.pending
        ? "Still awaiting finalized confirmation."
        : "Finalized state checked.",
    );
  });
$("rebroadcast").onclick = () =>
  run(async () => {
    const result = await api("rebroadcast");
    message(result.message || "Pending transaction checked.");
    await refresh();
  });
$("reviewed").onchange = controls;
$("batch").onchange = () => {
  if (busy) return;
  prepared = null;
  $("approval").hidden = true;
  controls();
};
$("recovery-check").onchange = controls;
run(async () => {
  if (!capability)
    throw new Error(
      "Open the private console link saved by the local launcher.",
    );
  await refresh();
  message(
    "Local plan loaded. Connect the nominated Jupiter wallet when ready.",
  );
});
