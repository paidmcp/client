import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import WalletManagerEvm from "@tetherto/wdk-wallet-evm";
import { type ClientEvmSigner, ExactEvmScheme } from "@x402/evm";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import type { PaymentRequired, PaymentRequirements } from "@x402/fetch";
import { getLedgerPath, loadConfig } from "./config.js";
import {
  type PaymentRequiredLike,
  detectPaymentRequest,
  isSameSitePointer,
} from "./inband.js";
import { SpendLedger } from "./ledger.js";
import {
  MODE_DEFAULTS,
  PLASMA_NETWORK,
  acceptedAssets,
  findAcceptedAsset,
  formatUsd,
  normalizeEndpoint,
  selectRequirement,
  toAtomic,
  x402SpendControls,
} from "./policy.js";
import { version } from "./version.js";

// stdout carries the MCP protocol: every log line must go to stderr.
const log = (message: string) => console.error(`[paidmcp] ${message}`);

type CallToolParams = Parameters<Client["callTool"]>[0];

export async function runProxy(endpoint: string): Promise<void> {
  const cfg = loadConfig();
  cfg.warnings.forEach((w) => log(`warning: ${w}`));
  const baseUrl = normalizeEndpoint(endpoint);
  const host = new URL(baseUrl).host;
  const isLive = cfg.networkMode === "live";
  const baseNetwork = MODE_DEFAULTS[cfg.networkMode].baseNetwork;
  const accepted = acceptedAssets(cfg);

  const maxPerCallAtomic = toAtomic(cfg.maxPerCallUsdt);
  const maxSessionAtomic = toAtomic(cfg.maxSessionUsdt);
  const maxDailyAtomic = toAtomic(cfg.maxDailyUsdt);
  const confirmAboveAtomic = toAtomic(cfg.confirmAboveUsdt);
  const ledger = new SpendLedger(getLedgerPath());
  let sessionReservedAtomic = 0n;
  const reservations = new WeakMap<
    PaymentRequirements,
    { amount: bigint; day: string }
  >();

  const baseAccount = await new WalletManagerEvm(cfg.seedPhrase, {
    provider: cfg.baseRpcUrl,
  }).getAccount();
  const plasmaAccount = isLive
    ? await new WalletManagerEvm(cfg.seedPhrase, {
        provider: cfg.plasmaRpcUrl,
      }).getAccount()
    : null;

  const signer: ClientEvmSigner = {
    address: baseAccount.address as `0x${string}`,
    signTypedData: (message) =>
      baseAccount.signTypedData(
        message as Parameters<typeof baseAccount.signTypedData>[0],
      ) as Promise<`0x${string}`>,
  };

  const balanceByNetwork = new Map<string, bigint>();
  await refreshBalances();

  const mcp = new Server(
    { name: `paidmcp-proxy:${host}`, version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  const paymentClient = new x402Client((_version, requirements) =>
    selectRequirement(requirements, {
      accepted,
      maxPerCallAtomic,
      balances: balanceByNetwork,
    }),
  ).register(baseNetwork, new ExactEvmScheme(signer));
  if (isLive) {
    paymentClient.register(PLASMA_NETWORK, new ExactEvmScheme(signer));
  }
  paymentClient.setSpendControls(x402SpendControls(cfg));

  paymentClient.onBeforePaymentCreation(async (ctx) => {
    const requirement = ctx.selectedRequirements;
    const amount = BigInt(requirement.amount);
    const asset = findAcceptedAsset(requirement, accepted);
    if (!asset) {
      return { abort: true, reason: "Unsupported payment token or network" };
    }
    if (amount > maxPerCallAtomic) {
      return {
        abort: true,
        reason: `${formatUsd(amount)} is above your per-call cap (maxPerCallUsdt)`,
      };
    }
    // Reserve before anything awaits, so parallel calls cannot overshoot.
    if (sessionReservedAtomic + amount > maxSessionAtomic) {
      return {
        abort: true,
        reason: `Session cap reached (maxSessionUsdt=${cfg.maxSessionUsdt}). Restart the MCP server to reset it.`,
      };
    }
    const day = ledger.reserve(amount, maxDailyAtomic);
    if (!day) {
      return {
        abort: true,
        reason: `Daily cap reached (maxDailyUsdt=${cfg.maxDailyUsdt}, UTC day).`,
      };
    }
    sessionReservedAtomic += amount;
    reservations.set(requirement, { amount, day });

    if (amount >= confirmAboveAtomic) {
      const decision = await confirmPayment(
        mcp,
        `Pay ${formatUsd(amount)} in ${asset.label} to ${host}?`,
        cfg.confirmAboveUsdt,
      );
      if (!decision.approved) {
        releaseReservation(requirement);
        return { abort: true, reason: decision.reason };
      }
    }
    return undefined;
  });
  paymentClient.onPaymentCreationFailure(async (ctx) => {
    releaseReservation(ctx.selectedRequirements);
    return undefined;
  });
  paymentClient.onAfterPaymentCreation(async (ctx) => {
    const amount = BigInt(ctx.selectedRequirements.amount);
    log(
      `signed payment of ${formatUsd(amount)} on ${ctx.selectedRequirements.network}; session total ${formatUsd(sessionReservedAtomic)}, today ${formatUsd(ledger.spentToday())}`,
    );
  });

  const paidFetch = wrapFetchWithPayment(fetch, paymentClient);

  const upstream = new Client(
    { name: `paidmcp-upstream:${host}`, version },
    { capabilities: {} },
  );
  await upstream.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      fetch: paidFetch,
    }),
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async (request) => {
    return upstream.listTools(request.params);
  });

  mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
    await refreshBalances();
    try {
      const result = await upstream.callTool(request.params);
      // Payment requests can also arrive inside the tool result (official
      // x402 MCP transport, or a pointer to a paid HTTP URL). At most one
      // paid retry is made per call.
      const paymentRequest = detectPaymentRequest(result);
      if (!paymentRequest) return result;
      if (paymentRequest.kind === "pointer") {
        return await payPointer(paymentRequest);
      }
      return await payInBand(request.params, paymentRequest.paymentRequired);
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // x402's own spend-control errors name its internal option; point the
      // user at the setting they actually control.
      const message = raw.includes("spendControls.maxAmountPerPayment")
        ? `The price is above your per-call cap (maxPerCallUsdt=${cfg.maxPerCallUsdt}). Raise "maxPerCallUsdt" in ~/.paidmcp/config.json to allow it.`
        : raw;
      log(`tool call failed: ${raw}`);
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });

  /** Official x402 MCP transport: retry with params._meta["x402/payment"]. */
  async function payInBand(
    params: CallToolParams,
    paymentRequired: PaymentRequiredLike,
  ) {
    const payload = await paymentClient.createPaymentPayload(
      paymentRequired as unknown as PaymentRequired,
    );
    const retry = await upstream.callTool({
      ...params,
      _meta: { ...(params._meta ?? {}), "x402/payment": payload },
    });
    const again = detectPaymentRequest(retry);
    if (again) {
      // Same request as before: the server most likely never read the
      // payment. A different error is the server's verdict on it.
      const unchanged =
        JSON.stringify(again.paymentRequired) ===
        JSON.stringify(paymentRequired);
      const reason = again.paymentRequired.error;
      log(
        `server did not accept the payment for ${params.name}: ${unchanged ? "it ignored the payment" : (reason ?? "payment rejected")}`,
      );
      const text = unchanged
        ? `The server did not accept the payment for "${params.name}": it asked for payment again without reading it, so it probably does not support paying inside MCP tool calls (x402 "_meta" payments). The server confirmed no payment; no further payment was attempted. The signed authorization expires on its own and counts toward your spend caps.`
        : `The server rejected the payment for "${params.name}"${reason ? `: ${reason}` : ""}. No further payment was attempted.`;
      return { isError: true, content: [{ type: "text", text }] };
    }
    const receipt = (
      retry._meta as
        { "x402/payment-response"?: { transaction?: string } } | undefined
    )?.["x402/payment-response"];
    if (receipt?.transaction) {
      log(`payment settled for ${params.name}: ${receipt.transaction}`);
    }
    return retry;
  }

  /** The result points at a paid HTTP URL: pay it and return its data. */
  async function payPointer(request: { url: string; method: string }) {
    if (!isSameSitePointer(request.url, baseUrl)) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Refused to pay ${request.url}: payment links must stay on ${host} and use https.`,
          },
        ],
      };
    }
    if (request.method !== "GET") {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `The server asks for payment at ${request.url} with ${request.method}, which this client does not support.`,
          },
        ],
      };
    }
    const response = await paidFetch(request.url, {
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Paid request to ${request.url} failed with HTTP ${response.status}: ${text.slice(0, 500)}`,
          },
        ],
      };
    }
    let structuredContent: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        structuredContent = parsed;
      }
    } catch {
      // not JSON; return the text as is
    }
    return {
      content: [{ type: "text" as const, text }],
      ...(structuredContent ? { structuredContent } : {}),
    };
  }

  mcp.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    return upstream.listResources(request.params);
  });

  mcp.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return upstream.readResource(request.params);
  });

  mcp.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    return upstream.listPrompts(request.params);
  });

  mcp.setRequestHandler(GetPromptRequestSchema, async (request) => {
    return upstream.getPrompt(request.params);
  });

  const transport = new StdioServerTransport();
  // Exit with the MCP client instead of lingering on the upstream stream.
  process.stdin.on("end", () => process.exit(0));
  await mcp.connect(transport);

  function releaseReservation(requirement: PaymentRequirements): void {
    const reservation = reservations.get(requirement);
    if (!reservation) return;
    reservations.delete(requirement);
    sessionReservedAtomic -= reservation.amount;
    ledger.release(reservation.amount, reservation.day);
  }

  async function refreshBalances(): Promise<void> {
    const [base, plasma] = await Promise.all([
      baseAccount.getTokenBalance(cfg.usdcAddress).catch(() => null),
      plasmaAccount
        ? plasmaAccount.getTokenBalance(cfg.usdt0Address).catch(() => null)
        : Promise.resolve(null),
    ]);
    if (base !== null) balanceByNetwork.set(baseNetwork, base);
    if (plasma !== null) balanceByNetwork.set(PLASMA_NETWORK, plasma);
  }
}

/**
 * Asks the user through their MCP client (elicitation). Payments are never
 * approved silently: if the client cannot show prompts, the payment is
 * refused with instructions for raising the confirmation threshold.
 */
export async function confirmPayment(
  mcp: Pick<Server, "getClientCapabilities" | "elicitInput">,
  message: string,
  confirmAboveUsdt: number,
): Promise<{ approved: boolean; reason: string }> {
  if (!mcp.getClientCapabilities()?.elicitation) {
    return {
      approved: false,
      reason: `This payment needs your approval (it is at or above confirmAboveUsdt=${confirmAboveUsdt}), but this MCP client cannot show approval prompts. To allow payments of this size without a prompt, raise "confirmAboveUsdt" in ~/.paidmcp/config.json.`,
    };
  }
  try {
    const result = await mcp.elicitInput({
      message,
      requestedSchema: {
        type: "object",
        properties: {
          approve: {
            type: "boolean",
            title: "Approve this payment",
            default: false,
          },
        },
        required: ["approve"],
      },
    });
    const approved =
      result.action === "accept" && result.content?.approve === true;
    return { approved, reason: "Payment was not approved." };
  } catch (error) {
    return {
      approved: false,
      reason: `Could not get payment approval: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
