// Share concurrent identical reads across SDK clients. Never combine broadcasts or simulations.
const pending = new Map<string, Promise<Response>>();
export const rpcFetch: typeof fetch = async (url, init) => {
  let request: { id: unknown; method: string; params?: unknown };
  try {
    request = JSON.parse(String(init?.body));
  } catch {
    return fetch(url, init);
  }
  if (!request.method?.startsWith("get")) return fetch(url, init);
  const key = JSON.stringify([String(url), request.method, request.params]);
  let promise = pending.get(key);
  if (!promise) {
    promise = (async () => {
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(url, {
          ...init,
          signal: AbortSignal.any([
            ...(init?.signal ? [init.signal] : []),
            AbortSignal.timeout(12_000),
          ]),
        });
        if (attempt === 0 && [429, 502, 503, 504].includes(response.status)) {
          await response.body?.cancel();
          await new Promise((resolve) => setTimeout(resolve, 300));
          continue;
        }
        return response;
      }
    })();
    pending.set(key, promise);
    // Use then's error branch so cleanup doesn't create an unhandled rejection.
    void promise.then(
      () => pending.delete(key),
      () => pending.delete(key),
    );
  }
  const response = (await promise).clone();
  if (!response.ok) return response;
  const payload = await response.json();
  return Response.json(
    { ...payload, id: request.id },
    { status: response.status },
  );
};
