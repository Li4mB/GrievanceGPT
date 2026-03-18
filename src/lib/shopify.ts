import crypto from "node:crypto";

import { appEnv, shopifyEnv } from "./env";
import { hmacSha256Base64, safeCompare } from "./security";

export interface ShopifyTokenResponse {
  access_token: string;
  scope: string;
}

export interface ShopifyShopResponse {
  shop: {
    id: string;
    name: string;
    email: string | null;
    domain: string;
    myshopify_domain: string;
    currency: string;
    iana_timezone: string;
  };
}

export interface ShopifyOrderApiResponse {
  order: ShopifyOrder;
}

export interface ShopifyOrdersApiResponse {
  orders: ShopifyOrder[];
}

export interface ShopifyCustomerApiResponse {
  customer: ShopifyCustomer;
}

export interface ShopifyOrder {
  id: number | string;
  name: string;
  email: string | null;
  created_at: string;
  updated_at: string;
  currency: string;
  current_total_price: string;
  subtotal_price: string | null;
  total_refunds: string | null;
  fulfillment_status: string | null;
  financial_status: string | null;
  cancelled_at: string | null;
  line_items: Array<Record<string, unknown>>;
  shipping_address: Record<string, unknown> | null;
  billing_address: Record<string, unknown> | null;
  customer: ShopifyCustomer | null;
}

export interface ShopifyCustomer {
  id: number | string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  orders_count: number;
  total_spent: string;
  default_address: Record<string, unknown> | null;
}

interface ShopifyGraphqlResponse<TData> {
  data?: TData;
  errors?: Array<{
    message: string;
  }>;
}

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const normalizeShopDomain = (input: string | null): string | null => {
  if (!input) {
    return null;
  }

  const value = input.trim().toLowerCase();

  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value) ? value : null;
};

export const buildShopifyGid = (
  resourceType: "Order" | "Customer",
  legacyResourceId: string,
): string => `gid://shopify/${resourceType}/${legacyResourceId}`;

export const extractLegacyResourceId = (
  gid: string,
  fallback?: string | number | null,
): string => {
  if (typeof fallback === "string" && fallback.trim().length > 0) {
    return fallback;
  }

  if (typeof fallback === "number") {
    return String(fallback);
  }

  const match = gid.match(/\/(\d+)$/);

  if (!match?.[1]) {
    throw new Error(`Unable to extract legacy resource id from ${gid}`);
  }

  return match[1];
};

export const getShopifyCallbackUrl = (): string =>
  new URL("/api/shopify/callback", appEnv.appUrl).toString();

export const buildShopifyAuthorizeUrl = ({
  shop,
  state,
}: {
  shop: string;
  state: string;
}): string => {
  const url = new URL(`https://${shop}/admin/oauth/authorize`);

  url.searchParams.set("client_id", shopifyEnv.apiKey);
  url.searchParams.set("scope", shopifyEnv.scopes);
  url.searchParams.set("redirect_uri", getShopifyCallbackUrl());
  url.searchParams.set("state", state);

  return url.toString();
};

export const verifyShopifyCallbackHmac = (
  searchParams: URLSearchParams,
): boolean => {
  const providedHmac = searchParams.get("hmac");

  if (!providedHmac) {
    return false;
  }

  const message = Array.from(searchParams.entries())
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }

      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", shopifyEnv.apiSecret)
    .update(message)
    .digest("hex");

  return safeCompare(digest, providedHmac);
};

export const verifyShopifyWebhookHmac = ({
  rawBody,
  providedSignature,
}: {
  rawBody: string;
  providedSignature: string | null;
}): boolean => {
  if (!providedSignature) {
    return false;
  }

  const expected = hmacSha256Base64(shopifyEnv.apiSecret, rawBody);

  return safeCompare(expected, providedSignature);
};

