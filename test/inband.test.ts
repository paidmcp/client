import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { detectPaymentRequest, isSameSitePointer } from "../src/inband.js";

// Real unpaid tools/call results captured from the live directory listings.
function fixture(name: string) {
  return JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"),
  ).result;
}

describe("detectPaymentRequest on live servers", () => {
  test("sigtap: official x402 MCP shape (isError + JSON content)", () => {
    const found = detectPaymentRequest(fixture("sigtap"));
    assert.equal(found?.kind, "meta");
    assert.equal(found?.paymentRequired.accepts[0].network, "eip155:8453");
  });

  test("penniless: official x402 MCP shape", () => {
    const found = detectPaymentRequest(fixture("penniless"));
    assert.equal(found?.kind, "meta");
  });

  test("bug bounty: challenge in the second content item, isError false", () => {
    const found = detectPaymentRequest(fixture("bugbounty"));
    assert.equal(found?.kind, "meta");
    assert.equal(found?.paymentRequired.accepts[0].amount, "5000000");
  });

  test("47620: pointer to a paid HTTP URL", () => {
    const found = detectPaymentRequest(fixture("47620"));
    assert.equal(found?.kind, "pointer");
    if (found?.kind !== "pointer") return;
    assert.equal(found.url, "https://47620.xyz/x/base-fac/gas");
    assert.equal(found.method, "GET");
  });

  test("a free tool's normal output is not a payment request", () => {
    // sigtap's catalog lists prices and payment instructions as data.
    assert.equal(detectPaymentRequest(fixture("sigtap-free")), null);
  });
});

describe("detectPaymentRequest edge cases", () => {
  const challenge = {
    x402Version: 2,
    error: "Payment required",
    accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000" }],
  };

  test("reads _meta['x402/error'] and structuredContent", () => {
    assert.equal(
      detectPaymentRequest({ _meta: { "x402/error": challenge } })?.kind,
      "meta",
    );
    assert.equal(
      detectPaymentRequest({ structuredContent: challenge, content: [] })?.kind,
      "meta",
    );
  });

  test("ignores challenges nested inside ordinary data", () => {
    const result = {
      content: [
        {
          type: "text",
          text: JSON.stringify({ report: { example: challenge } }),
        },
      ],
    };
    assert.equal(detectPaymentRequest(result), null);
  });

  test("ignores look-alikes without accepts, non-JSON and non-text items", () => {
    assert.equal(
      detectPaymentRequest({
        content: [
          {
            type: "text",
            text: JSON.stringify({ x402Version: 2, accepts: [] }),
          },
          { type: "text", text: "x402Version accepts payment required" },
          { type: "image", data: JSON.stringify(challenge) },
        ],
      }),
      null,
    );
  });

  test("a pointer needs an explicit 402 flag and a full challenge", () => {
    const pointer = { url: "https://h.dev/x", status: 402, challenge };
    assert.equal(
      detectPaymentRequest({
        content: [{ type: "text", text: JSON.stringify(pointer) }],
      })?.kind,
      "pointer",
    );
    const unflagged = { url: "https://h.dev/x", challenge };
    assert.equal(
      detectPaymentRequest({
        content: [{ type: "text", text: JSON.stringify(unflagged) }],
      })?.kind,
      // Without the flag it is not a pointer; the nested challenge is not
      // top-level either, so nothing is detected.
      undefined,
    );
  });
});

describe("isSameSitePointer", () => {
  test("allows the endpoint's own host and its subdomains over https", () => {
    assert.ok(
      isSameSitePointer("https://47620.xyz/x/base/gas", "https://47620.xyz"),
    );
    assert.ok(
      isSameSitePointer("https://api.47620.xyz/x", "https://47620.xyz"),
    );
  });

  test("refuses other hosts, look-alike domains, http and credentials", () => {
    assert.equal(
      isSameSitePointer("https://evil.dev/pay", "https://47620.xyz"),
      false,
    );
    assert.equal(
      isSameSitePointer("https://47620.xyz.evil.dev/", "https://47620.xyz"),
      false,
    );
    assert.equal(
      isSameSitePointer("https://x47620.xyz/", "https://47620.xyz"),
      false,
    );
    assert.equal(
      isSameSitePointer("http://47620.xyz/x", "https://47620.xyz"),
      false,
    );
    assert.equal(
      isSameSitePointer("https://u:p@47620.xyz/x", "https://47620.xyz"),
      false,
    );
  });

  test("allows plain http only for a local endpoint's own host", () => {
    assert.ok(
      isSameSitePointer("http://127.0.0.1:4021/x", "http://127.0.0.1:4021"),
    );
    assert.equal(
      isSameSitePointer("http://127.0.0.1:9999/x", "http://127.0.0.1:4021"),
      false,
    );
  });
});
