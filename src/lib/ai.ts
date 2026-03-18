import Anthropic from "@anthropic-ai/sdk";
import {
  IntentLabel,
  MessageAuthorRole,
  ResolutionActionType,
} from "@prisma/client";
import OpenAI from "openai";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";

import { aiEnv } from "./env";
import { logger } from "./logger";

export interface OrderReference {
  orderNumber: string | null;
  shopifyOrderId: string | null;
  extractionMethod: "regex" | "ai" | "none";
}

export interface SimilarResolvedTicket {
  ticketId: string;
  similarity: number;
  intentLabel: IntentLabel;
  recommendedAction: ResolutionActionType;
  responseDraft: string;
  reasoning: string;
}

export interface CustomerOrderSummary {
  orderId: string;
  shopifyOrderId: string;
  orderNumber: string | null;
  createdAt: string;
  totalPrice: string;
  fulfillmentStatus: string | null;
  financialStatus: string | null;
  status: string | null;
}

export interface PreviousTicketSummary {
  ticketId: string;
  status: string;
  createdAt: string;
  intentLabel: IntentLabel | null;
  recommendedAction: ResolutionActionType | null;
}

export interface CustomerHistory {
  customerId: string | null;
  email: string | null;
  orderCount: number;
  totalSpent: string;
  orders: CustomerOrderSummary[];
  previousTickets: PreviousTicketSummary[];
}

export interface TicketThreadMessage {
  role: MessageAuthorRole;
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  createdAt: string;
}

export interface OrderContext {
  id: string;
  shopifyOrderId: string;
  orderNumber: string | null;
  email: string | null;
  currencyCode: string;
  totalPrice: string;
  subtotalPrice: string | null;
  totalRefunded: string | null;
  fulfillmentStatus: string | null;
  financialStatus: string | null;
  status: string | null;
  lineItemsJson: unknown;
  shippingAddressJson: unknown;
  billingAddressJson: unknown;
}

export interface MerchantPolicyContext {
  merchantId: string;
  policyText: string;
  policyJson: unknown;
  brandVoice: unknown;
  escalationThreshold: number;
}

export interface ResolutionAgentContext {
  merchantId: string;
  ticketId: string;
  customerEmail: string | null;
  customerName: string | null;
  subject: string | null;
  ticketText: string;
  thread: TicketThreadMessage[];
  order: OrderContext | null;
  customerHistory: CustomerHistory;
  policy: MerchantPolicyContext;
  similarTickets: SimilarResolvedTicket[];
}

export interface IntentClassification {
  intentLabel: IntentLabel;
  confidenceScore: number;
  rationale: string;
}

export interface ResolutionOutput {
  intentLabel: IntentLabel;
  confidenceScore: number;
  responseDraft: string;
  recommendedAction: ResolutionActionType;
  recommendedActionPayload: Record<string, unknown>;
  reasoning: string;
  modelUsed: string;
  fallbackModelUsed: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

interface ResolutionDraft {
  responseDraft: string;
  recommendedAction: ResolutionActionType;
  recommendedActionPayload: Record<string, unknown>;
  reasoning: string;
  confidenceScore: number;
}

let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;

const getOpenAi = (): OpenAI => {
  if (!openai) {
    openai = new OpenAI({
      apiKey: aiEnv.openAiApiKey,
    });
  }

  return openai;
};

const getAnthropic = (): Anthropic | null => {
  if (!aiEnv.anthropicApiKey) {
    return null;
  }

  if (!anthropic) {
    anthropic = new Anthropic({
      apiKey: aiEnv.anthropicApiKey,
    });
  }

  return anthropic;
};

const INTENT_VALUES = Object.values(IntentLabel);
const ACTION_VALUES = Object.values(ResolutionActionType);

const clampConfidence = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
};

const normalizeIntent = (value: string): IntentLabel => {
  const normalized = value.trim().toUpperCase();

  if (INTENT_VALUES.includes(normalized as IntentLabel)) {
    return normalized as IntentLabel;
  }

  return IntentLabel.OTHER;
};

