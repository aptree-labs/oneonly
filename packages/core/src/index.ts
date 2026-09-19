import { Data, Effect, Schema } from "effect";

const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** A public key is base58 encoded, decodes to exactly 32 bytes, and is case sensitive. */
export function isSolanaAddress(value: string): boolean {
  if (value.length < 32 || value.length > 44) return false;
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return false;
    number = number * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (number > 0n) {
    bytes++;
    number >>= 8n;
  }
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
}
export class InvalidSignup extends Data.TaggedError("InvalidSignup")<{
  message: string;
}> {}
const WalletRequest = Schema.Struct({ wallet: Schema.String });
export const validateWallet = (input: unknown) =>
  Schema.decodeUnknown(WalletRequest)(input).pipe(
    Effect.mapError(
      () => new InvalidSignup({ message: "Enter your Solana wallet address." }),
    ),
    Effect.flatMap(({ wallet }) => {
      const address = wallet.trim();
      return isSolanaAddress(address)
        ? Effect.succeed(address)
        : Effect.fail(
            new InvalidSignup({
              message:
                "That doesn’t look like a Solana address. Check it and try again.",
            }),
          );
    }),
  );
export * from "./launchpad";
export * from "./network";

export * from "./scaled-amounts";
export * from "./display";
export * from "./trade-amount";

export * from "./platform-token";
