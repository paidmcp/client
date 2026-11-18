import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type ClientEvmSigner, ExactEvmScheme } from "@x402/evm";
import { x402Client } from "@x402/fetch";
import type { PaymentRequired, PaymentRequirements } from "@x402/fetch";
import {
  BASE_NETWORK_MAINNET,
  BASE_NETWORK_TESTNET,
  MODE_DEFAULTS,
  PLASMA_DEFAULTS,
  PLASMA_NETWORK,
  acceptedAssets,
  normalizeEndpoint,
  selectRequirement,
  toAtomic,
  x402SpendControls,
} from "../src/policy.js";

const PAYEE = "0x2222222222222222222222222222222222222222";
const USDC_TEST = MODE_DEFAULTS.test.usdcAddress;
const USDC_LIVE = MODE_DEFAULTS.live.usdcAddress;

function req(overrides: Partial<PaymentRequirements>): PaymentRequirements {
  return {
    scheme: "exact",
    network: BASE_NETWORK_TESTNET,
    asset: USDC_TEST,
    amount: "1000",
    payTo: PAYEE,
    maxTimeoutSeconds: 60,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  } as PaymentRequirements;
}

const testAccepted = acceptedAssets({
  networkMode: "test",
  usdcAddress: USDC_TEST,
  usdt0Address: PLASMA_DEFAULTS.usdt0Address,
});
const liveAccepted = acceptedAssets({
  networkMode: "live",
  usdcAddress: USDC_LIVE,
  usdt0Address: PLASMA_DEFAULTS.usdt0Address,
});
const rich = (network: string) => new Map([[network, 10n ** 12n]]);

describe("selectRequirement", () => {
  test("accepts USDC on the mode's Base network", () => {
    const chosen = selectRequirement([req({})], {
      accepted: testAccepted,
      maxPerCallAtomic: toAtomic(0.25),
      balances: rich(BASE_NETWORK_TESTNET),
    });
    assert.equal(chosen.amount, "1000");
  });

  test("refuses a token other than USDC/USDT0, even when cheap", () => {
    // 250000 units of an 8-decimal token would be worth far more than $0.25.
    const other = req({
      asset: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      amount: "250000",
    });
    assert.throws(
      () =>
        selectRequirement([other], {
          accepted: testAccepted,
          maxPerCallAtomic: toAtomic(0.25),
          balances: rich(BASE_NETWORK_TESTNET),
        }),
      /token or network this client does not pay with/,
    );
  });

  test("ignores the unaccepted option and picks the accepted one", () => {
    const other = req({
      asset: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      amount: "1",
    });
    const usdc = req({ amount: "5000" });
    const chosen = selectRequirement([other, usdc], {
      accepted: testAccepted,
      maxPerCallAtomic: toAtomic(0.25),
      balances: rich(BASE_NETWORK_TESTNET),
    });
    assert.equal(chosen.asset, USDC_TEST);
  });

  test("never pays on Plasma (mainnet) in test mode", () => {
    const plasma = req({
      network: PLASMA_NETWORK,
      asset: PLASMA_DEFAULTS.usdt0Address,
    });
    assert.throws(() =>
      selectRequirement([plasma], {
        accepted: testAccepted,
        maxPerCallAtomic: toAtomic(0.25),
        balances: rich(PLASMA_NETWORK),
      }),
    );
  });

  test("pays on Plasma in live mode", () => {
    const plasma = req({
      network: PLASMA_NETWORK,
      asset: PLASMA_DEFAULTS.usdt0Address,
    });
    const chosen = selectRequirement([plasma], {
      accepted: liveAccepted,
      maxPerCallAtomic: toAtomic(0.25),
      balances: rich(PLASMA_NETWORK),
    });
    assert.equal(chosen.network, PLASMA_NETWORK);
  });

  test("refuses mainnet USDC in test mode and testnet USDC in live mode", () => {
    assert.throws(() =>
      selectRequirement(
        [req({ network: BASE_NETWORK_MAINNET, asset: USDC_LIVE })],
        {
          accepted: testAccepted,
          maxPerCallAtomic: toAtomic(0.25),
          balances: rich(BASE_NETWORK_MAINNET),
        },
      ),
    );
    assert.throws(() =>
      selectRequirement(
        [req({ network: BASE_NETWORK_MAINNET, asset: USDC_TEST })],
        {
          accepted: liveAccepted,
          maxPerCallAtomic: toAtomic(0.25),
          balances: rich(BASE_NETWORK_MAINNET),
        },
      ),
    );
  });

  test("enforces the per-call cap", () => {
    assert.throws(
      () =>
        selectRequirement([req({ amount: String(toAtomic(0.26)) })], {
          accepted: testAccepted,
          maxPerCallAtomic: toAtomic(0.25),
          balances: rich(BASE_NETWORK_TESTNET),
        }),
      /per-call cap/,
    );
  });

  test("refuses long-lived authorizations, other schemes and bad payees", () => {
    for (const bad of [
      req({ maxTimeoutSeconds: 86_400 }),
      req({ scheme: "upto" }),
      req({ payTo: "not-an-address" }),
      req({ amount: "-5" }),
      req({ amount: "0" }),
    ]) {
      assert.throws(() =>
        selectRequirement([bad], {
          accepted: testAccepted,
          maxPerCallAtomic: toAtomic(0.25),
          balances: rich(BASE_NETWORK_TESTNET),
        }),
      );
    }
  });

  test("requires enough balance", () => {
    assert.throws(
      () =>
        selectRequirement([req({ amount: "5000" })], {
          accepted: testAccepted,
          maxPerCallAtomic: toAtomic(0.25),
          balances: new Map([[BASE_NETWORK_TESTNET, 4999n]]),
        }),
      /Insufficient balance/,
    );
  });
});

