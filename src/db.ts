import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash, randomBytes } from "node:crypto";
export const { Pool } = pg;
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function migrate(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(710011)");
    const exists = await c.query(
      "SELECT to_regclass('public.schema_migrations') AS name",
    );
    if (!exists.rows[0].name) {
      await c.query(
        await readFile(
          new URL("../migrations/001_gate1.sql", import.meta.url),
          "utf8",
        ),
      );
      await c.query("INSERT INTO server_meta VALUES($1)", [randomUUID()]);
    } else {
      const versions = await c.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      if (JSON.stringify(versions.rows) !== '[{"version":1}]')
        throw new Error("Unsupported database version");
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function seed(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(710011)");
    if (Number((await c.query("SELECT count(*) FROM humans")).rows[0].count))
      throw new Error(
        "Seed requires an empty Gate 1 database; existing identities are not overwritten",
      );
    const identities = [];
    for (const label of ["Ako家", "小雨家"]) {
      const human = randomUUID(),
        household = randomUUID(),
        character = randomUUID(),
        identity = randomUUID(),
        principal = randomUUID();
      const token = randomBytes(32).toString("base64url");
      await c.query("INSERT INTO humans(human_id,status) VALUES($1,'active')", [
        human,
      ]);
      await c.query(
        "INSERT INTO households(household_id,owner_human_id,display_label) VALUES($1,$2,$3)",
        [household, human, label],
      );
      await c.query(
        "INSERT INTO characters(character_id,household_id) VALUES($1,$2)",
        [character, household],
      );
      await c.query(
        "INSERT INTO public_identities(public_identity_id,character_id,display_name) VALUES($1,$2,'蒋郁文')",
        [identity, character],
      );
      await c.query(
        "INSERT INTO test_principals(principal_id,public_identity_id,token_hash) VALUES($1,$2,$3)",
        [principal, identity, hash(token)],
      );
      identities.push({
        label,
        token,
        public_identity_id: identity,
        principal_id: principal,
      });
    }
    await c.query("COMMIT");
    return identities;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
