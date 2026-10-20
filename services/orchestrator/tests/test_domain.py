import os
import tempfile
import unittest
from decimal import Decimal
from unittest.mock import patch

from app.domain import DemoStore, lender_fee


class DomainTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tempdir = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"DATABASE_URL": f"sqlite:///{self.tempdir.name}/demo.db"})
        self.env.start()
        self.store = DemoStore()
        self.store.reset()

    def tearDown(self) -> None:
        self.store.close()
        self.env.stop()
        self.tempdir.cleanup()

    def test_lender_fee_uses_principal_apr_and_term(self) -> None:
        self.assertEqual(lender_fee(Decimal("4000"), 700, 30), Decimal("23.01"))
        self.assertEqual(lender_fee(Decimal("2000"), 850, 30), Decimal("13.97"))

    def test_funding_selects_cheapest_offers_to_six_thousand(self) -> None:
        state = self.store.act("match_lenders", "match-test")["state"]
        self.assertEqual([item["lender"] for item in state["allocations"]], ["Alice", "Bob"])
        self.assertEqual(state["facility"]["funded"], "6000.00")
        self.assertFalse(state["offers"][2]["selected"])

    def test_payment_and_repayment_complete_waterfall(self) -> None:
        self.store.act("match_lenders", "match-test-2")
        payment = self.store.act("research_payment", "payment-test")
        self.assertEqual(payment["state"]["facility"]["spent"], "0.25")
        result = self.store.act("repay", "repay-test")
        self.assertEqual(result["state"]["facility"]["outstanding"], "0.00")
        self.assertEqual(result["state"]["facility"]["operatorRemainder"], "3963.02")

    def test_verified_x402_receipt_is_recorded_as_live_testnet_payment(self) -> None:
        self.store.act("match_lenders", "match-live-receipt")
        payment = self.store.act(
            "research_payment",
            "payment-live-receipt",
            {"network": "hedera-testnet", "transactionId": "0.0.1001@1760905800.000000321", "finalized": True},
        )
        self.assertEqual(payment["state"]["spends"][0]["network"], "Hedera · testnet")
        self.assertEqual(payment["state"]["spends"][0]["txId"], "0.0.1001@1760905800.000000321")

    def test_overspend_is_rejected_without_changing_facility(self) -> None:
        self.store.act("match_lenders", "match-test-3")
        before = self.store.get()["facility"]
        result = self.store.act("compute_overspend", "overspend-test")
        self.assertEqual(result["event"]["status"], "danger")
        self.assertIn("AGENT_BUDGET_EXCEEDED", result["event"]["detail"])
        self.assertEqual(self.store.get()["facility"], before)

    def test_aggregate_overspend_is_rejected_at_remaining_facility_limit(self) -> None:
        self.store.act("match_lenders", "match-test-4")
        self.store.act("research_payment", "payment-test-2")
        before = self.store.get()["facility"]
        result = self.store.act("global_overspend", "global-overspend-test")
        self.assertEqual(result["event"]["status"], "danger")
        self.assertIn("GLOBAL_CREDIT_LIMIT_EXCEEDED", result["event"]["detail"])
        self.assertEqual(self.store.get()["facility"], before)

    def test_idempotency_replays_result_and_state_persists(self) -> None:
        result = self.store.act("confirm_invoice", "confirm-once")
        replay = self.store.act("confirm_invoice", "confirm-once")
        second = DemoStore()
        self.assertEqual(replay, result)
        self.assertEqual(second.get()["invoice"]["status"], "TOKENIZED")
        second.close()


if __name__ == "__main__":
    unittest.main()
