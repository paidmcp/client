/**
 * Detects x402 payment requests that arrive inside MCP tool results, as
 * opposed to an HTTP 402 response (which the fetch wrapper handles).
 *
 * Two shapes are recognized:
 * - "meta": the official x402 MCP transport. The tool result carries a
 *   PaymentRequired object ({ x402Version, accepts, ... }) in `_meta`
 *   ["x402/error"], `structuredContent`, or a JSON text content item. The
 *   client retries the call with the payment in `params._meta["x402/payment"]`.
 * - "pointer": the result says the data lives behind a separate paid HTTP
 *   URL ({ url, status: 402 | payment_required: true, challenge }). The
 *   client pays that URL with the regular HTTP x402 flow.
 *
 * Only top-level objects of these exact shapes count, so ordinary tool output
 * that merely mentions payments is never treated as a payment request.
 */

export type PaymentRequiredLike = {
  x402Version: number;
  accepts: Array<Record<string, unknown>>;
  error?: string;
  resource?: { url?: string; method?: string; [key: string]: unknown };
  [key: string]: unknown;
};

export type InBandPaymentRequest =
  | { kind: "meta"; paymentRequired: PaymentRequiredLike }
  | {
      kind: "pointer";
      url: string;
      method: string;
      paymentRequired: PaymentRequiredLike;
    };

type ToolResultLike = {
  content?: unknown;
  structuredContent?: unknown;
  _meta?: unknown;
};

const MAX_JSON_TEXT = 200_000;

export function isPaymentRequired(
  value: unknown,
): value is PaymentRequiredLike {
  if (!isObject(value)) return false;
  return (
    typeof value.x402Version === "number" &&
    Array.isArray(value.accepts) &&
    value.accepts.length > 0 &&
    value.accepts.every(isObject)
  );
}

function asPointer(value: unknown): InBandPaymentRequest | null {
  if (!isObject(value)) return null;
  const flagged = value.payment_required === true || value.status === 402;
  if (!flagged || typeof value.url !== "string") return null;
  if (!isPaymentRequired(value.challenge)) return null;
  const method =
    typeof value.challenge.resource?.method === "string"
      ? value.challenge.resource.method.toUpperCase()
      : "GET";
  return {
    kind: "pointer",
    url: value.url,
    method,
    paymentRequired: value.challenge,
  };
}

function classify(value: unknown): InBandPaymentRequest | null {
  const pointer = asPointer(value);
  if (pointer) return pointer;
  if (isPaymentRequired(value)) return { kind: "meta", paymentRequired: value };
  return null;
}

export function detectPaymentRequest(
  result: ToolResultLike,
): InBandPaymentRequest | null {
  if (isObject(result._meta)) {
    const found = classify(result._meta["x402/error"]);
    if (found) return found;
  }
  const structured = classify(result.structuredContent);
  if (structured) return structured;
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (!isObject(item) || item.type !== "text") continue;
      if (typeof item.text !== "string") continue;
      const text = item.text.trim();
      if (!text.startsWith("{") || text.length > MAX_JSON_TEXT) continue;
      try {
        const found = classify(JSON.parse(text));
        if (found) return found;
      } catch {
        // not JSON
      }
    }
  }
  return null;
}

/**
 * A payment pointer may only lead to the same host as the MCP endpoint (or a
 * subdomain of it), over https, so a server cannot redirect payments to an
 * unrelated site.
 */
export function isSameSitePointer(
  pointerUrl: string,
  baseUrl: string,
): boolean {
  let target: URL;
  let base: URL;
  try {
    target = new URL(pointerUrl);
    base = new URL(baseUrl);
  } catch {
    return false;
  }
  if (target.username || target.password) return false;
  const local = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (target.protocol !== "https:") {
    if (!(target.protocol === "http:" && local.has(target.hostname))) {
      return false;
    }
  }
  return (
    target.host === base.host ||
    (target.hostname.endsWith(`.${base.hostname}`) && !local.has(base.hostname))
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Only a single JSON-RPC `tools/call` may be paid. Every other request the
 * MCP transport makes (the GET event stream, initialize, tools/list, ...)
 * goes through plain fetch, so a server answering those with HTTP 402
 * gets an error instead of a payment.
 */
export function payOnlyForToolCalls(
  paidFetch: typeof fetch,
  plainFetch: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "POST") {
      try {
        const message = JSON.parse(await request.clone().text());
        if (isObject(message) && message.method === "tools/call") {
          return paidFetch(request);
        }
      } catch {
        // not a JSON-RPC body
      }
    }
    return plainFetch(request);
  };
}
