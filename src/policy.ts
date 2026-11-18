import type { PaymentRequirements } from "@x402/fetch";

export const BASE_NETWORK_TESTNET = "eip155:84532" as const;
export const BASE_NETWORK_MAINNET = "eip155:8453" as const;
export const PLASMA_NETWORK = "eip155:9745" as const;

export type NetworkMode = "test" | "live";

/** Canonical stablecoin contracts per mode. Payments in anything else are refused. */
export const MODE_DEFAULTS = {
  test: {
    baseNetwork: BASE_NETWORK_TESTNET,
    baseRpcUrl: "https://sepolia.base.org",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  live: {
    baseNetwork: BASE_NETWORK_MAINNET,
    baseRpcUrl: "https://mainnet.base.org",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
} as const;

export const PLASMA_DEFAULTS = {
  rpcUrl: "https://rpc.plasma.to",
  usdt0Address: "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb",
} as const;

/** Longest authorization validity the client will sign, in seconds. */
export const MAX_TIMEOUT_SECONDS = 600;

export type AcceptedAsset = { network: string; asset: string; label: string };

/**
 * The only (network, token) pairs the client pays with. Plasma is mainnet
 * only, so it is accepted in live mode only.
 */
export function acceptedAssets(opts: {
  networkMode: NetworkMode;
  usdcAddress: string;
  usdt0Address: string;
}): AcceptedAsset[] {
  const mode = MODE_DEFAULTS[opts.networkMode];
  const assets: AcceptedAsset[] = [
    {
      network: mode.baseNetwork,
      asset: opts.usdcAddress,
      label:
        opts.networkMode === "test" ? "USDC on Base Sepolia" : "USDC on Base",
    },
  ];
  if (opts.networkMode === "live") {
    assets.push({
      network: PLASMA_NETWORK,
      asset: opts.usdt0Address,
      label: "USDT0 on Plasma",
    });
  }
  return assets;
}

export function findAcceptedAsset(
  requirement: PaymentRequirements,
  accepted: AcceptedAsset[],
): AcceptedAsset | undefined {
  return accepted.find(
    (a) =>
      a.network === requirement.network &&
      a.asset.toLowerCase() === String(requirement.asset).toLowerCase(),
  );
}

/**
 * Picks the cheapest payment option the client is willing to sign: the
 * "exact" scheme, an accepted network + token contract, an amount within the
 * per-call cap and the wallet balance, a valid payee and a bounded validity
 * window. Throws with a readable reason when nothing qualifies.
 */
export function selectRequirement(
  requirements: PaymentRequirements[],
  opts: {
    accepted: AcceptedAsset[];
    maxPerCallAtomic: bigint;
    balances: Map<string, bigint>;
  },
): PaymentRequirements {
  const candidates = requirements.filter((r) => {
    if (r.scheme !== "exact") return false;
    if (!findAcceptedAsset(r, opts.accepted)) return false;
    if (!/^[0-9]+$/.test(String(r.amount))) return false;
    if (!/^0x[0-9a-fA-F]{40}$/.test(String(r.payTo))) return false;
    const timeout = Number(r.maxTimeoutSeconds ?? 0);
    if (!Number.isFinite(timeout) || timeout > MAX_TIMEOUT_SECONDS) {
      return false;
    }
    const amount = BigInt(r.amount);
    return amount > 0n;
  });
  if (candidates.length === 0) {
    const offered = requirements
      .map((r) => `${r.scheme}/${r.network}/${String(r.asset)}`)
      .join(", ");
    throw new Error(
      `The server asked for payment in a token or network this client does not pay with (${offered || "none"}). Accepted: ${opts.accepted.map((a) => a.label).join(", ")}.`,
    );
  }
  const withinCap = candidates.filter(
    (r) => BigInt(r.amount) <= opts.maxPerCallAtomic,
  );
  if (withinCap.length === 0) {
    throw new Error(
      `The price is above your per-call cap (maxPerCallUsdt). Cheapest option: ${formatUsd(minAmount(candidates))}.`,
    );
  }
  const affordable = withinCap
    .filter((r) => {
      const balance = opts.balances.get(r.network);
      return balance !== undefined && balance >= BigInt(r.amount);
    })
    .sort((a, b) => (BigInt(a.amount) < BigInt(b.amount) ? -1 : 1));
  if (affordable.length === 0) {
    throw new Error(
      `Insufficient balance for ${formatUsd(minAmount(withinCap))}. Fund your wallet (see "paidmcp wallet").`,
    );
  }
  return affordable[0];
}

function minAmount(requirements: PaymentRequirements[]): bigint {
  return requirements
    .map((r) => BigInt(r.amount))
    .reduce((a, b) => (a < b ? a : b));
}

/**
 * Normalizes a paid MCP endpoint to its base URL. Requires https, except for
 * local development hosts, so a network attacker cannot rewrite the payee.
 * A trailing "/mcp" is removed because the client appends it.
 */
export function normalizeEndpoint(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid endpoint URL: ${endpoint}`);
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (url.protocol === "http:" && !localHosts.has(url.hostname)) {
    throw new Error(
      `Refusing plain http endpoint ${endpoint}: payment details could be altered in transit. Use https.`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported endpoint protocol: ${url.protocol}`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Endpoint must not contain credentials, a query or a fragment.",
    );
  }
  return `${url.origin}${url.pathname}`
    .replace(/\/+$/, "")
    .replace(/\/mcp$/, "");
}

export function toAtomic(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

export function formatUsd(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `$${fraction ? `${whole}.${fraction}` : whole}`;
}
