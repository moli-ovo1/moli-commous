import { createServer, type IncomingMessage } from "node:http";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import type pg from "pg";
import { hash } from "./db.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
const fail = (status: number, code: string, message: string): never => {
  throw new ApiError(status, code, message);
};
const uuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const object = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
function exact(v: unknown, keys: string[]) {
  if (!object(v) || Object.keys(v).some((k) => !keys.includes(k)))
    fail(400, "INVALID_FIELDS", "Unknown or invalid fields");
}
async function body(req: IncomingMessage) {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json")
    fail(400, "INVALID_CONTENT_TYPE", "Use application/json");
  let n = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    n += chunk.length;
    if (n > 65536) fail(413, "BODY_TOO_LARGE", "Request exceeds 64 KiB");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return fail(400, "INVALID_JSON", "Invalid JSON");
  }
}
export function validateContent(v: any, comment: boolean) {
  exact(
    v,
    comment
      ? ["body", "mentions", "reply_to_comment_id"]
      : ["body", "mentions"],
  );
  exact(v.body, ["format", "text"]);
  if (v.body.format !== "plain_text")
    fail(422, "UNSUPPORTED_FORMAT", "Only plain_text is supported");
  if (typeof v.body.text !== "string" || !v.body.text.trim())
    fail(422, "INVALID_TEXT", "Text must not be blank");
  if (v.body.text.includes("\u0000"))
    fail(422, "INVALID_TEXT", "NUL is not supported in text");
  if (Buffer.byteLength(v.body.text) > 32768)
    fail(413, "TEXT_TOO_LARGE", "Text exceeds 32 KiB");
  if (!Array.isArray(v.mentions) || v.mentions.length)
    fail(422, "MENTIONS_UNSUPPORTED", "Gate 1 requires mentions: []");
  if (comment && v.reply_to_comment_id !== null)
    fail(
      422,
      "REPLIES_UNSUPPORTED",
      "Gate 1 requires reply_to_comment_id: null",
    );
  return {
    body: { format: "plain_text", text: v.body.text },
    mentions: [],
    ...(comment ? { reply_to_comment_id: null } : {}),
  };
}
const authSQL = `SELECT p.principal_id,p.public_identity_id,i.display_name,i.character_id,i.layer,i.revision,h.household_id,h.display_label
 FROM test_principals p JOIN public_identities i USING(public_identity_id) JOIN characters c USING(character_id)
 JOIN households h USING(household_id) JOIN humans u ON u.human_id=h.owner_human_id
 WHERE p.token_hash=$1 AND p.status='active' AND i.status='active' AND c.status='active' AND h.status='active' AND u.status='active'`;
