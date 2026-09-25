import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const base = "http://127.0.0.1:4317";
let ready = false;
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(base + "/healthz")).ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
assert.ok(ready, "pnpm demo did not become healthy");

const candidates = (await readdir(".local")).filter((name) =>
  /^fixtures-[0-9a-f-]+\.json$/.test(name),
);
assert.equal(candidates.length, 1, "Expected one dedicated demo fixture file");
const [A, B] = JSON.parse(
  await readFile(`.local/${candidates[0]}`, "utf8"),
);
assert.ok(A?.token && B?.token && A.token !== B.token);

async function request(path, token, data) {
  const response = await fetch(base + path, {
    method: data === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(data === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": randomUUID(),
          }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  assert.ok(
    response.ok,
    `${path} returned ${response.status} ${result.error?.code ?? ""}`,
  );
  return result;
}

const before = (await request("/v1/me/events", A.token)).next_cursor;
const post = await request("/v1/posts", A.token, {
  body: { format: "plain_text", text: "Gate 1 demo post from A" },
  mentions: [],
});
assert.equal(post.data.author_public_identity_id, A.public_identity_id);
const comment = await request(
  `/v1/posts/${post.data.post_id}/comments`,
  B.token,
  {
    body: { format: "plain_text", text: "Gate 1 demo comment from B" },
    reply_to_comment_id: null,
    mentions: [],
  },
);
assert.equal(comment.data.author_public_identity_id, B.public_identity_id);
const inbox = await request(
  "/v1/me/events?cursor=" + encodeURIComponent(before),
  A.token,
);
const notification = inbox.items.find(
  (entry) => entry.event.event_id === comment.event_id,
)?.notification;
assert.ok(notification, "A did not receive B's comment notification");
assert.equal(notification.recipient_public_identity_id, A.public_identity_id);
assert.deepEqual(notification.reasons, ["comment_on_own_post"]);
console.log(
  `DEMO PASS: A post ${post.data.post_id} -> B comment ${comment.data.comment_id} -> A notification ${notification.notification_id}`,
);
