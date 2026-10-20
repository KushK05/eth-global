import { createHash } from "node:crypto";
import { createRequire } from "node:module";

type Environment = Record<string, string | undefined>;

const require = createRequire(import.meta.url);
const aquaSdk = require("@1inch/aqua-sdk") as typeof import("@1inch/aqua-sdk");
const swapVmSdk = require("@1inch/swap-vm-sdk") as typeof import("@1inch/swap-vm-sdk");
const { Address, AquaProtocolContract, HexString, NetworkEnum } = aquaSdk;
const { AQUA_SWAP_VM_CONTRACT_ADDRESSES } = swapVmSdk;
const { AQUA_CONTRACT_ADDRESSES } = aquaSdk;

export const ARC_CHAIN_ID = 5042;

export type AquaConfig = {
  chainId: typeof ARC_CHAIN_ID;
  rpcUrl: string;
  usdcAddress: string;
  aquaAddress: string;
  swapVmRouterAddress: string;
};

export type LenderOffer = {
  lenderId: string;
  makerAddress: string;
  strategy: string;
  usdcLiquidityMinor: bigint;
  aprBps: number;
  minBuyerScore: "A" | "A-" | "B";
  maxAdvanceRateBps: number;
  maxTenorDays: number;
  expiresAt: string;
};

export type FundingRequest = {
  receivableId: string;
  borrowerAddress: string;
  requestedMinor: bigint;
  buyerScore: "A" | "A-" | "B";
  advanceRateBps: number;
  tenorDays: number;
  asOf: string;
};

export type FundingAllocation = {
  lenderId: string;
  makerAddress: string;
  strategyHash: string;
  principalMinor: bigint;
  aprBps: number;
};

export type AquaFundingPlan = {
  planId: string;
  status: "QUOTED";
  chainId: typeof ARC_CHAIN_ID;
  requestedMinor: bigint;
  allocatedMinor: bigint;
  remainingMinor: bigint;
  allocations: FundingAllocation[];
  rejected: Array<{ lenderId: string; reason: string }>;
};

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required Aqua configuration: ${name}`);
  return value;
}

function address(value: string, name: string): string {
  try {
    return new Address(value).toString();
  } catch {
    throw new Error(`${name} must be an EVM address.`);
  }
}

function positive(value: bigint, name: string): void {
  if (value <= 0n) throw new Error(`${name} must be positive.`);
}

const SCORE: Record<FundingRequest["buyerScore"], number> = { A: 3, "A-": 2, B: 1 };

export function loadAquaConfig(env: Environment = process.env): AquaConfig {
  const chainId = Number(env.AQUA_CHAIN_ID ?? ARC_CHAIN_ID);
  if (chainId !== ARC_CHAIN_ID) throw new Error("Aqua integration is restricted to Arc chain ID 5042.");

  const aquaAddress = AQUA_CONTRACT_ADDRESSES[NetworkEnum.ARC].toString();
  const swapVmRouterAddress = AQUA_SWAP_VM_CONTRACT_ADDRESSES[NetworkEnum.ARC].toString();
  return {
    chainId: ARC_CHAIN_ID,
    rpcUrl: required(env, "AQUA_RPC_URL"),
    usdcAddress: address(required(env, "AQUA_USDC_ADDRESS"), "AQUA_USDC_ADDRESS"),
    aquaAddress,
    swapVmRouterAddress,
  };
}

export function strategyHash(strategy: string): string {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(strategy)) {
    throw new Error("Aqua strategy must be non-empty, byte-aligned hex.");
  }
  return AquaProtocolContract.calculateStrategyHash(new HexString(strategy)).toString();
}

function isEligible(offer: LenderOffer, request: FundingRequest): string | undefined {
  if (SCORE[offer.minBuyerScore] > SCORE[request.buyerScore]) return "BUYER_SCORE_INELIGIBLE";
  if (offer.maxAdvanceRateBps < request.advanceRateBps) return "ADVANCE_RATE_INELIGIBLE";
  if (offer.maxTenorDays < request.tenorDays) return "TENOR_INELIGIBLE";
  if (Date.parse(offer.expiresAt) <= Date.parse(request.asOf)) return "OFFER_EXPIRED";
  if (offer.usdcLiquidityMinor <= 0n) return "NO_LIQUIDITY";
  return undefined;
}

export function selectAquaFunding(offers: LenderOffer[], request: FundingRequest): AquaFundingPlan {
  positive(request.requestedMinor, "requestedMinor");
  address(request.borrowerAddress, "borrowerAddress");
  if (!request.receivableId.trim()) throw new Error("receivableId is required.");
  if (Number.isNaN(Date.parse(request.asOf))) throw new Error("asOf must be an ISO-8601 timestamp.");

  let remaining = request.requestedMinor;
  const rejected: AquaFundingPlan["rejected"] = [];
  const allocations: FundingAllocation[] = [];
  for (const offer of [...offers].sort((left, right) => left.aprBps - right.aprBps || left.lenderId.localeCompare(right.lenderId))) {
    const rejection = isEligible(offer, request);
    if (rejection) {
      rejected.push({ lenderId: offer.lenderId, reason: rejection });
      continue;
    }
    const principalMinor = offer.usdcLiquidityMinor < remaining ? offer.usdcLiquidityMinor : remaining;
    if (principalMinor > 0n) {
      allocations.push({
        lenderId: offer.lenderId,
        makerAddress: address(offer.makerAddress, `${offer.lenderId}.makerAddress`),
        strategyHash: strategyHash(offer.strategy),
        principalMinor,
        aprBps: offer.aprBps,
      });
      remaining -= principalMinor;
    }
    if (remaining === 0n) break;
  }

  const allocatedMinor = request.requestedMinor - remaining;
  const planId = `aqua-${createHash("sha256")
    .update(`${request.receivableId}:${request.asOf}:${allocations.map((item) => `${item.lenderId}:${item.principalMinor}`).join(",")}`)
    .digest("hex")
    .slice(0, 16)}`;
  return {
    planId,
    status: "QUOTED",
    chainId: ARC_CHAIN_ID,
    requestedMinor: request.requestedMinor,
    allocatedMinor,
    remainingMinor: remaining,
    allocations,
    rejected,
  };
}

export function buildAquaShipTransaction(
  config: AquaConfig,
  makerAddress: string,
  strategy: string,
  amountMinor: bigint,
) {
  positive(amountMinor, "amountMinor");
  address(makerAddress, "makerAddress");
  const transaction = AquaProtocolContract.buildShipTx(new Address(config.aquaAddress), {
    app: new Address(config.swapVmRouterAddress),
    strategy: new HexString(strategy),
    amountsAndTokens: [{ amount: amountMinor, token: new Address(config.usdcAddress) }],
  });
  return { to: transaction.to.toString(), data: transaction.data.toString(), value: transaction.value.toString() };
}
