from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal, ROUND_DOWN
import json
import os
from threading import RLock
from typing import Any
from uuid import uuid4

from sqlalchemy import create_engine, text

USD = Decimal("0.01")


def money(value: Decimal | str | int | float) -> str:
    return str(Decimal(str(value)).quantize(USD, rounding=ROUND_DOWN))


def lender_fee(principal: Decimal, apr_bps: int, days: int = 30) -> Decimal:
    return (principal * Decimal(apr_bps) / Decimal(10_000) * Decimal(days) / Decimal(365)).quantize(USD, rounding=ROUND_DOWN)


def initial_state() -> dict[str, Any]:
    return {
        "id": "retailco-net30",
        "invoice": {
            "buyer": "RetailCo",
            "operator": "Northstar Agents",
            "faceValue": "10000.00",
            "currency": "USDC",
            "terms": "Net 30",
            "advanceRateBps": 7500,
            "status": "BUYER_CONFIRMED",
            "receivableId": "0x8c2f…71ab",
            "tokenId": "Pending ATS issuance",
            "dueDate": "2026-11-19",
            "verification": "Buyer signed confirmation",
        },
        "facility": {
            "status": "READY_TO_FUND",
            "borrowingBase": "7500.00",
            "funded": "0.00",
            "outstanding": "0.00",
            "spent": "0.00",
            "reserved": "0.00",
            "remaining": "0.00",
            "feeTotal": "0.00",
            "operatorRemainder": "0.00",
            "repaymentAmount": "10000.00",
            "chain": "Arc testnet · local demo mode",
        },
        "offers": [
            {"lender": "Alice", "aprBps": 700, "apr": "7.00%", "available": "4000.00", "selected": False, "score": "A"},
            {"lender": "Bob", "aprBps": 850, "apr": "8.50%", "available": "2000.00", "selected": False, "score": "A-"},
            {"lender": "Charlie", "aprBps": 1300, "apr": "13.00%", "available": "5000.00", "selected": False, "score": "B"},
        ],
        "allocations": [],
        "agents": [
            {"name": "Research", "role": "Market intelligence", "identity": "hcs14:agent:research", "allocation": "1000.00", "spent": "0.00", "reserved": "0.00", "limit": "0.50", "merchant": "Briefly Data", "color": "blue"},
            {"name": "Compute", "role": "Model inference", "identity": "hcs14:agent:compute", "allocation": "3000.00", "spent": "0.00", "reserved": "0.00", "limit": "250.00", "merchant": "Northstar Cloud", "color": "violet"},
            {"name": "Data", "role": "Data acquisition", "identity": "hcs14:agent:data", "allocation": "1000.00", "spent": "0.00", "reserved": "0.00", "limit": "25.00", "merchant": "Signal Index", "color": "green"},
            {"name": "Reserve", "role": "Unallocated buffer", "identity": "facility:reserve", "allocation": "1000.00", "spent": "0.00", "reserved": "0.00", "limit": "-", "merchant": "Available to lead agent", "color": "amber"},
        ],
        "events": [
            {"id": str(uuid4()), "title": "Buyer confirmed invoice", "detail": "RetailCo approved invoice INV-2048 · $10,000.00", "time": "Just now", "status": "success", "chain": "Buyer signature"},
            {"id": str(uuid4()), "title": "Receivable registered", "detail": "Canonical ID assigned · awaiting ATS tokenization", "time": "Just now", "status": "pending", "chain": "Hedera · testnet"},
        ],
        "spends": [],
        "stage": "verify",
        "mode": "simulated",
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


class DemoStore:
    def __init__(self) -> None:
        self._lock = RLock()
        database_url = os.environ.get("DATABASE_URL", "sqlite:///./working_capital.db")
        connect_args = {"check_same_thread": False} if database_url.startswith("sqlite:") else {}
        self._engine = create_engine(database_url, connect_args=connect_args, pool_pre_ping=True)
        self._initialize()

    def _initialize(self) -> None:
        with self._engine.begin() as connection:
            connection.execute(text("CREATE TABLE IF NOT EXISTS demo_state (id VARCHAR(255) PRIMARY KEY, payload TEXT NOT NULL)"))
            connection.execute(text("CREATE TABLE IF NOT EXISTS idempotency (key VARCHAR(255) PRIMARY KEY, payload TEXT NOT NULL)"))
            row = connection.execute(text("SELECT id FROM demo_state WHERE id = :id"), {"id": "retailco-net30"}).fetchone()
            if row is None:
                connection.execute(text("INSERT INTO demo_state (id, payload) VALUES (:id, :payload)"), {"id": "retailco-net30", "payload": json.dumps(initial_state())})

    def get(self) -> dict[str, Any]:
        with self._lock:
            with self._engine.connect() as connection:
                row = connection.execute(text("SELECT payload FROM demo_state WHERE id = :id"), {"id": "retailco-net30"}).fetchone()
            return json.loads(row[0])

    def idempotent_result(self, key: str | None) -> dict[str, Any] | None:
        if not key:
            return None
        with self._lock:
            with self._engine.connect() as connection:
                row = connection.execute(text("SELECT payload FROM idempotency WHERE key = :key"), {"key": key}).fetchone()
        return json.loads(row[0]) if row else None

    def close(self) -> None:
        self._engine.dispose()

    @staticmethod
    def _require_spend_capacity(state: dict[str, Any], amount: Decimal, agent_name: str | None = None) -> None:
        if agent_name is not None:
            agent = next(item for item in state["agents"] if item["name"] == agent_name)
            agent_remaining = Decimal(agent["allocation"]) - Decimal(agent["spent"]) - Decimal(agent["reserved"])
            if amount > agent_remaining:
                raise ValueError("AGENT_BUDGET_EXCEEDED")
        facility = state["facility"]
        facility_remaining = Decimal(facility["funded"]) - Decimal(facility["spent"]) - Decimal(facility["reserved"])
        if amount > facility_remaining:
            raise ValueError("GLOBAL_CREDIT_LIMIT_EXCEEDED")

    def reset(self) -> dict[str, Any]:
        with self._lock:
            state = initial_state()
            with self._engine.begin() as connection:
                connection.execute(text("UPDATE demo_state SET payload = :payload WHERE id = :id"), {"payload": json.dumps(state), "id": "retailco-net30"})
                connection.execute(text("DELETE FROM idempotency"))
            return state

    def act(self, action: str, idempotency_key: str | None = None, payment_receipt: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            with self._engine.connect() as connection:
                if idempotency_key:
                    cached = connection.execute(text("SELECT payload FROM idempotency WHERE key = :key"), {"key": idempotency_key}).fetchone()
                    if cached:
                        return json.loads(cached[0])
                row = connection.execute(text("SELECT payload FROM demo_state WHERE id = :id"), {"id": "retailco-net30"}).fetchone()
                state = json.loads(row[0])
            message: dict[str, Any]
            if action == "confirm_invoice":
                if state["stage"] != "verify":
                    raise ValueError("Invoice is already confirmed.")
                state["invoice"]["status"] = "TOKENIZED"
                state["invoice"]["tokenId"] = "Simulated ATS token (unverified)"
                state["stage"] = "fund"
                message = {"title": "Tokenization simulated", "detail": "Configure the issuer ATS wallet to submit and verify the receivable token", "status": "success", "chain": "Local demo"}
            elif action == "match_lenders":
                if state["stage"] not in ("fund", "verify"):
                    raise ValueError("Facility is already active or repaid.")
                available = min(Decimal("6000.00"), Decimal(state["facility"]["borrowingBase"]))
                selected = []
                for offer in sorted(state["offers"], key=lambda item: item["aprBps"]):
                    amount = min(available, Decimal(offer["available"]))
                    offer["selected"] = amount > 0
                    if amount > 0:
                        fee = lender_fee(amount, offer["aprBps"])
                        selected.append({"lender": offer["lender"], "principal": money(amount), "aprBps": offer["aprBps"], "fee": money(fee), "repayment": money(amount + fee)})
                        available -= amount
                    if available <= 0:
                        break
                if available > 0:
                    raise ValueError("Eligible lender offers do not cover the borrowing request.")
                borrowed = sum((Decimal(item["principal"]) for item in selected), Decimal("0"))
                fees = sum((Decimal(item["fee"]) for item in selected), Decimal("0"))
                state["allocations"] = selected
                state["facility"].update({"status": "ACTIVE", "funded": money(borrowed), "outstanding": money(borrowed), "remaining": money(borrowed), "feeTotal": money(fees)})
                for agent in state["agents"]:
                    if agent["name"] == "Reserve":
                        continue
                    agent["allocation"] = money(Decimal(agent["allocation"]))
                state["stage"] = "spend"
                message = {"title": "Facility funded", "detail": f"${money(borrowed)} matched across {len(selected)} eligible lenders · Charlie was not needed", "status": "success", "chain": "Arc testnet · local demo"}
            elif action == "research_payment":
                if state["stage"] != "spend":
                    raise ValueError("Fund the facility before agents can spend.")
                agent = next(item for item in state["agents"] if item["name"] == "Research")
                amount = Decimal("0.25")
                self._require_spend_capacity(state, amount, agent["name"])
                if payment_receipt is None:
                    tx_id = "0.0.7429812@1760905800.000000321"
                    network = "Hedera · testnet (simulated)"
                else:
                    tx_id = payment_receipt.get("transactionId")
                    if not isinstance(tx_id, str) or not tx_id or payment_receipt.get("finalized") is not True:
                        raise ValueError("UNVERIFIED_X402_RECEIPT")
                    network = "Hedera · testnet"
                spend = {"id": str(uuid4()), "agent": "Research", "merchant": "Briefly Data", "amount": money(amount), "status": "SETTLED", "txId": tx_id, "network": network, "createdAt": datetime.now(timezone.utc).isoformat()}
                state["spends"].insert(0, spend)
                agent["spent"] = money(Decimal(agent["spent"]) + amount)
                state["facility"]["spent"] = money(Decimal(state["facility"]["spent"]) + amount)
                state["facility"]["remaining"] = money(Decimal(state["facility"]["funded"]) - Decimal(state["facility"]["spent"]))
                message = {"title": "x402 payment settled", "detail": "$0.25 paid to Briefly Data · HCS audit record added", "status": "success", "chain": spend["network"], "txId": spend["txId"]}
            elif action == "compute_overspend":
                if state["stage"] != "spend":
                    raise ValueError("Fund the facility before evaluating spend requests.")
                try:
                    self._require_spend_capacity(state, Decimal("5500.00"), "Compute")
                except ValueError as exc:
                    if str(exc) != "AGENT_BUDGET_EXCEEDED":
                        raise
                else:
                    raise RuntimeError("The configured Compute request should exceed its agent allocation.")
                message = {"title": "Payment rejected by policy", "detail": "AGENT_BUDGET_EXCEEDED · Compute requested $5,500.00 against its $3,000.00 allocation", "status": "danger", "chain": "Arc policy check · simulated"}
            elif action == "global_overspend":
                if state["stage"] != "spend":
                    raise ValueError("Fund the facility before evaluating spend requests.")
                try:
                    self._require_spend_capacity(state, Decimal("6000.00"))
                except ValueError as exc:
                    if str(exc) != "GLOBAL_CREDIT_LIMIT_EXCEEDED":
                        raise
                else:
                    raise RuntimeError("The configured aggregate request should exceed remaining facility credit.")
                message = {"title": "Payment rejected by policy", "detail": "GLOBAL_CREDIT_LIMIT_EXCEEDED · request exceeds the facility's remaining credit", "status": "danger", "chain": "Arc policy check · simulated"}
            elif action == "repay":
                if state["stage"] != "spend":
                    raise ValueError("An active facility is required before repayment.")
                face = Decimal(state["invoice"]["faceValue"])
                lender_total = sum((Decimal(item["repayment"]) for item in state["allocations"]), Decimal("0"))
                remainder = max(Decimal("0"), face - lender_total)
                state["facility"].update({"status": "REPAID", "outstanding": "0.00", "remaining": "0.00", "repaymentAmount": money(face), "operatorRemainder": money(remainder)})
                state["invoice"]["status"] = "REPAID"
                state["stage"] = "repay"
                message = {"title": "Repayment complete", "detail": f"${money(lender_total)} paid to lenders · ${money(remainder)} returned to operator", "status": "success", "chain": "Arc repayment router · simulated"}
            else:
                raise ValueError("Unknown demo action.")

            event = {"id": str(uuid4()), **message, "time": "Just now"}
            state["events"].insert(0, event)
            state["updatedAt"] = datetime.now(timezone.utc).isoformat()
            result = {"state": deepcopy(state), "event": event}
            with self._engine.begin() as connection:
                connection.execute(text("UPDATE demo_state SET payload = :payload WHERE id = :id"), {"payload": json.dumps(state), "id": "retailco-net30"})
                if idempotency_key:
                    connection.execute(text("DELETE FROM idempotency WHERE key = :key"), {"key": idempotency_key})
                    connection.execute(text("INSERT INTO idempotency (key, payload) VALUES (:key, :payload)"), {"key": idempotency_key, "payload": json.dumps(result)})
            return result


store = DemoStore()
