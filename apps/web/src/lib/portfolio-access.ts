// Automatic loads only reuse an existing session. Signing needs a user click.
export async function loadPortfolioForWallet<T extends { wallet: string }>(
  wallet: string,
  session: () => Promise<{ wallet: string | null }>,
  portfolio: () => Promise<T>,
  authenticate?: () => Promise<string>,
): Promise<T | null> {
  const current = await session();
  if (current.wallet !== wallet) {
    if (!authenticate || (await authenticate()) !== wallet) return null;
  }
  const result = await portfolio();
  // A different tab can change the session between these requests.
  return result.wallet === wallet ? result : null;
}
