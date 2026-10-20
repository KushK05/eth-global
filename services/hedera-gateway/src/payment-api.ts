import express from "express";
import { createHederaIntegration, loadHederaConfig, RESEARCH_PAYMENT_MINOR, type ChainReceipt } from "./index.js";

const config = loadHederaConfig();
const apiToken = process.env.HEDERA_GATEWAY_API_TOKEN?.trim();
const port = Number(process.env.HEDERA_GATEWAY_PORT ?? "4022");
if (!apiToken) throw new Error("Missing required Hedera configuration: HEDERA_GATEWAY_API_TOKEN");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("HEDERA_GATEWAY_PORT must be a valid TCP port.");

const completed = new Map<string, ChainReceipt>();
const pending = new Map<string, Promise<ChainReceipt>>();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb", type: "application/json" }));

function authenticated(request: express.Request): boolean {
  return request.header("authorization") === `Bearer ${apiToken}`;
}

app.get("/health", (_request, response) => response.json({ status: "ok", network: config.network, mode: "live" }));

app.post("/v1/payments/research", async (request, response) => {
  if (!authenticated(request)) {
    response.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }
  const agentId = typeof request.body?.agentId === "string" ? request.body.agentId : "";
  const idempotencyKey = typeof request.body?.idempotencyKey === "string" ? request.body.idempotencyKey : "";
  if (!agentId || !idempotencyKey || idempotencyKey.length > 255) {
    response.status(400).json({ error: "INVALID_PAYMENT_REQUEST" });
    return;
  }

  const existing = completed.get(idempotencyKey);
  if (existing) {
    response.json(existing);
    return;
  }

  let operation = pending.get(idempotencyKey);
  if (!operation) {
    operation = (async () => {
      const integration = createHederaIntegration(config);
      try {
        const receipt = await integration.payX402({
          agentId,
          merchantUrl: config.researchUrl,
          amountMinor: RESEARCH_PAYMENT_MINOR,
          token: "USDC",
          idempotencyKey,
        });
        completed.set(idempotencyKey, receipt);
        return receipt;
      } finally {
        integration.close();
        pending.delete(idempotencyKey);
      }
    })();
    pending.set(idempotencyKey, operation);
  }

  try {
    response.json(await operation);
  } catch (error) {
    response.status(502).json({ error: "X402_PAYMENT_FAILED", detail: error instanceof Error ? error.message : String(error) });
  }
});

const bindHost = process.env.HEDERA_BIND_HOST?.trim() || "127.0.0.1";

app.listen(port, bindHost, () => {
  process.stdout.write(`Hedera x402 payment gateway listening on http://${bindHost}:${port}\n`);
});
