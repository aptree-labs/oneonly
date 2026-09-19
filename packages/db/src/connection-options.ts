/** Neon serverless traffic uses transaction pooling; migrations keep their explicit direct URL. */
export function runtimeDatabaseUrl(value: string) {
  const url = new URL(value);
  if (
    url.hostname.endsWith(".neon.tech") &&
    !url.hostname.split(".")[0].endsWith("-pooler")
  ) {
    const [endpoint, ...domain] = url.hostname.split(".");
    url.hostname = [endpoint + "-pooler", ...domain].join(".");
  }
  return url.toString();
}
