import {
  Connection,
  PublicKey,
} from "../packages/protocol/node_modules/@solana/web3.js";
import type { LiteSVM } from "../packages/protocol/node_modules/litesvm";
/** Read-only public source. Execution stays inside the caller's in-memory VM. */
export async function hydrateMemoryRoute(svm: LiteSVM, route: any) {
  const source = new Connection(
    "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const instructions = [
    ...route.setupInstructions,
    route.swapInstruction,
    ...(route.cleanupInstruction ? [route.cleanupInstruction] : []),
  ];
  const keys = [
    ...new Set<string>([
      ...instructions.flatMap((ix) => [
        ix.programId,
        ...ix.accounts.map((a) => a.pubkey),
      ]),
      ...Object.keys(route.addressesByLookupTableAddress ?? {}),
    ]),
  ];
  if (keys.length > 100) throw new Error("Route fixture account cap exceeded");
  const { context, value: accounts } =
    await source.getMultipleAccountsInfoAndContext(
      keys.map((key) => new PublicKey(key)),
    );
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i],
      account = accounts[i];
    if (
      !account ||
      key.startsWith("Sysvar") ||
      key === "11111111111111111111111111111111"
    )
      continue;
    if (account.executable) {
      if (
        account.owner.toBase58() !==
        "BPFLoaderUpgradeab1e11111111111111111111111"
      )
        continue;
      const program = await source.getAccountInfo(
        new PublicKey(account.data.subarray(4, 36)),
      );
      if (!program || program.data.length > 20_000_045)
        throw new Error("Program fixture size cap exceeded");
      svm.addProgram(key as any, program.data.subarray(45));
    } else {
      svm.setAccount({
        address: key as any,
        programAddress: account.owner.toBase58() as any,
        lamports: BigInt(account.lamports) as any,
        data: account.data,
        executable: false,
        space: BigInt(account.data.length),
      });
    }
  }
  const clock = svm.getClock();
  clock.slot = BigInt(context.slot);
  clock.unixTimestamp = BigInt((await source.getBlockTime(context.slot))!);
  svm.setClock(clock);
}
