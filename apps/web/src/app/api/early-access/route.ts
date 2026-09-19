import { Effect } from "effect";
import { validateWallet } from "@oneonly/core";
import { saveSignup } from "@oneonly/db";
import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const expectedOrigin = process.env.APP_URL
    ? new URL(process.env.APP_URL).origin
    : request.nextUrl.origin;
  if (request.headers.get("origin") !== expectedOrigin)
    return NextResponse.json(
      { error: "Please sign up from the One Only site." },
      { status: 403 },
    );
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader)
    return NextResponse.json(
      { error: "Enter your wallet address." },
      { status: 400 },
    );
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2048) {
      await reader.cancel();
      return NextResponse.json(
        { error: "Request too large." },
        { status: 413 },
      );
    }
    chunks.push(value);
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return NextResponse.json(
      { error: "Check your wallet address and try again." },
      { status: 400 },
    );
  }
  return Effect.runPromise(
    validateWallet(input).pipe(
      Effect.flatMap((wallet) =>
        Effect.tryPromise({
          try: () => saveSignup({ wallet }),
          catch: () => ({ _tag: "StorageError" as const }),
        }),
      ),
      Effect.match({
        onSuccess: () => NextResponse.json({ success: true }),
        onFailure: (error) =>
          NextResponse.json(
            {
              error:
                error._tag === "InvalidSignup"
                  ? error.message
                  : "The list is temporarily unavailable. Please try again.",
            },
            { status: error._tag === "InvalidSignup" ? 400 : 503 },
          ),
      }),
    ),
  );
}
