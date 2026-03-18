import { appEnv } from "./env";
import { hmacSha256Base64, hmacSha256Hex, safeCompare } from "./security";

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const toStringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const normalizeSignature = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  return value.replace(/^sha256=/i, "").trim();
};

export const normalizeGorgiasBaseUrl = (value: string): string =>
  value.endsWith("/") ? value.slice(0, -1) : value;

export const getGorgiasWebhookUrl = (merchantId: string): string =>
  new URL(`/api/webhooks/gorgias/${merchantId}`, appEnv.appUrl).toString();

export const extractGorgiasSignatureFromHeaders = (
  headers: Headers,
): string | null =>
  normalizeSignature(
    headers.get("x-gorgias-signature") ??
      headers.get("x-webhook-signature") ??
      headers.get("x-signature"),
  );

export const verifyGorgiasWebhookSignature = ({
  rawBody,
  providedSignature,
  secret,
}: {
  rawBody: string;
  providedSignature: string | null;
  secret: string;
}): boolean => {
  const signature = normalizeSignature(providedSignature);

  if (!signature) {
    return false;
  }

  const expectedHex = hmacSha256Hex(secret, rawBody);
  const expectedBase64 = hmacSha256Base64(secret, rawBody);

  return safeCompare(signature, expectedHex) || safeCompare(signature, expectedBase64);
};

export const extractGorgiasEventType = (payload: unknown): string | null => {
  const record = toRecord(payload);

  return (
    toStringValue(record.event) ??
    toStringValue(record.type) ??
    toStringValue(record.topic)
  );
};

export const extractGorgiasTicketId = (payload: unknown): string | null => {
  const record = toRecord(payload);
  const ticket = toRecord(record.ticket);
  const data = toRecord(record.data);
  const dataTicket = toRecord(data.ticket);

  return (
    toStringValue(ticket.id) ??
    toStringValue(dataTicket.id) ??
    toStringValue(record.ticket_id) ??
    toStringValue(data.ticket_id)
  );
};

export const extractGorgiasTicketSnapshot = (payload: unknown) => {
  const record = toRecord(payload);
  const ticket = toRecord(record.ticket);
  const data = toRecord(record.data);
  const dataTicket = toRecord(data.ticket);
  const candidate = Object.keys(ticket).length > 0 ? ticket : dataTicket;
  const customer = toRecord(candidate.customer);
  const fallbackCustomerName = [
    toStringValue(customer.first_name),
    toStringValue(customer.last_name),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return {
    subject:
      toStringValue(candidate.subject) ??
      toStringValue(candidate.title) ??
      toStringValue(record.subject),
    customerEmail:
      toStringValue(customer.email) ??
      toStringValue(candidate.customer_email) ??
      toStringValue(record.customer_email),
    customerName:
      toStringValue(customer.name) ??
      toStringValue(candidate.customer_name) ??
      (fallbackCustomerName || null),
  };
};
