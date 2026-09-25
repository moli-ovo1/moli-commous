import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createServer as netServer } from "node:net";
import { localPostgres } from "../scripts/local-postgres.js";
import { Pool, migrate, seed } from "../src/db.js";
import { createApp } from "../src/service.js";
import { config } from "../src/config.js";
import type { Server } from "node:http";
let pool: InstanceType<typeof Pool>,
  db: Awaited<ReturnType<typeof localPostgres>> | undefined,
  server: Server,
  base: string,
  fixtures: Awaited<ReturnType<typeof seed>>;
const secret = "test-cursor-secret-at-least-32-characters";
async function freePort() {
  const s = netServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const p = (s.address() as any).port;
  await new Promise<void>((r) => s.close(() => r()));
  return p;
}
async function listen(s: Server) {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as any).port}`;
}
async function close(s: Server) {
  s.closeAllConnections();
  await new Promise<void>((r) => s.close(() => r()));
}
before(
  async () => {
    let url = process.env.TEST_DATABASE_URL;
    if (!url) {
      const port = await freePort();
      db = await localPostgres(
        path.resolve(".local", "test-db-" + randomUUID()),
        port,
      );
      url = db.url;
    }
    pool = new Pool({ connectionString: url, max: 25 });
    await migrate(pool);
    fixtures = await seed(pool);
    server = await createApp(pool, secret);
    base = await listen(server);
  },
  { timeout: 60000 },
);
after(async () => {
  if (server) await close(server);
  if (pool) await pool.end();
  if (db) await db.stop();
});
async function req(
  route: string,
  who = 0,
  payload?: any,
  key = randomUUID(),
  host = base,
) {
  const response = await fetch(host + route, {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${fixtures[who].token}`,
      ...(payload === undefined
        ? {}
        : { "Content-Type": "application/json", "Idempotency-Key": key }),
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return { status: response.status, data: await response.json() };
}
const content = (text = "test") => ({
  body: { format: "plain_text", text },
  mentions: [],
});
const comment = (text = "comment") => ({
  ...content(text),
  reply_to_comment_id: null,
});
async function post(who = 0, text = "post") {
  const r = await req("/v1/posts", who, content(text));
  assert.equal(r.status, 201);
  return r.data.data.post_id;
}
async function counts() {
  const r = await pool.query(
    `SELECT (SELECT count(*) FROM posts) AS posts,(SELECT count(*) FROM comments) AS comments,(SELECT count(*) FROM events) AS events,(SELECT count(*) FROM notifications) AS notifications,(SELECT count(*) FROM idempotency_records) AS keys,(SELECT committed_seq FROM stream_state) AS seq`,
  );
  return r.rows[0];
}
test("production disabled, no model required", () => {
  assert.throws(() => config({ COMMONS_MODE: "production" }));
  assert.throws(() =>
    config({ COMMONS_MODE: "test", DATABASE_URL: "x", CURSOR_SECRET: "short" }),
  );
  assert.equal(
    config({ COMMONS_MODE: "test", DATABASE_URL: "x", CURSOR_SECRET: secret })
      .host,
    "127.0.0.1",
  );
});
test("A posts, B comments, A receives one notification; same names remain different identities", async () => {
  const a = await req("/v1/me"),
    b = await req("/v1/me", 1);
  assert.equal(a.data.identity.display_name, b.data.identity.display_name);
  assert.notEqual(
    a.data.identity.public_identity_id,
    b.data.identity.public_identity_id,
  );
  const checkpoint = (await req("/v1/me/events")).data.next_cursor;
  const p = await post();
  const r = await req(`/v1/posts/${p}/comments`, 1, comment("来自另一个家"));
  assert.equal(r.status, 201);
  const inbox = await req(
    "/v1/me/events?cursor=" + encodeURIComponent(checkpoint),
  );
  assert.equal(inbox.data.items.length, 1);
  assert.equal(inbox.data.items[0].event.event_id, r.data.event_id);
  assert.equal(
    inbox.data.items[0].notification.recipient_public_identity_id,
    fixtures[0].public_identity_id,
  );
  assert.equal(
    (await req(`/v1/posts/${p}/comments`)).data.items[0].body.text,
    "来自另一个家",
  );
  assert.deepEqual(
    (await req(`/v1/posts/${p}/comments`)).data,
    (await req(`/v1/posts/${p}/comments`, 1)).data,
  );
  await req(`/v1/posts/${p}/comments`, 0, comment("self"));
  assert.equal(
    (
      await req(
        "/v1/me/events?cursor=" + encodeURIComponent(inbox.data.next_cursor),
      )
    ).data.items.length,
    0,
  );
});
test("20 concurrent retries create one resource/event/notification; same key with different payload or path conflicts", async () => {
  const p = await post(),
    key = randomUUID(),
    route = `/v1/posts/${p}/comments`,
    before = await counts();
  const results = await Promise.all(
    Array.from({ length: 20 }, () => req(route, 1, comment(), key)),
  );
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(new Set(results.map((r) => r.data.data.comment_id)).size, 1);
  assert.ok(results.every((r) => r.data.event_id === results[0].data.event_id));
  const after = await counts();
  for (const field of ["comments", "events", "notifications", "keys"])
    assert.equal(Number(after[field]) - Number(before[field]), 1);
  assert.equal((await req(route, 1, comment("changed"), key)).status, 409);
  assert.equal((await req("/v1/posts", 1, content(), key)).status, 409);
});
test("authorization, recipient isolation, unsupported replies/mentions/private fields, invalid cursors", async () => {
  assert.equal((await fetch(base + "/v1/posts")).status, 401);
  assert.equal(
    (
      await req("/v1/posts", 0, {
        ...content(),
        author_public_identity_id: fixtures[1].public_identity_id,
      })
    ).status,
    400,
  );
  assert.equal(
    (await req("/v1/posts", 0, { ...content(), world_book: "private" })).status,
    400,
  );
  assert.equal(
    (await req("/v1/posts", 0, { ...content(), layer: "backstage" })).status,
    400,
  );
  assert.equal(
    (
      await req("/v1/posts", 0, {
        ...content(),
        mentions: [
          { target_public_identity_id: fixtures[1].public_identity_id },
        ],
      })
    ).status,
    422,
  );
  const p = await post();
  assert.equal(
    (
      await req(`/v1/posts/${p}/comments`, 0, {
        ...comment(),
        reply_to_comment_id: randomUUID(),
      })
    ).status,
    422,
  );
  const cursor = (await req("/v1/me/events")).data.next_cursor;
  assert.equal(
    (await req("/v1/me/events?cursor=" + encodeURIComponent(cursor), 1)).status,
    400,
  );
  assert.equal((await req("/v1/me/events?recipient=x")).status, 400);
  assert.equal((await req("/v1/events?cursor=broken")).status, 400);
  assert.equal((await req("/v1/posts?limit=51")).status, 400);
  assert.equal(
    (await req("/v1/posts", 0, content("x".repeat(32769)))).status,
    413,
  );
  assert.equal((await req("/v1/posts", 0, content("   "))).status, 422);
});
test("each transaction failure point rolls back content, events, notifications, key and watermark", async () => {
  const p = await post();
  for (const stage of ["resource", "event", "notification", "idempotency"]) {
    const s = await createApp(pool, secret, async (current) => {
      if (current === stage) throw new Error("injected");
    });
    const host = await listen(s);
    const before = await counts();
    const key = randomUUID();
    try {
      assert.equal(
        (await req(`/v1/posts/${p}/comments`, 1, comment(), key, host)).status,
        503,
      );
      assert.deepEqual(await counts(), before);
      assert.equal(
        (await req(`/v1/posts/${p}/comments`, 1, comment(), key)).status,
        201,
      );
    } finally {
      await close(s);
    }
  }
});
test("commit ordering blocks later writer; readers never advance past an uncommitted earlier event", async () => {
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    barrier = new Promise<void>((r) => (release = r));
  let once = true;
  const s = await createApp(pool, secret, async (stage) => {
    if (stage === "resource" && once) {
      once = false;
      entered();
      await barrier;
    }
  });
  const host = await listen(s);
  const checkpoint = (await req("/v1/events")).data.next_cursor;
  const first = req("/v1/posts", 0, content("T1"), randomUUID(), host);
  await started;
  let secondDone = false;
  const second = req("/v1/posts", 1, content("T2")).then((r) => {
    secondDone = true;
    return r;
  });
  try {
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(secondDone, false);
    assert.equal(
      (await req("/v1/events?cursor=" + encodeURIComponent(checkpoint))).data
        .items.length,
      0,
    );
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.ok(BigInt(a.data.event_seq) < BigInt(b.data.event_seq));
    assert.equal(
      (await req("/v1/events?cursor=" + encodeURIComponent(checkpoint))).data
        .items.length,
      2,
    );
  } finally {
    release();
    await close(s);
  }
});
test("offline replay, unrelated sequence gaps, two independent device checkpoints", async () => {
  const checkpoint = (await req("/v1/me/events")).data.next_cursor;
  const p = await post();
  await post(1);
  await req(`/v1/posts/${p}/comments`, 1, comment("offline"));
  const a = await req("/v1/me/events?cursor=" + encodeURIComponent(checkpoint));
  const b = await req("/v1/me/events?cursor=" + encodeURIComponent(checkpoint));
  assert.deepEqual(a.data, b.data);
  assert.equal(a.data.items.length, 1);
  const empty = await req(
    "/v1/me/events?cursor=" + encodeURIComponent(a.data.next_cursor),
  );
  assert.equal(empty.data.items.length, 0);
  await post(1);
  const skip = await req(
    "/v1/me/events?cursor=" + encodeURIComponent(empty.data.next_cursor),
  );
  assert.equal(skip.data.items.length, 0);
  await req(`/v1/posts/${p}/comments`, 1, comment("after-gap"));
  assert.equal(
    (
      await req(
        "/v1/me/events?cursor=" + encodeURIComponent(skip.data.next_cursor),
      )
    ).data.items.length,
    1,
  );
});
test("stable resource pagination excludes concurrent creation until refresh", async () => {
  const first = await req("/v1/posts?limit=2");
  const snapshot = BigInt(first.data.snapshot_seq);
  const fresh = await post();
  const ids = first.data.items.map((r: any) => r.post_id);
  let cursor = first.data.next_cursor;
  while (cursor) {
    const page = (
      await req("/v1/posts?limit=2&cursor=" + encodeURIComponent(cursor))
    ).data;
    assert.ok(page.items.every((r: any) => BigInt(r.created_seq) <= snapshot));
    ids.push(...page.items.map((r: any) => r.post_id));
    cursor = page.next_cursor;
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes(fresh));
  assert.equal((await req("/v1/posts?limit=2")).data.items[0].post_id, fresh);
  assert.equal(
    ids.length,
    Number(
      (
        await pool.query("SELECT count(*) FROM posts WHERE created_seq<=$1", [
          snapshot.toString(),
        ])
      ).rows[0].count,
    ),
  );
});
test("event pagination returns every event once, including empty terminal page", async () => {
  const ids: string[] = [];
  let cursor: string | undefined;
  let more = true;
  while (more) {
    const r = (
      await req(
        "/v1/events?limit=2" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      )
    ).data;
    ids.push(...r.items.map((i: any) => i.event.event_id));
    cursor = r.next_cursor;
    more = r.has_more;
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(
    ids.length,
    Number((await pool.query("SELECT count(*) FROM events")).rows[0].count),
  );
  assert.equal(
    (await req("/v1/events?cursor=" + encodeURIComponent(cursor!))).data.items
      .length,
    0,
  );
});
test("server restart preserves identity, events and idempotent retry of unknown response", async () => {
  const key = randomUUID(),
    payload = content("response-lost");
  const original = await req("/v1/posts", 0, payload, key);
  await close(server);
  server = await createApp(pool, secret);
  base = await listen(server);
  await migrate(pool);
  const replay = await req("/v1/posts", 0, payload, key);
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.data, original.data);
  assert.equal(
    (await req(`/v1/posts/${original.data.data.post_id}`)).status,
    200,
  );
});
test("database constraints and withdrawal remain enforced; no awareness/memory tables exist", async () => {
  await assert.rejects(
    pool.query(
      "UPDATE public_identities SET layer='backstage' WHERE public_identity_id=$1",
      [fixtures[0].public_identity_id],
    ),
  );
  await assert.rejects(
    pool.query(
      "INSERT INTO comments(comment_id,post_id,author_public_identity_id,body_text,created_seq) VALUES($1,$2,$3,$4,999999)",
      [randomUUID(), randomUUID(), fixtures[0].public_identity_id, "bad fk"],
    ),
  );
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    )
  ).rows.map((r) => r.tablename);
  assert.ok(
    !tables.some((t) =>
      /memory|awareness|agent|like|mention|game|mail/.test(t),
    ),
  );
  const key = randomUUID(),
    payload = content("before withdraw");
  await req("/v1/posts", 0, payload, key);
  await pool.query(
    "UPDATE public_identities SET status='withdrawn' WHERE public_identity_id=$1",
    [fixtures[0].public_identity_id],
  );
  assert.equal((await req("/v1/posts", 0, payload, key)).status, 401);
  await pool.query(
    "UPDATE public_identities SET status='active' WHERE public_identity_id=$1",
    [fixtures[0].public_identity_id],
  );
});
