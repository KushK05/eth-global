from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[3] / ".env")


def _configured(*names: str) -> bool:
    return all(os.environ.get(name, "").strip() for name in names)


def integration_status() -> dict[str, Any]:
    payment_mode = os.environ.get("HEDERA_PAYMENT_MODE", "simulated")
    x402_ready = payment_mode == "live" and _configured(
        "HEDERA_AGENT_ACCOUNT_ID",
        "HEDERA_AGENT_PRIVATE_KEY",
        "HEDERA_RESEARCH_MERCHANT_ID",
        "HEDERA_AUDIT_OPERATOR_ID",
        "HEDERA_AUDIT_OPERATOR_KEY",
        "HEDERA_AUDIT_TOPIC_ID",
        "HEDERA_GATEWAY_API_TOKEN",
    )
    return {
        "x402": {
            "label": "Hedera x402",
            "mode": payment_mode,
            "ready": x402_ready,
            "detail": "Live testnet payment can be submitted" if x402_ready else "Simulated until payer, merchant, audit, and gateway settings are configured",
        },
        "ats": {
            "label": "Hedera ATS",
            "mode": "wallet-required",
            "ready": _configured("HEDERA_ATS_CONFIG_ID", "HEDERA_ATS_CONFIG_VERSION", "HEDERA_ATS_ISSUER_ACCOUNT_ID"),
            "detail": "Issuer wallet review is ready" if _configured("HEDERA_ATS_CONFIG_ID", "HEDERA_ATS_CONFIG_VERSION", "HEDERA_ATS_ISSUER_ACCOUNT_ID") else "Issuer config and wallet connection required",
        },
        "aqua": {
            "label": "1inch Aqua",
            "mode": "arc-5042",
            "ready": _configured("AQUA_RPC_URL", "AQUA_USDC_ADDRESS"),
            "detail": "Arc quote and ship transaction can be prepared" if _configured("AQUA_RPC_URL", "AQUA_USDC_ADDRESS") else "Arc RPC and USDC address required",
        },
        "adk": {
            "label": "Google ADK",
            "mode": "bounded",
            "ready": _configured("GOOGLE_API_KEY"),
            "detail": "Coordinator can run with Gemini" if _configured("GOOGLE_API_KEY") else "Google API key required to run the coordinator",
        },
    }
