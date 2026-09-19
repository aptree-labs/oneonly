import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
const require = createRequire(resolve("packages/db/package.json"));
const postgres = require("postgres"),
  { drizzle } = require("drizzle-orm/postgres-js"),
  { migrate } = require("drizzle-orm/postgres-js/migrator");
async function main() {
  const source = process.env.DATABASE_URL_UNPOOLED;
  if (!source) throw new Error("An unpooled database URL is required.");
  const url = new URL(source),
    databaseName = `oneonly_check_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(source, { max: 1, prepare: false });
  let test: ReturnType<typeof postgres> | undefined,
    created = false;
  const directory = await mkdtemp(resolve(tmpdir(), "oneonly-migrations-"));
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;
    url.pathname = `/${databaseName}`;
    test = postgres(source, {
      database: databaseName,
      max: 1,
      prepare: false,
      connect_timeout: 15,
    });
    const folder = resolve("packages/db/drizzle");
    await cp(folder, directory, { recursive: true });
    const journalFile = resolve(directory, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalFile, "utf8"));
    journal.entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx <= 3,
    );
    await writeFile(journalFile, JSON.stringify(journal));
    await migrate(drizzle(test), { migrationsFolder: directory });
    const id = randomUUID();
    await test`insert into launch_tokens(id, network, ticker, name, description, image_id, creator, quote, mint, pool, config) values (${id}, 'devnet', 'KEEP', 'Migration fixture', 'Retain this row', ${randomUUID()}, 'fixture', 'SOL', 'mint', 'pool', 'config')`;
    await test`insert into token_trades(token_id, signature, event_index, wallet, side, base_amount, quote_amount, price_quote, block_time) values (${id}, 'same-signature', 0, 'fixture', 'buy', '1', '1', '1', now())`;
    await migrate(drizzle(test), { migrationsFolder: folder });
    await test`insert into token_trades(token_id, signature, venue, event_index, wallet, side, base_amount, quote_amount, price_quote, block_time) values (${id}, 'same-signature', 'damm-v2', 0, 'fixture', 'buy', '1', '1', '1', now())`;
    const rows =
      await test`select venue from token_trades where token_id = ${id} order by venue`;
    if (
      rows.length !== 2 ||
      !rows.some((row: { venue: string }) => row.venue === "dbc")
    )
      throw new Error("Migration did not preserve venue history");
    await migrate(drizzle(test), { migrationsFolder: folder });
    console.log(
      "PASS: old-to-new migrations preserve token/trade data, separate venue uniqueness, and safely rerun on PostgreSQL.",
    );
  } finally {
    if (test) await test.end();
    if (created) await admin.unsafe(`DROP DATABASE "${databaseName}"`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(
    "Isolated PostgreSQL migration check failed; production schema was not changed.",
    {
      code: error?.cause?.code ?? error?.code ?? "setup",
      message: String(error?.cause?.message ?? error?.message ?? "").replace(
        /postgres(?:ql)?:\/\/\S+/g,
        "[connection hidden]",
      ),
    },
  );
  process.exitCode = 1;
});