function resource(r: any, comment: boolean) {
  return {
    ...(comment
      ? {
          comment_id: r.comment_id,
          post_id: r.post_id,
          reply_to_comment_id: null,
        }
      : { post_id: r.post_id, layer: "surface" }),
    author_public_identity_id: r.author_public_identity_id,
    body: { format: "plain_text", text: r.body_text },
    mentions: [],
    revision: r.revision,
    created_seq: r.created_seq,
    created_at: r.created_at,
    updated_at: r.updated_at,
    status: r.status,
    origin: r.origin,
    ...(r.display_name
      ? {
          author: {
            public_identity_id: r.author_public_identity_id,
            display_name: r.display_name,
            household_id: r.household_id,
            display_label: r.display_label,
          },
        }
      : {}),
  };
}
const authorJoin = ` JOIN public_identities i ON i.public_identity_id=r.author_public_identity_id JOIN characters c ON c.character_id=i.character_id JOIN households h ON h.household_id=c.household_id `;
const selectResource = `SELECT r.*,i.display_name,h.household_id,h.display_label FROM `;
type Hook = (stage: string, client: pg.PoolClient) => Promise<void>;
export async function createApp(
  pool: pg.Pool,
  secret: string,
  hook: Hook = async () => {},
) {
  if (secret.length < 32) throw new Error("Cursor secret too short");
  const serverId = (await pool.query("SELECT server_id FROM server_meta"))
    .rows[0]?.server_id;
  if (!serverId) throw new Error("Run migrate first");
  const sign = (v: any) => {
    const text = Buffer.from(JSON.stringify(v)).toString("base64url");
    return (
      text + "." + createHmac("sha256", secret).update(text).digest("base64url")
    );
  };
  function cursor(raw: string | null, scope: string) {
    if (!raw) return null;
    try {
      if (raw.length > 2048) throw new Error();
      const [text, mac, ...extra] = raw.split(".");
      const expected = createHmac("sha256", secret).update(text).digest();
      const actual = Buffer.from(mac, "base64url");
      if (
        extra.length ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw new Error();
      const v = JSON.parse(Buffer.from(text, "base64url").toString());
      if (
        v.server !== serverId ||
        v.scope !== scope ||
        !/^\d+$/.test(v.last) ||
        (v.snapshot !== undefined && !/^\d+$/.test(v.snapshot))
      )
        throw new Error();
      return v;
    } catch {
      return fail(
        400,
        "INVALID_CURSOR",
        "Cursor is invalid for this stream or identity",
      );
    }
  }
  const high = async () =>
    String(
      (
        await pool.query(
          "SELECT committed_seq FROM stream_state WHERE stream='surface'",
        )
      ).rows[0].committed_seq,
    );
  function event(r: any) {
    return {
      event_id: r.event_id,
      schema_version: r.schema_version,
      commons_server_id: serverId,
      event_seq: r.event_seq,
      layer: r.layer,
      type: r.type,
      occurred_at: r.occurred_at,
      actor_public_identity_id: r.actor_public_identity_id,
      subject: r.subject,
      context: r.context,
      visibility: r.visibility,
      origin: r.origin,
    };
  }
  async function write(
    principal: any,
    tokenHash: string,
    key: string,
    path: string,
    input: any,
    postId: string | null,
    requestId: string,
  ) {
    if (!uuid(key))
      fail(
        400,
        "INVALID_IDEMPOTENCY_KEY",
        "A UUID Idempotency-Key is required",
      );
    const fingerprint = hash(JSON.stringify({ method: "POST", path, input }));
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT committed_seq FROM stream_state WHERE stream='surface' FOR UPDATE",
      );
      if (!(await c.query(authSQL, [tokenHash])).rowCount)
        fail(403, "IDENTITY_INACTIVE", "Identity cannot act");
      const prior = (
        await c.query(
          "SELECT * FROM idempotency_records WHERE principal_id=$1 AND key=$2",
          [principal.principal_id, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== fingerprint)
          fail(
            409,
            "IDEMPOTENCY_KEY_REUSED",
            "This key belongs to a different request",
          );
        await c.query("COMMIT");
        return prior.response_json;
      }
      let parent: any;
      if (postId) {
        parent = (
          await c.query("SELECT * FROM posts WHERE post_id=$1", [postId])
        ).rows[0];
        if (!parent) fail(404, "NOT_FOUND", "Post not found");
      }
      const seq = (
        await c.query(
          "UPDATE stream_state SET committed_seq=committed_seq+1 WHERE stream='surface' RETURNING committed_seq",
        )
      ).rows[0].committed_seq;
      const id = randomUUID(),
        eventId = randomUUID();
      const inserted = postId
        ? await c.query(
            "INSERT INTO comments(comment_id,post_id,author_public_identity_id,body_text,created_seq) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [id, postId, principal.public_identity_id, input.body.text, seq],
          )
        : await c.query(
            "INSERT INTO posts(post_id,author_public_identity_id,body_text,created_seq) VALUES($1,$2,$3,$4) RETURNING *",
            [id, principal.public_identity_id, input.body.text, seq],
          );
      const r = inserted.rows[0];
      await hook("resource", c);
      const subject = { kind: postId ? "comment" : "post", id, revision: 1 },
        context = postId ? { post_id: postId, reply_to_comment_id: null } : {};
      await c.query(
        "INSERT INTO events VALUES($1,$2,1,$3,'surface',$4,$5,$6,'public',$7,'test_harness')",
        [
          eventId,
          seq,
          postId ? "square.comment.created" : "square.post.created",
          principal.public_identity_id,
          subject,
          context,
          r.created_at,
        ],
      );
      await hook("event", c);
      if (
        parent &&
        parent.author_public_identity_id !== principal.public_identity_id
      )
        await c.query(
          "INSERT INTO notifications VALUES($1,$2,$3,ARRAY['comment_on_own_post'],$4)",
          [
            randomUUID(),
            parent.author_public_identity_id,
            eventId,
            r.created_at,
          ],
        );
      await hook("notification", c);
      const response = {
        data: resource(r, !!postId),
        event_id: eventId,
        event_seq: seq,
        request_id: requestId,
      };
      await c.query(
        "INSERT INTO idempotency_records(principal_id,key,request_hash,resource_id,event_id,response_status,response_json) VALUES($1,$2,$3,$4,$5,201,$6)",
        [principal.principal_id, key, fingerprint, id, eventId, response],
      );
      await hook("idempotency", c);
      await c.query("COMMIT");
      return response;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  return createServer(async (req, res) => {
    const requestId = randomUUID();
    const send = (status: number, data: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      if (req.method === "GET" && path === "/healthz")
        return send(200, { status: "ok", mode: "test" });
      if (req.method === "GET" && (path === "/" || path === "/client.js")) {
        const name = path === "/" ? "index.html" : "client.js";
        res.writeHead(200, {
          "Content-Type":
            path === "/"
              ? "text/html; charset=utf-8"
              : "text/javascript; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
        });
        return res.end(
          await readFile(new URL("../test-client/" + name, import.meta.url)),
        );
      }
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        fail(403, "ORIGIN_REJECTED", "Cross-origin access is disabled");
      const token = req.headers.authorization?.match(
        /^Bearer ([A-Za-z0-9_-]+)$/,
      )?.[1];
      if (!token) fail(401, "UNAUTHORIZED", "A fixture token is required");
      const tokenHash = hash(token!);
      const principal = (await pool.query(authSQL, [tokenHash])).rows[0];
      if (!principal)
        fail(401, "UNAUTHORIZED", "Invalid or inactive fixture token");
      if (req.method === "GET" && path === "/v1/me")
        return send(200, {
          mode: "test",
          commons_server_id: serverId,
          identity: principal,
        });
      const match = path.match(/^\/v1\/posts\/([^/]+)(\/comments)?$/);
      if (match && !uuid(match[1]))
        fail(400, "INVALID_ID", "Invalid resource UUID");
      if (req.method === "POST" && (path === "/v1/posts" || match?.[2])) {
        if (url.search)
          fail(400, "INVALID_QUERY", "Writes do not accept query parameters");
        const input = validateContent(await body(req), !!match);
        return send(
          201,
          await write(
            principal,
            tokenHash,
            String(req.headers["idempotency-key"] ?? ""),
            path,
            input,
            match ? match[1] : null,
            requestId,
          ),
        );
      }
      if (req.method === "GET" && match && !match[2]) {
        const r = (
          await pool.query(
            selectResource + "posts r" + authorJoin + "WHERE r.post_id=$1",
            [match[1]],
          )
        ).rows[0];
        if (!r) fail(404, "NOT_FOUND", "Post not found");
        return send(200, { data: resource(r, false) });
      }
      const isEvents = path === "/v1/events" || path === "/v1/me/events";
      if (
        req.method === "GET" &&
        (path === "/v1/posts" || match?.[2] || isEvents)
      ) {
        if (
          [...url.searchParams.keys()].some(
            (k) => !["cursor", "limit"].includes(k),
          ) ||
          [...url.searchParams.keys()].some(
            (k) => url.searchParams.getAll(k).length > 1,
          )
        )
          fail(400, "INVALID_QUERY", "Unknown or repeated query parameter");
        const limit = Number(
          url.searchParams.get("limit") ?? (isEvents ? 100 : 20),
        );
        if (
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > (isEvents ? 200 : 50)
        )
          fail(400, "INVALID_LIMIT", "Invalid page size");
        if (isEvents) {
          const mine = path === "/v1/me/events";
          const scope = mine ? "me:" + principal.public_identity_id : "square";
          const previous = cursor(url.searchParams.get("cursor"), scope);
          const h = await high();
          const sql = mine
            ? `SELECT e.*,n.notification_id,n.recipient_public_identity_id,n.reasons,n.created_at AS notification_created FROM events e JOIN notifications n USING(event_id) WHERE e.event_seq>$1 AND e.event_seq<=$2 AND n.recipient_public_identity_id=$4 ORDER BY e.event_seq LIMIT $3`
            : `SELECT e.* FROM events e WHERE e.event_seq>$1 AND e.event_seq<=$2 ORDER BY e.event_seq LIMIT $3`;
          const params: any[] = [previous?.last ?? "0", h, limit + 1];
          if (mine) params.push(principal.public_identity_id);
          const rows = (await pool.query(sql, params)).rows;
          const more = rows.length > limit;
          const page = rows.slice(0, limit);
          const items = page.map((r) => ({
            event: event(r),
            ...(mine
              ? {
                  notification: {
                    notification_id: r.notification_id,
                    recipient_public_identity_id:
                      r.recipient_public_identity_id,
                    event_id: r.event_id,
                    reasons: r.reasons,
                    resource: {
                      kind: r.subject.kind,
                      id: r.subject.id,
                      ...r.context,
                    },
                    created_at: r.notification_created,
                  },
                }
              : {}),
          }));
          return send(200, {
            items,
            next_cursor: sign({
              server: serverId,
              scope,
              last: more ? page.at(-1).event_seq : h,
            }),
            has_more: more,
            high_watermark: h,
          });
        }
        const comment = !!match;
        const scope = comment ? "comments:" + match![1] : "posts";
        if (
          comment &&
          !(
            await pool.query("SELECT 1 FROM posts WHERE post_id=$1", [
              match![1],
            ])
          ).rowCount
        )
          fail(404, "NOT_FOUND", "Post not found");
        const previous = cursor(url.searchParams.get("cursor"), scope);
        const snapshot = previous?.snapshot ?? (await high());
        const params: any[] = [
          snapshot,
          previous?.last ??
            (comment ? "0" : (BigInt(snapshot) + 1n).toString()),
          limit + 1,
        ];
        if (comment) params.push(match![1]);
        const rows = (
          await pool.query(
            selectResource +
              (comment ? "comments" : "posts") +
              " r" +
              authorJoin +
              `WHERE r.created_seq<=$1 AND r.created_seq${comment ? ">" : "<"}$2 ${comment ? "AND r.post_id=$4" : ""} ORDER BY r.created_seq ${comment ? "ASC" : "DESC"} LIMIT $3`,
            params,
          )
        ).rows;
        const more = rows.length > limit;
        const page = rows.slice(0, limit);
        return send(200, {
          items: page.map((r) => resource(r, comment)),
          snapshot_seq: snapshot,
          has_more: more,
          next_cursor: more
            ? sign({
                server: serverId,
                scope,
                snapshot,
                last: page.at(-1).created_seq,
              })
            : null,
        });
      }
      return send(404, {
        error: {
          code: "NOT_FOUND",
          message: "Endpoint not available in Gate 1",
          request_id: requestId,
          retryable: false,
        },
      });
    } catch (e) {
      if (e instanceof ApiError)
        return send(e.status, {
          error: {
            code: e.code,
            message: e.message,
            request_id: requestId,
            retryable: false,
          },
        });
      // Never log request bodies, credentials, SQL parameters, or database error details.
      return send(503, {
        error: {
          code: "TEMPORARILY_UNAVAILABLE",
          message: "Request could not complete; retry with the same key",
          request_id: requestId,
          retryable: true,
        },
      });
    }
  });
}