export const exchangeShopifyCodeForToken = async ({
  shop,
  code,
}: {
  shop: string;
  code: string;
}): Promise<ShopifyTokenResponse> => {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: shopifyEnv.apiKey,
      client_secret: shopifyEnv.apiSecret,
      code,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `Shopify token exchange failed with ${response.status}: ${responseText}`,
    );
  }

  return (await response.json()) as ShopifyTokenResponse;
};

const getRetryDelayMs = (attempt: number, retryAfterHeader: string | null) => {
  const retryAfterSeconds = Number(retryAfterHeader ?? "");

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  const baseDelay = Math.min(1000 * 2 ** attempt, 15_000);
  const jitter = Math.floor(Math.random() * 250);

  return baseDelay + jitter;
};

export const shopifyAdminRequest = async <TResponse>({
  shop,
  accessToken,
  path,
  method = "GET",
  body,
  maxRetries = 5,
}: {
  shop: string;
  accessToken: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  maxRetries?: number;
}): Promise<TResponse> => {
  const url = new URL(
    `/admin/api/${shopifyEnv.apiVersion}${path}`,
    `https://${shop}`,
  );

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.ok) {
      if (response.status === 204) {
        return undefined as TResponse;
      }

      return (await response.json()) as TResponse;
    }

    const retryable =
      response.status === 429 || response.status === 423 || response.status >= 500;

    if (!retryable || attempt === maxRetries) {
      const responseText = await response.text();
      throw new Error(
        `Shopify request failed for ${method} ${path} with ${response.status}: ${responseText}`,
      );
    }

    await sleep(getRetryDelayMs(attempt, response.headers.get("retry-after")));
  }

  throw new Error(`Shopify request exhausted retries for ${method} ${path}`);
};

export const shopifyAdminGraphqlRequest = async <TData>({
  shop,
  accessToken,
  query,
  variables,
  maxRetries = 5,
}: {
  shop: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
  maxRetries?: number;
}): Promise<TData> => {
  const url = new URL(
    `/admin/api/${shopifyEnv.apiVersion}/graphql.json`,
    `https://${shop}`,
  );

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    if (response.ok) {
      const payload = (await response.json()) as ShopifyGraphqlResponse<TData>;

      if (payload.errors?.length) {
        throw new Error(
          `Shopify GraphQL request failed: ${payload.errors
            .map((error) => error.message)
            .join("; ")}`,
        );
      }

      if (!payload.data) {
        throw new Error("Shopify GraphQL request returned no data.");
      }

      return payload.data;
    }

    const retryable =
      response.status === 429 || response.status === 423 || response.status >= 500;

    if (!retryable || attempt === maxRetries) {
      const responseText = await response.text();
      throw new Error(
        `Shopify GraphQL request failed with ${response.status}: ${responseText}`,
      );
    }

    await sleep(getRetryDelayMs(attempt, response.headers.get("retry-after")));
  }

  throw new Error("Shopify GraphQL request exhausted retries.");
};

export const fetchShopInfo = async ({
  shop,
  accessToken,
}: {
  shop: string;
  accessToken: string;
}): Promise<ShopifyShopResponse["shop"]> => {
  const response = await shopifyAdminGraphqlRequest<{
    shop: {
      id: string;
      name: string;
      email: string | null;
      myshopifyDomain: string;
      currencyCode: string;
      ianaTimezone: string;
      primaryDomain: {
        host: string;
      } | null;
    };
  }>({
    shop,
    accessToken,
    query: `
      query ShopInfo {
        shop {
          id
          name
          email
          myshopifyDomain
          currencyCode
          ianaTimezone
          primaryDomain {
            host
          }
        }
      }
    `,
  });

  return {
    id: response.shop.id,
    name: response.shop.name,
    email: response.shop.email,
    domain: response.shop.primaryDomain?.host ?? response.shop.myshopifyDomain,
    myshopify_domain: response.shop.myshopifyDomain,
    currency: response.shop.currencyCode,
    iana_timezone: response.shop.ianaTimezone,
  };
};
