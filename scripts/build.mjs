import { spawnSync } from "node:child_process";
import { cp } from "node:fs/promises";
const result = spawnSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--noEmit", "false", "--outDir", "dist"],
  { stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) process.exit(result.status ?? 1);
for (const asset of ["migrations", "test-client"])
  await cp(asset, "dist/" + asset, { recursive: true });
