#!/usr/bin/env node
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Database = require("better-sqlite3");
const { createQueue } = require("./queue");
const { createTaskStore } = require("./tasks");

const HOST = process.env.PI_BUS_HOST || "127.0.0.1";
const PORT = Number(process.env.PI_BUS_PORT || 43871);
const DATA_DIR = process.env.PI_BUS_DATA_DIR || path.join(os.homedir(), ".pi", "bus");
const DB_PATH = process.env.PI_BUS_DB || path.join(DATA_DIR, "bus.sqlite");
const PID_PATH = process.env.PI_BUS_PID || path.join(DATA_DIR, "bus.pid");
const ONLINE_TTL_MS = Number(process.env.PI_BUS_ONLINE_TTL_MS || 120000);

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

migrate(db);
const queue = createQueue(db);
const taskStore = createTaskStore(db);
const subscribers = new Map();

const upsertAgent = db.prepare(`
  INSERT INTO agents (name, description, last_seen_at)
  VALUES (@name, @description, @last_seen_at)
  ON CONFLICT(name) DO UPDATE SET
    description = excluded.description,
    last_seen_at = excluded.last_seen_at
`);
const listAgents = db.prepare(`SELECT name, description, last_seen_at FROM agents ORDER BY name`);
const getAgent = db.prepare(`SELECT name FROM agents WHERE name = ?`);
const touchAgent = db.prepare(`UPDATE agents SET last_seen_at = ? WHERE name = ?`);
const bindSessionAgent = db.prepare(`
  INSERT INTO session_agents (session_id, agent_name, updated_at)
  VALUES (@session_id, @agent_name, @updated_at)
  ON CONFLICT(session_id) DO UPDATE SET
    agent_name = excluded.agent_name,
    updated_at = excluded.updated_at
`);
const getSessionAgent = db.prepare(`
  SELECT a.name, a.description, a.last_seen_at
  FROM session_agents s
  JOIN agents a ON a.name = s.agent_name
  WHERE s.session_id = ?
`);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { ok: true, db: DB_PATH });
    }

    if (req.method === "POST" && url.pathname === "/agents/register") {
      const body = await readJson(req);
      assertName(body.name, "name");
      const row = { name: body.name.trim(), description: String(body.description || ""), last_seen_at: new Date().toISOString() };
      upsertAgent.run(row);
      if (body.sessionId) bindSession(row.name, body.sessionId);
      return json(res, 200, agentView(row));
    }

    if (req.method === "POST" && url.pathname === "/sessions/bind") {
      const body = await readJson(req);
      assertSessionId(body.sessionId);
      assertName(body.agentName, "agentName");
      if (!getAgent.get(body.agentName.trim())) throw new Error(`agent is not registered: ${body.agentName}`);
      bindSession(body.agentName.trim(), body.sessionId.trim());
      return json(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/sessions/identity") {
      const sessionId = url.searchParams.get("sessionId") || "";
      assertSessionId(sessionId);
      const row = getSessionAgent.get(sessionId.trim());
      return json(res, 200, { identity: row ? { name: row.name, description: row.description || "" } : undefined });
    }

    if (req.method === "GET" && url.pathname === "/agents") {
      const exclude = url.searchParams.get("exclude");
      const rows = listAgents.all().filter((agent) => agent.name !== exclude);
      return json(res, 200, rows.map(agentView));
    }

    if (req.method === "GET" && url.pathname === "/messages/events") {
      const agent = (url.searchParams.get("agent") || "").trim();
      assertName(agent, "agent");
      if (!getAgent.get(agent)) throw new Error(`agent is not registered: ${agent}`);
      return subscribe(agent, req, res);
    }

    if (req.method === "POST" && url.pathname === "/messages/send") {
      const body = await readJson(req);
      assertName(body.from, "from");
      if (!Array.isArray(body.to) || body.to.length === 0) throw new Error("to must be a non-empty agent name list");
      for (const dest of body.to) assertName(dest, "destination agent name");
      assertMessage(body.message);
      const from = body.from.trim();
      const dests = body.to.map((x) => x.trim());
      if (!getAgent.get(from)) throw new Error(`sender is not registered: ${from}`);
      for (const dest of dests) {
        if (!getAgent.get(dest)) throw new Error(`destination is not registered: ${dest}`);
      }
      const result = queue.send(from, dests, body.message);
      for (const dest of dests) notifyPending(dest);
      return json(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/messages/recv") {
      const body = await readJson(req);
      assertName(body.agent, "agent");
      const agent = body.agent.trim();
      const result = queue.recv(agent, body.limit || 10);
      notifyPending(agent);
      return json(res, 200, result);
    }

    // Compatibility endpoint. It uses a callback subscription internally rather than DB polling.
    if (req.method === "POST" && url.pathname === "/messages/wait") {
      const body = await readJson(req);
      assertName(body.agent, "agent");
      const agent = body.agent.trim();
      if (!getAgent.get(agent)) throw new Error(`agent is not registered: ${agent}`);
      const count = queue.count(agent);
      if (count > 0) return json(res, 200, { available: true, count });
      const timeoutMs = Math.max(1000, Math.floor(body.timeoutMs || 30000));
      return waitOnce(agent, timeoutMs, req, res);
    }

    if (req.method === "POST" && url.pathname === "/tasks/publish") {
      const body = await readJson(req);
      assertName(body.publisher, "publisher");
      const publisher = body.publisher.trim();
      if (!getAgent.get(publisher)) throw new Error(`publisher is not registered: ${publisher}`);
      if (typeof body.background !== "string" || !body.background.trim()) throw new Error("background must be a non-empty string");
      if (!body.assignments || typeof body.assignments !== "object" || Array.isArray(body.assignments)) {
        throw new Error("assignments must be an object mapping agent name to assignment spec");
      }
      const assignments = {};
      for (const [name, spec] of Object.entries(body.assignments)) {
        assertName(name, "assignment agent name");
        if (typeof spec !== "string" || !spec.trim()) throw new Error(`assignment spec for '${name}' must be a non-empty string`);
        assignments[name.trim()] = spec;
      }
      const timeoutMinutes = Number(body.timeoutMinutes || 0);
      if (!Number.isFinite(timeoutMinutes) || timeoutMinutes < 0) throw new Error("timeoutMinutes must be a non-negative number");
      const result = taskStore.publish(publisher, body.background.trim(), assignments, Math.floor(timeoutMinutes));
      const dests = Object.keys(assignments).filter((name) => name !== publisher);
      if (dests.length > 0) {
        taskDeliverSystem(`[system] New task #${result.taskId} published for you. Call get_task to view your assignment.`, dests);
      }
      return json(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/tasks/current") {
      const agent = (url.searchParams.get("agent") || "").trim();
      assertName(agent, "agent");
      const row = taskStore.currentForAgent.get(agent);
      if (!row) return json(res, 200, { task: null });
      return json(res, 200, {
        task: {
          id: row.id,
          publisher: row.publisher,
          background: row.background,
          status: row.status,
          createdAt: row.created_at,
          timeoutAt: row.timeout_at,
        },
        assignment: { spec: row.spec, status: row.assignment_status },
      });
    }

    if (req.method === "POST" && url.pathname === "/tasks/complete") {
      const body = await readJson(req);
      assertName(body.agent, "agent");
      if (body.result !== undefined && typeof body.result !== "string") throw new Error("result must be a string");
      const result = taskStore.complete(body.agent.trim(), body.result);
      if (result.completed && result.taskCompleted) {
        taskDeliverSystem(`[system] Task #${result.taskId} is complete. All assignments are done.`, [result.publisher]);
      }
      return json(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/tasks/kill") {
      const body = await readJson(req);
      const taskId = Number(body.taskId);
      if (!Number.isInteger(taskId) || taskId <= 0) throw new Error("taskId must be a positive integer");
      const result = taskStore.kill(taskId);
      if (result.killed) {
        taskDeliverSystem(`[system] Task #${taskId} was force-marked as over. You are released from it.`, result.assignees);
      }
      return json(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/tasks/overview") {
      return json(res, 200, taskStore.overview());
    }

    return json(res, 404, { error: "not found" });
  } catch (error) {
    return json(res, 400, { error: error.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  fs.writeFileSync(PID_PATH, String(process.pid));
  console.log(`pi bus service listening on http://${HOST}:${PORT}`);
  console.log(`sqlite: ${DB_PATH}`);
});

// Periodic timeout sweep: expire overdue active tasks and release their agents.
const TASK_SWEEP_MS = 60000;
setInterval(() => {
  try {
    for (const swept of taskStore.timeoutSweep()) {
      taskDeliverSystem(
        `[system] Task #${swept.taskId} timed out and was marked failed. You are released from it.`,
        swept.assignees,
      );
    }
  } catch (error) {
    console.error(`task sweep failed: ${error.message || error}`);
  }
}, TASK_SWEEP_MS).unref();

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
function shutdown() {
  try { fs.rmSync(PID_PATH, { force: true }); } catch {}
  for (const set of subscribers.values()) {
    for (const res of set) {
      try { if (typeof res.end === "function") res.end(); } catch {}
    }
  }
  try { db.close(); } catch {}
  process.exit(0);
}

function subscribe(agent, req, res) {
  touch(agent);

  let set = subscribers.get(agent);
  if (!set) {
    set = new Set();
    subscribers.set(agent, set);
  }
  set.add(res);

  const cleanup = () => {
    clearInterval(keepAlive);
    set.delete(res);
    if (set.size === 0) subscribers.delete(agent);
  };

  const keepAlive = setInterval(() => {
    touch(agent);
    try { res.write(": keepalive\n\n"); } catch { cleanup(); }
  }, Math.max(1000, Math.floor(ONLINE_TTL_MS / 2)));

  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on?.("close", cleanup);
  res.on?.("error", cleanup);

  try {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(": connected\n\n");
  } catch {
    cleanup();
    return;
  }

  const count = queue.count(agent);
  if (count > 0) sendEvent(agent, res, { type: "pending", agent, count });
}

function taskDeliverSystem(content, dests) {
  queue.send("system", dests, { subject: "task", content, attachment: [] });
  for (const dest of dests) notifyPending(dest);
}

function notifyPending(agent) {  const count = queue.count(agent);
  const set = subscribers.get(agent);
  if (!set) return;
  for (const res of [...set]) sendEvent(agent, res, { type: "pending", agent, count });
}

function sendEvent(agent, res, event) {
  try {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  } catch {
    const set = subscribers.get(agent);
    set?.delete(res);
    if (set?.size === 0) subscribers.delete(agent);
  }
}

function waitOnce(agent, timeoutMs, req, res) {
  let done = false;
  const complete = (body) => {
    if (done) return;
    done = true;
    cleanup();
    try { json(res, 200, body); } catch {}
  };

  const timer = setTimeout(() => {
    complete({ available: false, count: 0 });
  }, timeoutMs);

  const fakeRes = {
    write(chunk) {
      const line = String(chunk).split("\n").find((x) => x.startsWith("data:"));
      if (!line) return;
      try {
        const event = JSON.parse(line.slice(5));
        complete({ available: event.count > 0, count: event.count });
      } catch {}
    },
    end() {
      cleanup();
    },
  };

  let set = subscribers.get(agent);
  if (!set) {
    set = new Set();
    subscribers.set(agent, set);
  }
  set.add(fakeRes);

  req.on?.("close", cleanup);
  req.on?.("error", cleanup);
  res.on?.("close", cleanup);
  res.on?.("error", cleanup);

  function cleanup() {
    clearTimeout(timer);
    set.delete(fakeRes);
    if (set.size === 0) subscribers.delete(agent);
  }
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_agents (
      session_id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(agent_name) REFERENCES agents(name)
    );
    CREATE INDEX IF NOT EXISTS idx_session_agents_agent ON session_agents(agent_name);
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      dest TEXT NOT NULL,
      subject TEXT NOT NULL CHECK(subject IN ('task', 'question', 'reply')),
      content TEXT NOT NULL,
      attachment_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_dest_pending ON messages(dest, delivered_at, id);
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publisher TEXT NOT NULL,
      background TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'done', 'killed', 'failed')),
      created_at TEXT NOT NULL,
      archived_at TEXT,
      timeout_at TEXT
    );
    CREATE TABLE IF NOT EXISTS task_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      spec TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'done')),
      result TEXT,
      done_at TEXT,
      FOREIGN KEY(task_id) REFERENCES tasks(id),
      FOREIGN KEY(agent_name) REFERENCES agents(name)
    );
    CREATE INDEX IF NOT EXISTS idx_task_assignments_agent ON task_assignments(agent_name, status);
  `);
}

function agentView(row) {
  const lastSeen = Date.parse(row.last_seen_at || 0);
  return {
    name: row.name,
    description: row.description || "",
    online: Number.isFinite(lastSeen) && Date.now() - lastSeen <= ONLINE_TTL_MS,
    lastSeenAt: row.last_seen_at,
  };
}

function touch(agentName) {
  touchAgent.run(new Date().toISOString(), agentName);
}

function bindSession(agentName, sessionId) {
  assertSessionId(sessionId);
  bindSessionAgent.run({
    session_id: sessionId.trim(),
    agent_name: agentName.trim(),
    updated_at: new Date().toISOString(),
  });
}

function assertName(name, field) {
  if (typeof name !== "string" || !name.trim()) throw new Error(`${field} must be a non-empty string`);
  if (!/^[A-Za-z0-9_.-]+$/.test(name.trim())) throw new Error(`${field} may only contain letters, numbers, underscore, dot, and dash`);
}

function assertSessionId(sessionId) {
  if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("sessionId must be a non-empty string");
}

function assertMessage(message) {
  if (!message || typeof message !== "object") throw new Error("message must be an object");
  if (!["task", "question", "reply"].includes(message.subject)) throw new Error("message.subject must be task, question, or reply");
  if (typeof message.content !== "string") throw new Error("message.content must be a string");
  if (!Array.isArray(message.attachment)) throw new Error("message.attachment must be a file path list");
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 10_000_000) reject(new Error("request body too large")); });
    req.on("end", () => resolve(data ? JSON.parse(data) : {}));
    req.on("error", reject);
  });
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
