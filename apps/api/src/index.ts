import { Hono } from "hono";
import { CONTRACT_VERSION } from "@pixie-logger/shared";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.get("/message", (c) => {
  return c.text("Hello Hono!");
});

app.get("/v1/health", (c) => {
  return c.json({ ok: true, contract: CONTRACT_VERSION });
});

export default app;
