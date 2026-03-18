import {
  IntegrationType,
  MessageAuthorRole,
  TicketSource,
} from "@prisma/client";

import { logger } from "./logger";
import { prisma } from "./prisma";
import { decryptString } from "./security";

export interface HelpdeskMessage {
  externalMessageId: string | null;
  role: MessageAuthorRole;
  authorName: string | null;
  authorEmail: string | null;
  body: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface HelpdeskThread {
  subject: string | null;
  customerEmail: string | null;
  customerName: string | null;
  messages: HelpdeskMessage[];
  rawPayload: Record<string, unknown>;
}

export interface HelpdeskReplyResult {
  externalMessageId: string | null;
  rawPayload: Record<string, unknown>;
}

interface GorgiasMetadata {
  baseUrl: string;
  apiEmail: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const coerceDate = (value: unknown): Date => {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
};

const resolveMessageRole = (message: Record<string, unknown>): MessageAuthorRole => {
  const sender = asRecord(message.sender);

  if (message.from_agent === true || sender.role === "agent") {
    return MessageAuthorRole.AGENT;
  }

  if (sender.role === "system" || message.type === "system") {
    return MessageAuthorRole.SYSTEM;
  }

  return MessageAuthorRole.CUSTOMER;
};

const fetchJson = async <T>(url: string, headers: HeadersInit): Promise<T> => {
  const response = await fetch(url, { headers });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Helpdesk request failed with ${response.status}: ${responseText}`);
  }

  return (await response.json()) as T;
};

const requestJson = async <T>({
  url,
  method,
  headers,
  body,
}: {
  url: string;
  method: "POST" | "PUT";
  headers: HeadersInit;
  body: Record<string, unknown>;
}): Promise<T> => {
  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`Helpdesk request failed with ${response.status}: ${responseText}`);
  }

  return (await response.json()) as T;
};

const normalizeGorgiasBaseUrl = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

const getGorgiasHeaders = ({
  apiEmail,
  apiKey,
}: {
  apiEmail: string;
  apiKey: string;
}): HeadersInit => ({
  Authorization: `Basic ${Buffer.from(`${apiEmail}:${apiKey}`).toString("base64")}`,
  "Content-Type": "application/json",
  Accept: "application/json",
});

const getGorgiasConnection = async (merchantId: string) => {
  const connection = await prisma.integrationConnection.findUnique({
    where: {
      merchantId_type: {
        merchantId,
        type: IntegrationType.GORGIAS,
      },
    },
    select: {
      apiKeyEncrypted: true,
      metadata: true,
    },
  });

  if (!connection?.apiKeyEncrypted) {
    throw new Error(`Missing Gorgias credentials for merchant ${merchantId}`);
  }

  const metadata = asRecord(connection.metadata) as Partial<GorgiasMetadata>;

  if (!metadata.baseUrl || !metadata.apiEmail) {
    throw new Error(
      `Gorgias metadata is incomplete for merchant ${merchantId}. Expected baseUrl and apiEmail.`,
    );
  }

  const baseUrl = normalizeGorgiasBaseUrl(metadata.baseUrl);
  const apiKey = decryptString(connection.apiKeyEncrypted);
  const headers = getGorgiasHeaders({
    apiEmail: metadata.apiEmail,
    apiKey,
  });

  return {
    baseUrl,
    headers,
  };
};

const fetchGorgiasThread = async ({
  merchantId,
  ticketId,
}: {
  merchantId: string;
  ticketId: string;
}): Promise<HelpdeskThread> => {
  const { baseUrl, headers } = await getGorgiasConnection(merchantId);

  const ticketResponse = await fetchJson<Record<string, unknown>>(
    `${baseUrl}/tickets/${ticketId}`,
    headers,
  );
  const messageResponse = await fetchJson<Record<string, unknown>>(
    `${baseUrl}/tickets/${ticketId}/messages`,
    headers,
  );

  const ticket = asRecord(ticketResponse.data ?? ticketResponse.ticket ?? ticketResponse);
  const customer = asRecord(ticket.customer);
  const messagesPayload = asArray(
    messageResponse.data ?? messageResponse.messages ?? messageResponse,
  );
  const fallbackFullName = [asString(customer.first_name), asString(customer.last_name)]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  const derivedCustomerName =
    asString(customer.name) ??
    (fallbackFullName || asString(ticket.customer_name));

  const messages = messagesPayload
    .map((entry) => asRecord(entry))
    .map<HelpdeskMessage>((message) => {
      const sender = asRecord(message.sender);

      return {
        externalMessageId: asString(message.id),
        role: resolveMessageRole(message),
        authorName:
          asString(sender.name) ??
          asString(message.from_name) ??
          asString(message.sender_name),
        authorEmail:
          asString(sender.email) ??
          asString(message.from_email) ??
          asString(message.sender_email),
        body:
          asString(message.body_text) ??
          asString(message.body_plain) ??
          asString(message.body) ??
          "",
        createdAt: coerceDate(
          message.created_datetime ?? message.created_at ?? message.createdAt,
        ),
        metadata: message,
      };
    })
    .filter((message) => message.body.length > 0)
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

  return {
    subject: asString(ticket.subject),
    customerEmail:
      asString(customer.email) ??
      asString(ticket.customer_email) ??
      asString(ticket.email),
    customerName: derivedCustomerName,
    messages,
    rawPayload: {
      ticket,
      messages: messagesPayload,
    },
  };
};

const sendGorgiasReply = async ({
  merchantId,
  ticketId,
  message,
}: {
  merchantId: string;
  ticketId: string;
  message: string;
}): Promise<HelpdeskReplyResult> => {
  const { baseUrl, headers } = await getGorgiasConnection(merchantId);
  const response = await requestJson<Record<string, unknown>>({
    url: `${baseUrl}/tickets/${ticketId}/messages`,
    method: "POST",
    headers,
    body: {
      body_text: message,
      from_agent: true,
      public: true,
      source: "api",
    },
  });

  return {
    externalMessageId: asString(response.id),
    rawPayload: response,
  };
};

export const fetchHelpdeskThread = async ({
  merchantId,
  source,
  helpdeskTicketId,
}: {
  merchantId: string;
  source: TicketSource;
  helpdeskTicketId: string;
}): Promise<HelpdeskThread> => {
  logger.info(
    { merchantId, source, helpdeskTicketId },
    "Fetching helpdesk thread",
  );

  switch (source) {
    case TicketSource.GORGIAS:
      return fetchGorgiasThread({ merchantId, ticketId: helpdeskTicketId });
    case TicketSource.ZENDESK:
    case TicketSource.EMAIL:
    case TicketSource.SHOPIFY:
      throw new Error(`Ticket source ${source} is not enabled in Phase 1.`);
    default:
      throw new Error(`Unsupported ticket source: ${String(source)}`);
  }
};

export const sendHelpdeskReply = async ({
  merchantId,
  source,
  helpdeskTicketId,
  message,
}: {
  merchantId: string;
  source: TicketSource;
  helpdeskTicketId: string;
  message: string;
}): Promise<HelpdeskReplyResult> => {
  logger.info(
    { merchantId, source, helpdeskTicketId },
    "Sending helpdesk reply",
  );

  switch (source) {
    case TicketSource.GORGIAS:
      return sendGorgiasReply({
        merchantId,
        ticketId: helpdeskTicketId,
        message,
      });
    case TicketSource.ZENDESK:
    case TicketSource.EMAIL:
    case TicketSource.SHOPIFY:
      throw new Error(`Ticket source ${source} is not enabled in Phase 1.`);
    default:
      throw new Error(`Unsupported ticket source: ${String(source)}`);
  }
};
