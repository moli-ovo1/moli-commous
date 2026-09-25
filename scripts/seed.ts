import { Pool, seed } from "../src/db.js";
import { config } from "../src/config.js";
import { mkdir, writeFile, access } from "node:fs/promises";
const pool = new Pool({ connectionString: config().databaseUrl });
try {
  let exists = false;
  try {
    await access(".local/fixtures.json");
    exists = true;
  } catch {}
  if (exists)
    throw new Error(
      "Fixture file already exists; refusing to overwrite or reseed",
    );
  const fixtures = await seed(pool);
  await mkdir(".local", { recursive: true });
  await writeFile(".local/fixtures.json", JSON.stringify(fixtures, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
  console.log("Test credentials written to .local/fixtures.json (not printed)");
} finally {
  await pool.end();
}
