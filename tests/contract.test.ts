import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { config } from "../src/config.js";
import { validateContent, ApiError } from "../src/service.js";
const valid = {
  body: { format: "plain_text", text: "来自另一个家。" },
  mentions: [],
};
test("test-only startup refuses accidental production and placeholder secrets", () => {
  for (const mode of [undefined, "production", "development"])
    assert.throws(() => config({ COMMONS_MODE: mode }));
  assert.throws(() =>
    config({
      COMMONS_MODE: "test",
      DATABASE_URL: "test",
      CURSOR_SECRET: "replace-with-a-random-local-test-secret",
    }),
  );
  assert.equal(
    config({
      COMMONS_MODE: "test",
      DATABASE_URL: "test",
      CURSOR_SECRET: "a".repeat(32),
    }).host,
    "127.0.0.1",
  );
});
test("private context, forged actor, backstage and unsupported interactions never pass write validation", () => {
  for (const field of [
    "author_public_identity_id",
    "character_card",
    "world_book",
    "persona",
    "api_key",
    "system_prompt",
    "memory",
    "layer",
  ])
    assert.throws(
      () => validateContent({ ...valid, [field]: "private" }, false),
      (e: any) => e instanceof ApiError && e.status === 400,
    );
  assert.throws(() =>
    validateContent(
      { ...valid, mentions: [{ target_public_identity_id: "x" }] },
      false,
    ),
  );
  assert.throws(() =>
    validateContent({ ...valid, reply_to_comment_id: "x" }, true),
  );
  assert.deepEqual(
    validateContent({ ...valid, reply_to_comment_id: null }, true),
    { ...valid, reply_to_comment_id: null },
  );
});
test("public text limits count UTF-8 bytes and reject blank/NUL/HTML format without interpreting content", () => {
  assert.throws(
    () =>
      validateContent(
        { ...valid, body: { format: "plain_text", text: "中".repeat(10923) } },
        false,
      ),
    (e: any) => e.status === 413,
  );
  for (const text of ["", " \n\t", "a\u0000b"])
    assert.throws(() =>
      validateContent(
        { ...valid, body: { format: "plain_text", text } },
        false,
      ),
    );
  assert.throws(() =>
    validateContent(
      { ...valid, body: { format: "html", text: "<script>bad()</script>" } },
      false,
    ),
  );
  assert.equal(
    validateContent(
      {
        ...valid,
        body: { format: "plain_text", text: "<script>literal</script>" },
      },
      false,
    ).body.text,
    "<script>literal</script>",
  );
});
test("published OpenAPI has resolving local references and exactly Gate 1 operations", async () => {
  const api = JSON.parse(await readFile("contracts/openapi.v1.json", "utf8"));
  assert.equal(api.openapi, "3.1.0");
  function walk(v: any) {
    if (!v || typeof v !== "object") return;
    if (v.$ref) {
      let target = api;
      for (const key of v.$ref.replace("#/", "").split("/"))
        target = target?.[key];
      assert.ok(target, `unresolved ${v.$ref}`);
    }
    for (const value of Object.values(v)) walk(value);
  }
  walk(api);
  const operations = Object.entries(api.paths).flatMap(([path, methods]: any) =>
    Object.keys(methods)
      .filter((k) => ["get", "post", "patch", "put", "delete"].includes(k))
      .map((m) => m + " " + path),
  );
  assert.equal(operations.length, 9);
  assert.ok(!operations.some((x) => /mail|game|agent|like/.test(x)));
  assert.ok(operations.includes("post /v1/posts/{post_id}/comments"));
});
