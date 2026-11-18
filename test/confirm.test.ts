import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { confirmPayment } from "../src/run.js";

type FakeServer = Parameters<typeof confirmPayment>[0];

function fakeServer(
  capabilities: object | undefined,
  answer?: () => Promise<unknown>,
): FakeServer {
  return {
    getClientCapabilities: () => capabilities,
    elicitInput: (async () => {
      if (!answer) throw new Error("elicitInput should not be called");
      return answer();
    }) as unknown as FakeServer["elicitInput"],
  } as FakeServer;
}

describe("confirmPayment", () => {
  test("refuses (never auto-approves) when the client cannot prompt", async () => {
    const decision = await confirmPayment(fakeServer({}), "Pay $1?", 0.05);
    assert.equal(decision.approved, false);
    assert.match(decision.reason, /confirmAboveUsdt/);
  });

  test("approves only an explicit accept with approve=true", async () => {
    const cases: Array<[unknown, boolean]> = [
      [{ action: "accept", content: { approve: true } }, true],
      [{ action: "accept", content: { approve: false } }, false],
      [{ action: "decline" }, false],
      [{ action: "cancel" }, false],
    ];
    for (const [result, expected] of cases) {
      const decision = await confirmPayment(
        fakeServer({ elicitation: {} }, async () => result),
        "Pay $1?",
        0.05,
      );
      assert.equal(decision.approved, expected, JSON.stringify(result));
    }
  });

  test("treats a failed or timed-out prompt as a refusal", async () => {
    const decision = await confirmPayment(
      fakeServer({ elicitation: {} }, async () => {
        throw new Error("Request timed out");
      }),
      "Pay $1?",
      0.05,
    );
    assert.equal(decision.approved, false);
  });
});
