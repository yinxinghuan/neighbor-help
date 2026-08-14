import { DurableObject } from "cloudflare:workers";

const RULESET = "neighbor-help-v1";
const DAY = 24 * 60 * 60 * 1000;

function json(data, status = 200) { return Response.json(data, { status }); }
function fail(code, status = 400, extra = {}) { return json({ accepted: false, code, ...extra }, status); }
function clean(value, max = 120) { return String(value || "").trim().slice(0, max); }
function allowedWorldKey(env, value) {
  if (env.LAB_MODE !== "true") return "main";
  return clean(value, 64) || "main";
}

function initialArchive(now) {
  return {
    schemaVersion: 1,
    worldId: "neighbor-help-main",
    rulesetId: RULESET,
    version: 1,
    cursor: 0,
    requests: [
      { id: "req-umbrella-bus-stop", titleKey: "umbrellaBusStop", locationId: "lobby", destinationId: "bus-stop", requiredItemId: "item-umbrella-last", status: "open", version: 1, createdAt: now },
      { id: "req-medicine-corner", titleKey: "medicinePickup", locationId: "corner-shop", destinationId: "apartment-2b", requiredItemId: "item-medicine-bag", status: "open", version: 1, createdAt: now },
      { id: "req-pet-courtyard", titleKey: "petCare", locationId: "courtyard", destinationId: "courtyard", status: "open", version: 1, createdAt: now },
    ],
    items: [
      { id: "item-umbrella-last", kind: "umbrella", custody: "community", locationId: "lobby", version: 1 },
      { id: "item-medicine-bag", kind: "medicine_bag", custody: "community", locationId: "corner-shop", version: 1 },
      { id: "item-spare-key", kind: "spare_key", custody: "community", locationId: "lobby", version: 1 },
    ],
    events: [],
    processedActions: [],
  };
}

function makeEvent(archive, action, type, requestId, itemId, payload = {}) {
  return {
    id: crypto.randomUUID(),
    seq: archive.cursor + 1,
    worldVersion: archive.version + 1,
    actionId: action.actionId,
    actor: action.actor,
    type,
    ...(requestId ? { requestId } : {}),
    ...(itemId ? { itemId } : {}),
    payload,
    createdAt: action.createdAt,
  };
}

function makeReceipt(action, sourceEntityId, item, operation, userId = action.actor.id) {
  return {
    id: crypto.randomUUID(), userId, sourceEntityId, actionId: action.actionId, operation,
    item: { kind: item.kind, quantity: 1, instanceId: item.id }, createdAt: action.createdAt,
  };
}

