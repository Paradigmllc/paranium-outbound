// server.js — HTTP wrapper for n8n integration
// POST /run { limit?: number, targetId?: string, secret: string } → returns batch result
// GET  /status                                                    → returns targets summary
// GET  /healthz                                                   → liveness

const http = require("http");
const fs = require("fs");
const path = require("path");
const { run } = require("./runner");

const PORT = process.env.PORT || 8090;
const SHARED_SECRET = process.env.OUTBOUND_SHARED_SECRET || "change-me";

const TARGETS_FILE = path.join(__dirname, "targets.json");

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(body));
  });
}

function jsonResp(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/healthz") {
      return jsonResp(res, 200, { ok: true, ts: new Date().toISOString() });
    }
    if (req.url === "/status" && req.method === "GET") {
      const data = JSON.parse(fs.readFileSync(TARGETS_FILE, "utf8"));
      const summary = data.targets.reduce(
        (acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1;
          return acc;
        },
        {}
      );
      return jsonResp(res, 200, { ok: true, summary, total: data.targets.length });
    }
    if (req.url === "/run" && req.method === "POST") {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body || "{}");
      } catch {
        return jsonResp(res, 400, { ok: false, error: "invalid_json" });
      }
      if (parsed.secret !== SHARED_SECRET) {
        return jsonResp(res, 401, { ok: false, error: "unauthorized" });
      }
      const result = await run({
        limit: parsed.limit || 5,
        targetId: parsed.targetId || null,
      });
      return jsonResp(res, 200, { ok: true, ...result });
    }
    return jsonResp(res, 404, { ok: false, error: "not_found" });
  } catch (e) {
    return jsonResp(res, 500, { ok: false, error: String(e?.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`paranium-outbound-worker listening on :${PORT}`);
});
