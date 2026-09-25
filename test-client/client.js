const el = (id) => document.getElementById(id);
let token = "",
  me = null,
  next = null;
const device =
  localStorage.getItem("commons-installation") || crypto.randomUUID();
localStorage.setItem("commons-installation", device);
const status = (t) => (el("status").textContent = t);
const scope = (stream) =>
  `commons:${me.commons_server_id}:${me.identity.public_identity_id}:${device}:${stream}`;
async function api(path, options = {}) {
  const r = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  const value = await r.json();
  if (!r.ok) {
    const e = new Error(
      `${r.status} ${value.error?.code}: ${value.error?.message}`,
    );
    e.status = r.status;
    throw e;
  }
  return value;
}
async function action(fn) {
  try {
    if (!me) throw new Error("请先连接测试身份");
    await fn();
    status("完成（测试数据）");
  } catch (e) {
    status(e.message);
  }
}
function text(tag, value, parent) {
  const n = document.createElement(tag);
  n.textContent = value;
  parent.append(n);
  return n;
}
async function submit(path, payload) {
  // Persist only the pending test action, never the bearer token. Keep the key after network failure.
  const storage = scope("pending:" + path),
    encoded = JSON.stringify(payload);
  let pending = JSON.parse(localStorage.getItem(storage) || "null");
  if (pending && pending.payload !== encoded)
    throw new Error("上次请求结果未知，请先用原正文重试完成后再修改。");
  pending ??= { key: crypto.randomUUID(), payload: encoded };
  localStorage.setItem(storage, JSON.stringify(pending));
  try {
    const result = await api(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": pending.key,
      },
      body: encoded,
    });
    localStorage.removeItem(storage);
    return result;
  } catch (e) {
    if ([400, 413, 422].includes(e.status)) localStorage.removeItem(storage);
    throw e;
  }
}
async function showComments(post, container, cursor = null) {
  const page = await api(
    `/v1/posts/${post}/comments${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`,
  );
  for (const c of page.items) {
    text(
      "p",
      `${c.author.display_name} · ${c.author.display_label}：${c.body.text}`,
      container,
    ).className = "text";
  }
  if (page.next_cursor) {
    const b = text("button", "更多评论", container);
    b.onclick = () =>
      action(async () => {
        b.remove();
        await showComments(post, container, page.next_cursor);
      });
  }
}
async function feed(cursor = null) {
  const page = await api(
    "/v1/posts" + (cursor ? "?cursor=" + encodeURIComponent(cursor) : ""),
  );
  if (!cursor) el("feed").replaceChildren();
  for (const p of page.items) {
    const article = document.createElement("article");
    el("feed").append(article);
    text(
      "strong",
      `${p.author.display_name} · ${p.author.display_label}`,
      article,
    );
    text("p", p.body.text, article).className = "text";
    text("small", `${p.post_id} · revision ${p.revision}`, article);
    const comments = document.createElement("div");
    article.append(comments);
    const view = text("button", "读取评论", article);
    view.onclick = () =>
      action(async () => {
        comments.replaceChildren();
        await showComments(p.post_id, comments);
      });
    const input = document.createElement("textarea");
    input.setAttribute("aria-label", "测试评论");
    article.append(input);
    const send = text("button", "提交测试评论", article);
    send.onclick = () =>
      action(async () => {
        await submit(`/v1/posts/${p.post_id}/comments`, {
          body: { format: "plain_text", text: input.value },
          mentions: [],
          reply_to_comment_id: null,
        });
        input.value = "";
        comments.replaceChildren();
        await showComments(p.post_id, comments);
      });
  }
  next = page.next_cursor;
  el("more").disabled = !next;
}
async function sync(mine) {
  const key = scope(mine ? "inbox" : "square");
  let saved = JSON.parse(
    localStorage.getItem(key) || '{"cursor":null,"events":[]}',
  );
  let more;
  do {
    const r = await api(
      (mine ? "/v1/me/events" : "/v1/events") +
        (saved.cursor ? "?cursor=" + encodeURIComponent(saved.cursor) : ""),
    );
    const byId = new Map(saved.events.map((i) => [i.event.event_id, i]));
    for (const item of r.items) byId.set(item.event.event_id, item);
    // Write events and checkpoint together; reload can replay safely after interruption.
    saved = { events: [...byId.values()], cursor: r.next_cursor };
    localStorage.setItem(key, JSON.stringify(saved));
    more = r.has_more;
  } while (more);
  if (mine) {
    el("notifications").replaceChildren();
    for (const i of saved.events)
      text("pre", JSON.stringify(i, null, 2), el("notifications"));
  } else await feed();
}
el("connect").onclick = async () => {
  try {
    token = el("token").value.trim();
    me = null;
    const result = await api("/v1/me");
    me = result;
    el("identity").textContent =
      `${me.identity.display_name} · ${me.identity.display_label}（测试）`;
    el("notifications").replaceChildren();
    await feed();
    status("已连接测试身份");
  } catch (e) {
    status(e.message);
  }
};
el("publish").onclick = () =>
  action(async () => {
    await submit("/v1/posts", {
      body: { format: "plain_text", text: el("post-text").value },
      mentions: [],
    });
    el("post-text").value = "";
    await feed();
  });
el("refresh").onclick = () => action(() => feed());
el("more").onclick = () => action(() => feed(next));
el("sync").onclick = () => action(() => sync(false));
el("inbox").onclick = () => action(() => sync(true));