describe("normalizeEndpoint", () => {
  test("requires https except for localhost", () => {
    assert.throws(() => normalizeEndpoint("http://example.com"), /plain http/);
    assert.equal(
      normalizeEndpoint("http://localhost:4021"),
      "http://localhost:4021",
    );
    assert.equal(
      normalizeEndpoint("http://127.0.0.1:4021/"),
      "http://127.0.0.1:4021",
    );
  });

  test("strips a trailing /mcp and slashes", () => {
    assert.equal(normalizeEndpoint("https://host.dev/mcp"), "https://host.dev");
    assert.equal(
      normalizeEndpoint("https://host.dev/api/"),
      "https://host.dev/api",
    );
  });

  test("rejects credentials, queries and invalid URLs", () => {
    assert.throws(() => normalizeEndpoint("https://u:p@host.dev"));
    assert.throws(() => normalizeEndpoint("https://host.dev?x=1"));
    assert.throws(() => normalizeEndpoint("not a url"));
  });
});

describe("x402SpendControls with the real x402 client", () => {
  const signer: ClientEvmSigner = {
    address: "0x1111111111111111111111111111111111111111",
    signTypedData: async () => `0x${"11".repeat(65)}`,
  };
  const liveCfg = {
    networkMode: "live" as const,
    maxPerCallUsdt: 0.25,
    usdt0Address: PLASMA_DEFAULTS.usdt0Address,
  };
  const paymentRequired = (requirement: PaymentRequirements) =>
    ({
      x402Version: 2,
      resource: { url: "mcp://tool/x" },
      accepts: [requirement],
    }) as unknown as PaymentRequired;
  const usdt0 = req({
    network: PLASMA_NETWORK,
    asset: PLASMA_DEFAULTS.usdt0Address,
    amount: "10000",
    extra: { name: "USDT0", version: "1" },
  });

  function client(controls?: ReturnType<typeof x402SpendControls>) {
    const c = new x402Client((_v, reqs) => reqs[0])
      .register(BASE_NETWORK_MAINNET, new ExactEvmScheme(signer))
      .register(PLASMA_NETWORK, new ExactEvmScheme(signer));
    if (controls) c.setSpendControls(controls);
    return c;
  }

  test("x402's defaults alone would refuse Plasma USDT0", async () => {
    await assert.rejects(
      client().createPaymentPayload(paymentRequired(usdt0)),
      /spendControls/,
    );
  });

  test("with the client's settings, Plasma USDT0 is paid in live mode", async () => {
    const payload = await client(
      x402SpendControls(liveCfg),
    ).createPaymentPayload(paymentRequired(usdt0));
    assert.equal(payload.accepted.network, PLASMA_NETWORK);
  });

  test("x402's cap follows maxPerCallUsdt instead of its $1 default", async () => {
    const usdc = (usd: number) =>
      req({
        network: BASE_NETWORK_MAINNET,
        asset: USDC_LIVE,
        amount: String(toAtomic(usd)),
        extra: { name: "USD Coin", version: "2" },
      });
    const generous = x402SpendControls({ ...liveCfg, maxPerCallUsdt: 6 });
    // $5 passes with maxPerCallUsdt=6 (x402's default would stop at $1)...
    await client(generous).createPaymentPayload(paymentRequired(usdc(5)));
    // ...and $0.30 is refused with maxPerCallUsdt=0.25.
    await assert.rejects(
      client(x402SpendControls(liveCfg)).createPaymentPayload(
        paymentRequired(usdc(0.3)),
      ),
      /maxAmountPerPayment/,
    );
  });
});
