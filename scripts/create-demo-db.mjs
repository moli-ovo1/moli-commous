import pg from "pg";

const source = process.env.TEST_DATABASE_URL;
if (!source) throw new Error("TEST_DATABASE_URL is required");
const adminUrl = new URL(source);
adminUrl.pathname = "/postgres";
const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  await client.query("CREATE DATABASE commons_gate1_demo");
  console.log("Dedicated demo database created");
} finally {
  await client.end();
}
