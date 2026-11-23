import { Hono } from "hono";
import { CONTRACT_VERSION, errorResponse } from "@pixie-logger/shared";
import { requireAccess } from "./lib/access";
import { ingest } from "./routes/ingest";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/message", (c) => {
  return c.text("Hello Hono!");
});

app.get("/v1/health", (c) => {
  return c.json({ ok: true, contract: CONTRACT_VERSION });
});

app.route("/v1/logs", ingest);

// Every /v1/admin/* route requires Cloudflare Access (Phase 4). Routes are added in Task 2.
app.use("/v1/admin/*", requireAccess());

// Never expose err.message or the stack; the real error goes to the Worker log only.
app.onError((err, c) => {
  console.error("Unhandled error", err);
  return c.json(errorResponse("internal_error", "Internal error"), 500);
});

export default app;
