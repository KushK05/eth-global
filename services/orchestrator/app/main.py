from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.responses import StreamingResponse

from .domain import store
from .integrations import integration_status
from .x402 import X402GatewayClient, X402PaymentError

DEFAULT_CORS_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
)


def cors_origins() -> list[str]:
    configured = os.environ.get("CORS_ORIGINS", "")
    if not configured.strip():
        return list(DEFAULT_CORS_ORIGINS)
    return [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]


app = FastAPI(title="Autonomous Working Capital API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Idempotency-Key"],
)


class ActionRequest(BaseModel):
    action: str = Field(min_length=1, max_length=64)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "mode": "simulated"}


@app.get("/api/integrations")
def get_integrations() -> dict[str, Any]:
    return integration_status()


@app.get("/api/demo/{demo_id}")
def get_demo(demo_id: str) -> dict[str, Any]:
    if demo_id != "retailco-net30":
        raise HTTPException(status_code=404, detail="Demo not found")
    return store.get()


@app.post("/api/demo/{demo_id}/reset")
def reset_demo(demo_id: str) -> dict[str, Any]:
    if demo_id != "retailco-net30":
        raise HTTPException(status_code=404, detail="Demo not found")
    return store.reset()


@app.post("/api/demo/{demo_id}/actions")
def run_demo_action(
    demo_id: str,
    request: ActionRequest,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, Any]:
    if demo_id != "retailco-net30":
        raise HTTPException(status_code=404, detail="Demo not found")
    cached = store.idempotent_result(idempotency_key)
    if cached:
        return cached
    try:
        receipt = None
        if request.action == "research_payment":
            receipt = X402GatewayClient.from_environment().pay_research("Research", idempotency_key or "no-idempotency-key")
        return store.act(request.action, idempotency_key, receipt)
    except X402PaymentError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/api/events")
def get_events() -> dict[str, Any]:
    return {"items": store.get()["events"]}


@app.get("/api/events/stream")
async def stream_events(request: Request) -> StreamingResponse:
    async def events():
        sent: set[str] = set()
        while not await request.is_disconnected():
            for event in reversed(store.get()["events"]):
                if event["id"] in sent:
                    continue
                sent.add(event["id"])
                payload = json.dumps(event, separators=(",", ":"))
                yield f"id: {event['id']}\nevent: activity\ndata: {payload}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
