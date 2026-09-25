// Development/test lifecycle only. Does not install a Windows service or create OS users.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile, unlink, access, cp } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
const run = promisify(execFile);
export async function localPostgres(root: string, port: number) {
  const require = createRequire(import.meta.resolve("embedded-postgres"));
  const platform = process.platform === "win32" ? "windows" : process.platform;
  let bins = await import(
    pathToFileURL(
      require.resolve(`@embedded-postgres/${platform}-${process.arch}`),
    ).href
  );
  // PostgreSQL re-executes itself on Windows; long package-manager paths can fail there.
  if (process.platform === "win32") {
    const native = path.resolve(".local", "pg-native");
    try {
      await access(path.join(native, "bin", "initdb.exe"));
    } catch {
      await cp(path.dirname(path.dirname(bins.initdb)), native, {
        recursive: true,
      });
    }
    bins = {
      initdb: path.join(native, "bin", "initdb.exe"),
      pg_ctl: path.join(native, "bin", "pg_ctl.exe"),
    };
  }
  root = path.resolve(root);
  await mkdir(root, { recursive: true });
  let exists = true;
  try {
    await access(path.join(root, "db", "PG_VERSION"));
  } catch {
    exists = false;
  }
  const passwordFile = path.join(root, "password");
  if (!exists) {
    const password = randomBytes(24).toString("hex");
    await mkdir(path.join(root, "db"), { recursive: true });
    await writeFile(passwordFile, password, { mode: 0o600 });
    try {
      await run(
        bins.initdb,
        [
          "-D",
          "db",
          "-U",
          "commons",
          "--auth=scram-sha-256",
          "--encoding=UTF8",
          "--locale=C",
          "--pwfile=password",
        ],
        { cwd: root, windowsHide: true, timeout: 30000 },
      );
      await writeFile(
        path.join(root, "connection.json"),
        JSON.stringify({ password }),
        { mode: 0o600 },
      );
    } finally {
      await unlink(passwordFile);
    }
  }
  const { readFile } = await import("node:fs/promises");
  const { password } = JSON.parse(
    await readFile(path.join(root, "connection.json"), "utf8"),
  );
  await run(
    bins.pg_ctl,
    [
      "-D",
      path.join(root, "db"),
      "-l",
      path.join(root, "postgres.log"),
      "-w",
      "-t",
      "20",
      "-o",
      `-h 127.0.0.1 -p ${port}`,
      "start",
    ],
    { windowsHide: true, timeout: 25000 },
  );
  return {
    url: `postgres://commons:${password}@127.0.0.1:${port}/postgres`,
    stop: async () => {
      await run(
        bins.pg_ctl,
        ["-D", path.join(root, "db"), "-m", "fast", "-w", "stop"],
        { windowsHide: true, timeout: 15000 },
      );
    },
  };
}
