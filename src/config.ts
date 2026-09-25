export function config(env = process.env) {
  if (env.COMMONS_MODE !== "test")
    throw new Error(
      "Gate 1 only runs with COMMONS_MODE=test; production is unsupported",
    );
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  if (
    !env.CURSOR_SECRET ||
    env.CURSOR_SECRET.length < 32 ||
    env.CURSOR_SECRET.startsWith("replace-")
  )
    throw new Error("Set a private CURSOR_SECRET of at least 32 characters");
  const port = Number(env.PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  return {
    databaseUrl: env.DATABASE_URL,
    secret: env.CURSOR_SECRET,
    host: env.HOST ?? "127.0.0.1",
    port,
  };
}