function applyAction(archive, action) {
  const requests = archive.requests.map((entry) => ({ ...entry }));
  const items = archive.items.map((entry) => ({ ...entry }));
  const requestFor = (id) => {
    const request = requests.find((entry) => entry.id === id);
    if (!request) throw { code: "ENTITY_NOT_FOUND" };
    return request;
  };
  const itemFor = (id) => {
    const item = items.find((entry) => entry.id === id);
    if (!item) throw { code: "ENTITY_NOT_FOUND" };
    return item;
  };
  let events = [];
  let receipts = [];

  if (action.type === "claim_request") {
    const request = requestFor(action.payload.requestId);
    if (request.status !== "open") throw { code: "REQUEST_UNAVAILABLE" };
    const item = request.requiredItemId ? itemFor(request.requiredItemId) : null;
    if (item && item.custody !== "community" && item.custody !== "returned") throw { code: "ITEM_UNAVAILABLE" };
    request.status = "claimed";
    request.claimantUserId = action.actor.id;
    request.claimantName = action.actor.name;
    delete request.handoffFromUserId;
    request.version += 1;
    if (item) {
      item.custody = "player";
      item.holderUserId = action.actor.id;
      item.requestId = request.id;
      item.version += 1;
      receipts.push(makeReceipt(action, request.id, item, "add"));
    }
    events = [makeEvent(archive, action, "request_claimed", request.id, item?.id, { destinationId: request.destinationId })];
  } else if (action.type === "handoff_request") {
    const request = requestFor(action.payload.requestId);
    if (request.status !== "claimed") throw { code: "REQUEST_UNAVAILABLE" };
    if (request.claimantUserId !== action.actor.id) throw { code: "NOT_REQUEST_OWNER" };
    request.status = "handed_off";
    request.handoffFromUserId = action.actor.id;
    delete request.claimantUserId;
    delete request.claimantName;
    request.version += 1;
    const item = request.requiredItemId ? itemFor(request.requiredItemId) : null;
    if (item) { item.custody = "handoff"; item.version += 1; }
    events = [makeEvent(archive, action, "request_handed_off", request.id, item?.id)];
  } else if (action.type === "claim_handoff") {
    const request = requestFor(action.payload.requestId);
    if (request.status !== "handed_off") throw { code: "REQUEST_UNAVAILABLE" };
    if (request.handoffFromUserId === action.actor.id) throw { code: "INVALID_ACTION" };
    const previousUserId = request.handoffFromUserId;
    request.status = "claimed";
    request.claimantUserId = action.actor.id;
    request.claimantName = action.actor.name;
    delete request.handoffFromUserId;
    request.version += 1;
    const item = request.requiredItemId ? itemFor(request.requiredItemId) : null;
    if (item) {
      if (item.custody !== "handoff") throw { code: "ITEM_UNAVAILABLE" };
      if (previousUserId) receipts.push(makeReceipt(action, request.id, item, "remove", previousUserId));
      receipts.push(makeReceipt(action, request.id, item, "add"));
      item.custody = "player";
      item.holderUserId = action.actor.id;
      item.version += 1;
    }
    events = [makeEvent(archive, action, "handoff_claimed", request.id, item?.id, { previousUserId })];
  } else if (action.type === "complete_request") {
    const request = requestFor(action.payload.requestId);
    if (request.status !== "claimed") throw { code: "REQUEST_UNAVAILABLE" };
    if (request.claimantUserId !== action.actor.id) throw { code: "NOT_REQUEST_OWNER" };
    const item = request.requiredItemId ? itemFor(request.requiredItemId) : null;
    if (item && item.holderUserId !== action.actor.id) throw { code: "ITEM_UNAVAILABLE" };
    request.status = "completed";
    request.version += 1;
    if (item) {
      receipts.push(makeReceipt(action, request.id, item, "remove"));
      item.custody = "returned";
      item.locationId = request.destinationId;
      delete item.holderUserId;
      delete item.requestId;
      item.version += 1;
    }
    events = [makeEvent(archive, action, "request_completed", request.id, item?.id, { destinationId: request.destinationId })];
  } else if (action.type === "return_item") {
    const item = itemFor(action.payload.itemId);
    if (item.holderUserId !== action.actor.id) throw { code: "ITEM_UNAVAILABLE" };
    const request = item.requestId ? requestFor(item.requestId) : null;
    if (request?.status === "claimed") {
      request.status = "open";
      delete request.claimantUserId;
      delete request.claimantName;
      request.version += 1;
    }
    receipts = [makeReceipt(action, request?.id || item.id, item, "remove")];
    item.custody = "community";
    item.locationId = request?.locationId || item.locationId;
    delete item.holderUserId;
    delete item.requestId;
    item.version += 1;
    events = [makeEvent(archive, action, "item_returned", request?.id, item.id)];
  } else if (action.type === "attach_dialogue_media") {
    const source = archive.events.find((entry) => entry.id === action.payload.eventId);
    if (!source) throw { code: "ENTITY_NOT_FOUND" };
    if (source.actor.id !== action.actor.id) throw { code: "AUTH_REQUIRED" };
    const rejectedIds = new Set(archive.events.filter((entry) => entry.type === "dialogue_media_rejected").map((entry) => String(entry.payload.attachmentEventId)));
    const existing = archive.events.find((entry) => entry.type === "dialogue_media_attached" && entry.payload.sourceEventId === source.id && !rejectedIds.has(entry.id));
    if (existing) throw { code: "MEDIA_ALREADY_ATTACHED" };
    let mediaUrl;
    try { mediaUrl = new URL(clean(action.payload.mediaUrl, 800)); } catch { throw { code: "INVALID_ACTION" }; }
    if (mediaUrl.protocol !== "https:" || mediaUrl.hostname !== "cdn.aiwaves.tech") throw { code: "INVALID_ACTION" };
    events = [makeEvent(archive, action, "dialogue_media_attached", source.requestId, null, { sourceEventId: source.id, mediaUrl: mediaUrl.href })];
  } else if (action.type === "reject_dialogue_media") {
    const attachment = archive.events.find((entry) => entry.id === action.payload.attachmentEventId && entry.type === "dialogue_media_attached");
    if (!attachment) throw { code: "ENTITY_NOT_FOUND" };
    if (attachment.actor.id !== action.actor.id) throw { code: "AUTH_REQUIRED" };
    const alreadyRejected = archive.events.some((entry) => entry.type === "dialogue_media_rejected" && entry.payload.attachmentEventId === attachment.id);
    if (alreadyRejected) throw { code: "MEDIA_ALREADY_REJECTED" };
    const reasons = new Set(["pseudotext", "identity", "location", "object_count", "other"]);
    if (!reasons.has(action.payload.reason)) throw { code: "INVALID_ACTION" };
    events = [makeEvent(archive, action, "dialogue_media_rejected", attachment.requestId, null, {
      sourceEventId: attachment.payload.sourceEventId,
      attachmentEventId: attachment.id,
      reason: action.payload.reason,
    })];
  } else {
    throw { code: "INVALID_ACTION" };
  }

  const next = {
    ...archive,
    version: archive.version + 1,
    cursor: archive.cursor + events.length,
    requests,
    items,
    events: [...archive.events, ...events],
    processedActions: [...archive.processedActions, { id: action.actionId, eventIds: events.map((entry) => entry.id) }].slice(-800),
  };
  return { archive: next, events, receipts };
}

