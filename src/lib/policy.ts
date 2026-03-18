import OpenAI from "openai";

import { aiEnv } from "./env";

let openai: OpenAI | null = null;

const getOpenAi = (): OpenAI => {
  if (!openai) {
    openai = new OpenAI({
      apiKey: aiEnv.openAiApiKey,
    });
  }

  return openai;
};

export interface ParsedMerchantPolicy {
  version: "v1";
  intents: Array<{
    intent: string;
    conditions: string[];
    defaultAction: string;
    customerMessageGuidance: string[];
  }>;
  escalationRules: string[];
  goodwillRules: string[];
  prohibitedActions: string[];
  brandVoice: {
    tone: string;
    styleNotes: string[];
    forbiddenPhrases: string[];
  };
  operationalNotes: string[];
}

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

  throw new Error("Policy parser did not return a JSON object.");
};

export const parseMerchantPolicy = async (
  policyText: string,
): Promise<ParsedMerchantPolicy> => {
  const response = await getOpenAi().chat.completions.create({
    model: aiEnv.openAiTicketModel,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: [
          "Convert merchant support policy text into structured JSON for an AI complaint resolution engine.",
          "Preserve meaning exactly.",
          "Do not invent thresholds or actions.",
          "Return JSON with keys: version, intents, escalationRules, goodwillRules, prohibitedActions, brandVoice, operationalNotes.",
          "Each intent item must include intent, conditions, defaultAction, customerMessageGuidance.",
        ].join(" "),
      },
      {
        role: "user",
        content: policyText,
      },
    ],
  });

  const content = response.choices[0]?.message.content;

  if (!content) {
    throw new Error("Policy parser returned an empty response.");
  }

  return JSON.parse(extractJsonObject(content)) as ParsedMerchantPolicy;
};