const normalizeAction = (value: string): ResolutionActionType => {
  const normalized = value.trim().toUpperCase();

  if (ACTION_VALUES.includes(normalized as ResolutionActionType)) {
    return normalized as ResolutionActionType;
  }

  return ResolutionActionType.ESCALATE;
};

const extractJsonObject = (value: string): string => {
  const codeFenceMatch = value.match(/```json\s*([\s\S]*?)```/i);

  if (codeFenceMatch?.[1]) {
    return codeFenceMatch[1].trim();
  }

  const firstBrace = value.indexOf("{");
  const lastBrace = value.lastIndexOf("}");

  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return value.slice(firstBrace, lastBrace + 1);
  }

  throw new Error("Model response did not contain a JSON object.");
};

const parseJson = <T>(value: string): T => JSON.parse(extractJsonObject(value)) as T;

const buildTranscript = (messages: TicketThreadMessage[]): string =>
  messages
    .map(
      (message) =>
        `[${message.createdAt}] ${message.role} ${message.authorName ?? ""} ${message.authorEmail ?? ""}`.trim() +
        `\n${message.body}`,
    )
    .join("\n\n");

const buildContextPayload = (context: ResolutionAgentContext) => ({
  merchant_id: context.merchantId,
  ticket_id: context.ticketId,
  customer_email: context.customerEmail,
  customer_name: context.customerName,
  subject: context.subject,
  ticket_text: context.ticketText,
  thread_transcript: buildTranscript(context.thread),
  order: context.order,
  customer_history: context.customerHistory,
  policy: context.policy,
  similar_tickets: context.similarTickets,
});

const isRetryableOpenAiError = (error: unknown): boolean => {
  if (!(error instanceof OpenAI.APIError)) {
    return false;
  }

  return error.status === 429 || error.status >= 500;
};

const extractTextContent = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }

        if (typeof entry === "object" && entry !== null && "text" in entry) {
          return String((entry as { text?: unknown }).text ?? "");
        }

        return "";
      })
      .join("\n");
  }

  return "";
};

export const embedText = async (input: string): Promise<number[]> => {
  const response = await getOpenAi().embeddings.create({
    model: aiEnv.openAiEmbeddingModel,
    input,
  });

  return response.data[0]?.embedding ?? [];
};

export const extractOrderReference = async (
  ticketText: string,
): Promise<OrderReference> => {
  const orderIdMatch = ticketText.match(/gid:\/\/shopify\/Order\/(\d+)/i);

  if (orderIdMatch?.[1]) {
    return {
      orderNumber: null,
      shopifyOrderId: orderIdMatch[1],
      extractionMethod: "regex",
    };
  }

  const orderNumberMatch =
    ticketText.match(/(?:order|purchase)\s*(?:number|#|id)?\s*[:\-]?\s*#?(\d{4,})/i) ??
    ticketText.match(/#(\d{4,})\b/);

  if (orderNumberMatch?.[1]) {
    return {
      orderNumber: orderNumberMatch[1],
      shopifyOrderId: null,
      extractionMethod: "regex",
    };
  }

  const completion = await getOpenAi().chat.completions.create({
    model: aiEnv.openAiTicketModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract the Shopify order reference from the ticket text. Return JSON with keys orderNumber, shopifyOrderId, extractionMethod. Use null when missing.",
      },
      {
        role: "user",
        content: ticketText,
      },
    ],
  });

  const content = completion.choices[0]?.message.content;

  if (!content) {
    return {
      orderNumber: null,
      shopifyOrderId: null,
      extractionMethod: "none",
    };
  }

  const parsed = parseJson<{
    orderNumber?: string | null;
    shopifyOrderId?: string | null;
    extractionMethod?: string | null;
  }>(content);

  return {
    orderNumber: parsed.orderNumber ?? null,
    shopifyOrderId: parsed.shopifyOrderId ?? null,
    extractionMethod:
      parsed.extractionMethod === "ai" ||
      Boolean(parsed.orderNumber) ||
      Boolean(parsed.shopifyOrderId)
        ? "ai"
        : "none",
  };
};

export const classifyIntent = async ({
  ticketText,
  thread,
}: {
  ticketText: string;
  thread: TicketThreadMessage[];
}): Promise<IntentClassification> => {
  const response = await getOpenAi().chat.completions.create({
    model: aiEnv.openAiTicketModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Classify the complaint intent into exactly one of: ${INTENT_VALUES.join(
          ", ",
        )}. Return JSON with intentLabel, confidenceScore, rationale.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          ticket_text: ticketText,
          thread_transcript: buildTranscript(thread),
        }),
      },
    ],
  });

  const content = response.choices[0]?.message.content;

  if (!content) {
    throw new Error("Intent classification returned an empty response.");
  }

  const parsed = parseJson<{
    intentLabel: string;
    confidenceScore: number;
    rationale: string;
  }>(content);

  return {
    intentLabel: normalizeIntent(parsed.intentLabel),
    confidenceScore: clampConfidence(Number(parsed.confidenceScore)),
    rationale: parsed.rationale ?? "",
  };
};

