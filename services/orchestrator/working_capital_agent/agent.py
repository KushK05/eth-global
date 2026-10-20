"""An ADK agent that prepares, but never executes, ATS issuance."""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

from google.adk.agents import Agent
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[3] / ".env")


def prepare_ats_issuance(
    receivable_id: str,
    issuer_account_id: str,
    buyer_account_id: str,
    face_value_usdc: str,
    due_date: str,
    isin: str,
) -> dict[str, object]:
    """Validate a buyer-confirmed receivable and return a wallet-review payload.

    This tool deliberately does not connect a wallet, sign a Hedera transaction,
    or move funds. The issuer must review and submit the ATS transaction.
    """

    required = {
        "receivable_id": receivable_id,
        "issuer_account_id": issuer_account_id,
        "buyer_account_id": buyer_account_id,
        "face_value_usdc": face_value_usdc,
        "due_date": due_date,
        "isin": isin,
    }
    missing = [name for name, value in required.items() if not value or not value.strip()]
    if missing:
        return {"ok": False, "error": f"Missing required issuance fields: {', '.join(missing)}"}

    try:
        value = float(face_value_usdc)
        maturity = date.fromisoformat(due_date)
    except ValueError:
        return {"ok": False, "error": "face_value_usdc must be numeric and due_date must be YYYY-MM-DD."}
    if value <= 0:
        return {"ok": False, "error": "face_value_usdc must be positive."}
    if maturity <= date.today():
        return {"ok": False, "error": "due_date must be in the future."}

    return {
        "ok": True,
        "action": "ISSUER_WALLET_REVIEW_REQUIRED",
        "network": "hedera:testnet",
        "asset_type": "single-unit receivable bond",
        "receivable": {
            "id": receivable_id,
            "issuer": issuer_account_id,
            "buyer": buyer_account_id,
            "face_value_usdc": face_value_usdc,
            "due_date": due_date,
            "isin": isin,
        },
        "next_step": "Connect the issuer wallet and submit the ATS Bond.create request after reviewing its transaction.",
    }


root_agent = Agent(
    name="working_capital_coordinator",
    model=os.getenv("GOOGLE_ADK_MODEL", "gemini-2.5-flash"),
    instruction=(
        "You coordinate the working-capital prototype. You may prepare a Hedera ATS "
        "receivable issuance payload only after buyer confirmation. You must never claim "
        "that a token exists without a Hedera transaction ID, and you must never execute, "
        "sign, or request an autonomous ATS issuance. Use prepare_ats_issuance for validation."
    ),
    tools=[prepare_ats_issuance],
)
