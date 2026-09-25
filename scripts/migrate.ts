import { Pool, migrate } from "../src/db.js";
import { config } from "../src/config.js";
const pool = new Pool({ connectionString: config().databaseUrl });
try {
  await migrate(pool);
  console.log("Gate 1 schema ready");
} finally {
  await pool.end();
}
