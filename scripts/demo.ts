import { localPostgres } from "./local-postgres.js";
import { Pool, migrate, seed } from "../src/db.js";
import { createApp } from "../src/service.js";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
await mkdir(".local", { recursive: true });
// An explicitly supplied disposable demo database avoids Windows sandbox initdb
// failures and keeps manual verification separate from TEST_DATABASE_URL.
const db = process.env.DEMO_DATABASE_URL
  ? undefined
  : await localPostgres(".local/demo-db", 54329);
const pool = new Pool({
  connectionString: process.env.DEMO_DATABASE_URL ?? db!.url,
});
try {
  await migrate(pool);
  const serverId = (await pool.query("SELECT server_id FROM server_meta"))
    .rows[0].server_id as string;
  const fixturePath = `.local/fixtures-${serverId}.json`;
  if (
    !Number((await pool.query("SELECT count(*) FROM humans")).rows[0].count)
  ) {
    await writeFile(fixturePath, JSON.stringify(await seed(pool), null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  } else {
    try {
      await access(fixturePath);
    } catch {
      throw new Error(
        "Demo database already has identities but no matching local fixture file; use a dedicated empty demo database",
      );
    }
  }
  let secret: string;
  try {
    secret = await readFile(".local/cursor-secret", "utf8");
  } catch {
    secret = randomBytes(32).toString("hex");
    await writeFile(".local/cursor-secret", secret, { mode: 0o600 });
  }
  const server = await createApp(pool, secret);
  server.listen(4317, "127.0.0.1", () =>
    console.log(
      `Gate 1 TEST demo: http://127.0.0.1:4317\nFixture tokens: ${fixturePath} (local only). Press Ctrl+C to stop.`,
    ),
  );
  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (stopping) return;
      stopping = true;
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await pool.end();
      if (db) await db.stop();
      process.exit(0);
    });
  server.on("error", async () => {
    console.error("Demo port unavailable; stopping demo.");
    await pool.end();
    if (db) await db.stop();
    process.exitCode = 1;
  });
} catch (e) {
  await pool.end();
  if (db) await db.stop();
  throw e;
}