export class WorldRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS world (world_key TEXT PRIMARY KEY, ruleset_id TEXT NOT NULL, version INTEGER NOT NULL, cursor INTEGER NOT NULL, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS action_result_cache (action_id TEXT PRIMARY KEY, response_json TEXT NOT NULL)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS grant_receipt (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, action_id TEXT NOT NULL, source_entity_id TEXT NOT NULL, operation TEXT NOT NULL, item_json TEXT NOT NULL, created_at INTEGER NOT NULL, acknowledged_at INTEGER)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS report (id TEXT PRIMARY KEY, reporter_user_id TEXT NOT NULL, entity_id TEXT NOT NULL, reason TEXT NOT NULL, created_at INTEGER NOT NULL)");
    this.sql.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_report_identity_entity ON report(reporter_user_id, entity_id)");
  }

  getWorld(worldKey, now, rulesetId = RULESET) {
    const row = [...this.sql.exec("SELECT snapshot_json FROM world WHERE world_key = ?", worldKey)][0];
    if (row) return JSON.parse(row.snapshot_json);
    const archive = initialArchive(now);
    this.sql.exec("INSERT INTO world (world_key, ruleset_id, version, cursor, snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)", worldKey, rulesetId, archive.version, archive.cursor, JSON.stringify(archive), now, now);
    return archive;
  }

  saveCommit(worldKey, action, result, response) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("UPDATE world SET version = ?, cursor = ?, snapshot_json = ?, updated_at = ? WHERE world_key = ?", result.archive.version, result.archive.cursor, JSON.stringify(result.archive), action.createdAt, worldKey);
      for (const receipt of result.receipts) {
        this.sql.exec("INSERT INTO grant_receipt (id, user_id, action_id, source_entity_id, operation, item_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", receipt.id, receipt.userId, receipt.actionId, receipt.sourceEntityId, receipt.operation, JSON.stringify(receipt.item), receipt.createdAt);
      }
      this.sql.exec("INSERT INTO action_result_cache (action_id, response_json) VALUES (?, ?)", action.actionId, JSON.stringify(response));
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();

    if (request.method === "POST" && url.pathname === "/api/world/ensure") {
      const body = await request.json().catch(() => ({}));
      const worldKey = allowedWorldKey(this.env, body.world_key);
      const archive = this.getWorld(worldKey, now, clean(body.ruleset_id, 80) || RULESET);
      if (body.ruleset_id && body.ruleset_id !== archive.rulesetId) return fail("RULESET_MISMATCH", 409);
      return json({ world_id: archive.worldId, version: archive.version, cursor: archive.cursor, server_time: now });
    }

    if (request.method === "GET" && url.pathname === "/api/world/state") {
      const worldKey = allowedWorldKey(this.env, url.searchParams.get("world_key"));
      const after = Math.max(0, Number(url.searchParams.get("after_cursor")) || 0);
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("event_limit")) || 50));
      const archive = this.getWorld(worldKey, now);
      const pending = archive.events.filter((entry) => entry.seq > after);
      return json({ world_id: archive.worldId, version: archive.version, cursor: archive.cursor, server_time: now, snapshot: archive, events: pending.slice(0, limit), has_more_events: pending.length > limit });
    }

    if (request.method === "POST" && url.pathname === "/api/world/action") {
      const body = await request.json().catch(() => ({}));
      if (this.env.LAB_MODE !== "true" && this.env.PUBLIC_BETA !== "true") return fail("AUTH_REQUIRED", 401, { identity_verification_required: true });
      const worldKey = allowedWorldKey(this.env, body.world_key);
      const actorId = clean(body.user_id || body.telegram_id, 100);
      const actionId = clean(body.action_id, 100);
      if (!actorId || actorId === "__alteru_guest__") return fail("AUTH_REQUIRED", 401);
      if (!actionId) return fail("INVALID_ACTION");
      const cached = [...this.sql.exec("SELECT response_json FROM action_result_cache WHERE action_id = ?", actionId)][0];
      if (cached) return json({ ...JSON.parse(cached.response_json), duplicate: true });
      const archive = this.getWorld(worldKey, now);
      if (Number(body.ruleset_version) !== 1) return fail("RULESET_MISMATCH", 409);
      if (Number(body.expected_version) !== archive.version) return fail("VERSION_CONFLICT", 409, { current_version: archive.version, cursor: archive.cursor, retryable: false });
      const action = {
        actionId,
        actor: { id: actorId, name: clean(body.actor_profile?.name, 40) || "Resident", ...(body.actor_profile?.avatar_url ? { avatarUrl: clean(body.actor_profile.avatar_url, 500) } : {}) },
        expectedVersion: archive.version,
        createdAt: now,
        type: clean(body.type, 60),
        payload: body.payload || {},
      };
      let result;
      try { result = applyAction(archive, action); }
      catch (error) {
        const code = error?.code || "INVALID_ACTION";
        const status = code === "AUTH_REQUIRED" ? 401 : ["REQUEST_UNAVAILABLE", "ITEM_UNAVAILABLE", "VERSION_CONFLICT", "MEDIA_ALREADY_ATTACHED", "MEDIA_ALREADY_REJECTED"].includes(code) ? 409 : 400;
        return fail(code, status);
      }
      const response = { accepted: true, duplicate: false, code: "COMMITTED", version: result.archive.version, cursor: result.archive.cursor, server_time: now, committed_events: result.events, grant_receipts: result.receipts, snapshot: result.archive };
      this.saveCommit(worldKey, action, result, response);
      return json(response);
    }

    if (request.method === "GET" && url.pathname === "/api/world/grants") {
      if (this.env.LAB_MODE !== "true" && this.env.PUBLIC_BETA !== "true") return fail("AUTH_REQUIRED", 401, { identity_verification_required: true });
      const userId = clean(url.searchParams.get("user_id"), 100);
      if (!userId) return fail("AUTH_REQUIRED", 401);
      const rows = [...this.sql.exec("SELECT id, source_entity_id, operation, item_json, created_at FROM grant_receipt WHERE user_id = ? AND acknowledged_at IS NULL ORDER BY created_at ASC", userId)];
      return json({ receipts: rows.map((row) => ({ receipt_id: row.id, source_entity_id: row.source_entity_id, operation: row.operation, item: JSON.parse(row.item_json), created_at: row.created_at })) });
    }

    if (request.method === "POST" && url.pathname === "/api/world/grant/ack") {
      const body = await request.json().catch(() => ({}));
      if (this.env.LAB_MODE !== "true" && this.env.PUBLIC_BETA !== "true") return fail("AUTH_REQUIRED", 401, { identity_verification_required: true });
      const receiptId = clean(body.receipt_id, 100);
      const userId = clean(body.user_id || body.telegram_id, 100);
      if (!receiptId || !userId) return fail("AUTH_REQUIRED", 401);
      this.sql.exec("UPDATE grant_receipt SET acknowledged_at = ? WHERE id = ? AND user_id = ?", now, receiptId, userId);
      return json({ ok: true, receipt_id: receiptId });
    }

    if (request.method === "GET" && url.pathname === "/api/world/history") {
      const archive = this.getWorld(allowedWorldKey(this.env, url.searchParams.get("world_key")), now);
      return json({ events: archive.events.slice(-100), cursor: archive.cursor });
    }

    if (request.method === "POST" && url.pathname === "/api/world/report") {
      const body = await request.json().catch(() => ({}));
      const reporter = clean(body.user_id || body.telegram_id, 100);
      const entityId = clean(body.entity_id, 100);
      if (!reporter || !entityId) return fail("INVALID_ACTION");
      const existing = [...this.sql.exec("SELECT id FROM report WHERE reporter_user_id = ? AND entity_id = ?", reporter, entityId)][0];
      if (existing) return json({ ok: true, report_id: existing.id, duplicate: true });
      const recent = [...this.sql.exec("SELECT COUNT(*) AS n FROM report WHERE reporter_user_id = ? AND created_at > ?", reporter, now - DAY)][0]?.n || 0;
      if (recent >= 20) return fail("RATE_LIMITED", 429);
      const id = crypto.randomUUID();
      this.sql.exec("INSERT INTO report (id, reporter_user_id, entity_id, reason, created_at) VALUES (?, ?, ?, ?, ?)", id, reporter, entityId, clean(body.reason, 240), now);
      return json({ ok: true, report_id: id });
    }

    if (request.method === "POST" && url.pathname === "/api/world/lab/reset" && this.env.LAB_MODE === "true") {
      const body = await request.json().catch(() => ({}));
      const worldKey = allowedWorldKey(this.env, body.world_key);
      const archive = initialArchive(now);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM action_result_cache");
        this.sql.exec("DELETE FROM grant_receipt");
        this.sql.exec("UPDATE world SET version = ?, cursor = ?, snapshot_json = ?, updated_at = ? WHERE world_key = ?", archive.version, archive.cursor, JSON.stringify(archive), now, worldKey);
      });
      return json({ ok: true, snapshot: archive });
    }

    return new Response("Not Found", { status: 404 });
  }
}

export async function handleApi(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/health") {
    const identityMode = env.LAB_MODE === "true" ? "unverified-staging" : env.PUBLIC_BETA === "true" ? "unverified-production-beta" : "writes-disabled-until-platform-verifier";
    return json({ ok: true, service: "neighbor-help", storage: "durable-object-sqlite", lab_mode: env.LAB_MODE === "true", public_beta: env.PUBLIC_BETA === "true", identity_mode: identityMode });
  }
  if (!url.pathname.startsWith("/api/world/")) return new Response("Not Found", { status: 404 });
  let worldKey = allowedWorldKey(env, url.searchParams.get("world_key"));
  if (request.method === "POST") {
    const body = await request.clone().json().catch(() => ({}));
    worldKey = allowedWorldKey(env, body.world_key || worldKey);
  }
  const id = env.WORLD.idFromName(worldKey);
  return env.WORLD.get(id).fetch(request);
}