const draftResolutionWithOpenAi = async ({
  context,
  intent,
}: {
  context: ResolutionAgentContext;
  intent: IntentClassification;
}): Promise<{
  draft: ResolutionDraft;
  inputTokens: number | null;
  outputTokens: number | null;
}> => {
  const response = await getOpenAi().chat.completions.create({
    model: aiEnv.openAiTicketModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "You are GrievanceGPT, an e-commerce complaint resolution copilot.",
          "Generate a supervisor-ready resolution draft for a human agent to approve.",
          "Follow merchant policy exactly, prefer the least costly compliant remedy, and escalate when the policy or evidence is ambiguous.",
          "Return JSON with keys responseDraft, recommendedAction, recommendedActionPayload, reasoning, confidenceScore.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          ...buildContextPayload(context),
          intent,
        }),
      },
    ],
  });

  const content = response.choices[0]?.message.content;

  if (!content) {
    throw new Error("Resolution generation returned an empty response.");
  }

  const parsed = parseJson<{
    responseDraft: string;
    recommendedAction: string;
    recommendedActionPayload?: Record<string, unknown>;
    reasoning: string;
    confidenceScore: number;
  }>(content);

  return {
    draft: {
      responseDraft: parsed.responseDraft,
      recommendedAction: normalizeAction(parsed.recommendedAction),
      recommendedActionPayload: parsed.recommendedActionPayload ?? {},
      reasoning: parsed.reasoning,
      confidenceScore: clampConfidence(Number(parsed.confidenceScore)),
    },
    inputTokens: response.usage?.prompt_tokens ?? null,
    outputTokens: response.usage?.completion_tokens ?? null,
  };
};

