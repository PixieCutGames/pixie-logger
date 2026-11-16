import { Hono } from "hono";
import { CONTRACT_VERSION, errorResponse } from "@pixie-logger/shared";
import { ingest } from "./routes/ingest";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/message", (c) => {
  return c.text("Hello Hono!");
});

app.get("/v1/health", (c) => {
  return c.json({ ok: true, contract: CONTRACT_VERSION });
});

app.route("/v1/logs", ingest);

// Never expose err.message or the stack; the real error goes to the Worker log only.
app.onError((err, c) => {
  console.error("Unhandled error", err);
  return c.json(errorResponse("internal_error", "Internal error"), 500);
});

export default app;