const draftResolutionWithAnthropic = async ({
  context,
  intent,
}: {
  context: ResolutionAgentContext;
  intent: IntentClassification;
}): Promise<{
  draft: ResolutionDraft;
  inputTokens: number | null;
  outputTokens: number | null;
}> => {
  const anthropicClient = getAnthropic();

  if (!anthropicClient) {
    throw new Error("Anthropic fallback is not configured.");
  }

  const response = await anthropicClient.messages.create({
    model: aiEnv.anthropicFallbackModel,
    max_tokens: 1_600,
    temperature: 0.2,
    system: [
      "You are GrievanceGPT, an e-commerce complaint resolution copilot.",
      "Generate a supervisor-ready resolution draft for a human agent to approve.",
      `Recommended actions must be one of: ${ACTION_VALUES.join(", ")}.`,
      "Return JSON with keys responseDraft, recommendedAction, recommendedActionPayload, reasoning, confidenceScore.",
    ].join(" "),
    messages: [
      {
        role: "user",
        content: JSON.stringify({
          ...buildContextPayload(context),
          intent,
        }),
      },
    ],
  });

  const content = response.content
    .map((block) => ("text" in block ? block.text : ""))
    .join("\n");
  const parsed = parseJson<{
    responseDraft: string;
    recommendedAction: string;
    recommendedActionPayload?: Record<string, unknown>;
    reasoning: string;
    confidenceScore: number;
  }>(content);

  return {
    draft: {
      responseDraft: parsed.responseDraft,
      recommendedAction: normalizeAction(parsed.recommendedAction),
      recommendedActionPayload: parsed.recommendedActionPayload ?? {},
      reasoning: parsed.reasoning,
      confidenceScore: clampConfidence(Number(parsed.confidenceScore)),
    },
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
};

const buildAgentTools = (): ChatCompletionTool[] => [
  {
    type: "function",
    function: {
      name: "classify_intent",
      description: "Classify the complaint intent for the ticket.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_order_details",
      description: "Retrieve the prepared Shopify order context for the ticket.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_history",
      description: "Retrieve the customer's order and ticket history.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_merchant_policy",
      description: "Retrieve the merchant policy and brand voice instructions.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_similar_tickets",
      description: "Retrieve similar previously resolved tickets for few-shot guidance.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_resolution",
      description:
        "Generate the final customer-facing draft and recommended action after reviewing the available context.",
      parameters: {
        type: "object",
        properties: {
          intentLabel: {
            type: "string",
            enum: INTENT_VALUES,
          },
        },
        required: ["intentLabel"],
        additionalProperties: false,
      },
    },
  },
];

export const runResolutionAgent = async (
  context: ResolutionAgentContext,
): Promise<ResolutionOutput> => {
  const startedAt = Date.now();
  let inputTokens = 0;
  let outputTokens = 0;
  let fallbackModelUsed: string | null = null;
  let cachedIntent: IntentClassification | null = null;

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: [
        "You are GrievanceGPT, a complaint resolution supervisor copilot.",
        "You must inspect the available context with tools, classify the intent, and then call generate_resolution to produce the final answer.",
        "Only approve policy-compliant actions. If policy or evidence is ambiguous, choose ESCALATE or REQUEST_INFO.",
        "Do not fabricate missing facts.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        merchant_id: context.merchantId,
        ticket_id: context.ticketId,
        subject: context.subject,
        customer_email: context.customerEmail,
        customer_name: context.customerName,
        ticket_text: context.ticketText,
      }),
    },
  ];

  const executeTool = async (
    name: string,
    rawArguments: string,
  ): Promise<Record<string, unknown>> => {
    switch (name) {
      case "classify_intent": {
        cachedIntent =
          cachedIntent ??
          (await classifyIntent({
            ticketText: context.ticketText,
            thread: context.thread,
          }));

        return { ...cachedIntent };
      }
      case "get_order_details":
        return { order: context.order };
      case "get_customer_history":
        return { customerHistory: context.customerHistory };
      case "get_merchant_policy":
        return { policy: context.policy };
      case "get_similar_tickets":
        return { similarTickets: context.similarTickets };
      case "generate_resolution": {
        const parsed = rawArguments ? parseJson<{ intentLabel: string }>(rawArguments) : { intentLabel: "OTHER" };
        const intent =
          cachedIntent ??
          ({
            intentLabel: normalizeIntent(parsed.intentLabel),
            confidenceScore: 0.5,
            rationale: "Intent provided by agent loop without prior classification.",
          } satisfies IntentClassification);

        const draft = await draftResolutionWithOpenAi({ context, intent });

        return {
          intentLabel: intent.intentLabel,
          confidenceScore: Math.max(
            intent.confidenceScore,
            draft.draft.confidenceScore,
          ),
          responseDraft: draft.draft.responseDraft,
          recommendedAction: draft.draft.recommendedAction,
          recommendedActionPayload: draft.draft.recommendedActionPayload,
          reasoning: draft.draft.reasoning,
          modelUsed: aiEnv.openAiTicketModel,
          fallbackModelUsed: null,
          inputTokens: draft.inputTokens,
          outputTokens: draft.outputTokens,
        };
      }
      default:
        throw new Error(`Unknown agent tool: ${name}`);
    }
  };

  try {
    for (let iteration = 0; iteration < 6; iteration += 1) {
      const response = await getOpenAi().chat.completions.create({
        model: aiEnv.openAiTicketModel,
        temperature: 0.1,
        tools: buildAgentTools(),
        tool_choice: "auto",
        messages,
      });

      inputTokens += response.usage?.prompt_tokens ?? 0;
      outputTokens += response.usage?.completion_tokens ?? 0;

      const message = response.choices[0]?.message;

      if (!message) {
        throw new Error("OpenAI agent loop returned no message.");
      }

      messages.push({
        role: "assistant",
        content: typeof message.content === "string" ? message.content : null,
        tool_calls: message.tool_calls,
      } satisfies ChatCompletionAssistantMessageParam);

      if (!message.tool_calls?.length) {
        const content = extractTextContent(message.content);
        const parsed = parseJson<ResolutionOutput>(content);

        return {
          ...parsed,
          intentLabel: normalizeIntent(parsed.intentLabel),
          recommendedAction: normalizeAction(parsed.recommendedAction),
          confidenceScore: clampConfidence(Number(parsed.confidenceScore)),
          modelUsed: aiEnv.openAiTicketModel,
          fallbackModelUsed,
          inputTokens,
          outputTokens,
          latencyMs: Date.now() - startedAt,
        };
      }

      for (const toolCall of message.tool_calls) {
        const toolResult = await executeTool(
          toolCall.function.name,
          toolCall.function.arguments,
        );

        if (toolCall.function.name === "generate_resolution") {
          return {
            intentLabel: normalizeIntent(String(toolResult.intentLabel)),
            confidenceScore: clampConfidence(Number(toolResult.confidenceScore)),
            responseDraft: String(toolResult.responseDraft),
            recommendedAction: normalizeAction(
              String(toolResult.recommendedAction),
            ),
            recommendedActionPayload:
              (toolResult.recommendedActionPayload as Record<string, unknown>) ?? {},
            reasoning: String(toolResult.reasoning),
            modelUsed: aiEnv.openAiTicketModel,
            fallbackModelUsed,
            inputTokens:
              inputTokens + (Number(toolResult.inputTokens ?? 0) || 0),
            outputTokens:
              outputTokens + (Number(toolResult.outputTokens ?? 0) || 0),
            latencyMs: Date.now() - startedAt,
          };
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        } satisfies ChatCompletionToolMessageParam);
      }
    }

    throw new Error("OpenAI agent loop exceeded maximum iterations.");
  } catch (error) {
    if (!isRetryableOpenAiError(error) || !getAnthropic()) {
      throw error;
    }

    logger.warn(
      {
        error,
        merchantId: context.merchantId,
        ticketId: context.ticketId,
      },
      "Primary OpenAI agent failed, falling back to Anthropic",
    );

    cachedIntent =
      cachedIntent ??
      ({
        intentLabel: IntentLabel.OTHER,
        confidenceScore: 0.5,
        rationale: "Fallback intent classification due to OpenAI retryable failure.",
      } satisfies IntentClassification);

    const draft = await draftResolutionWithAnthropic({
      context,
      intent: cachedIntent,
    });
    fallbackModelUsed = aiEnv.anthropicFallbackModel;

    return {
      intentLabel: cachedIntent.intentLabel,
      confidenceScore: Math.max(
        cachedIntent.confidenceScore,
        draft.draft.confidenceScore,
      ),
      responseDraft: draft.draft.responseDraft,
      recommendedAction: draft.draft.recommendedAction,
      recommendedActionPayload: draft.draft.recommendedActionPayload,
      reasoning: draft.draft.reasoning,
      modelUsed: aiEnv.openAiTicketModel,
      fallbackModelUsed,
      inputTokens: inputTokens + (draft.inputTokens ?? 0),
      outputTokens: outputTokens + (draft.outputTokens ?? 0),
      latencyMs: Date.now() - startedAt,
    };
  }
};
