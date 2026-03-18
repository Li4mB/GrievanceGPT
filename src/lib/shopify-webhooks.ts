import { IntegrationStatus, IntegrationType, Prisma } from "@prisma/client";

import { appEnv } from "./env";
import { logger } from "./logger";
import { prisma } from "./prisma";
import { normalizeShopDomain, shopifyAdminGraphqlRequest } from "./shopify";

export type ManagedShopifyWebhookTopic =
  | "APP_UNINSTALLED"
  | "ORDERS_CREATE"
  | "ORDERS_UPDATED"
  | "REFUNDS_CREATE";

export const MANAGED_SHOPIFY_WEBHOOK_TOPICS: ManagedShopifyWebhookTopic[] = [
  "APP_UNINSTALLED",
  "ORDERS_CREATE",
  "ORDERS_UPDATED",
  "REFUNDS_CREATE",
];

interface ShopifyWebhookSubscriptionNode {
  id: string;
  topic: string;
  uri: string | null;
}

interface ShopifyWebhookSubscriptionsQuery {
  webhookSubscriptions: {
    nodes: ShopifyWebhookSubscriptionNode[];
  };
}

interface ShopifyWebhookCreateMutation {
  webhookSubscriptionCreate: {
    webhookSubscription: ShopifyWebhookSubscriptionNode | null;
    userErrors: Array<{
      field: string[] | null;
      message: string;
    }>;
  };
}

const WEBHOOK_SUBSCRIPTIONS_QUERY = `
  query WebhookSubscriptions {
    webhookSubscriptions(first: 100) {
      nodes {
        id
        topic
        uri
      }
    }
  }
`;

const WEBHOOK_SUBSCRIPTION_CREATE_MUTATION = `
  mutation CreateWebhookSubscription(
    $topic: WebhookSubscriptionTopic!
    $webhookSubscription: WebhookSubscriptionInput!
  ) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: $webhookSubscription
    ) {
      webhookSubscription {
        id
        topic
        uri
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

export const getShopifyWebhookCallbackUrl = (): string =>
  new URL("/api/webhooks/shopify", appEnv.appUrl).toString();

export const ensureShopifyWebhookSubscriptions = async ({
  shop,
  accessToken,
}: {
  shop: string;
  accessToken: string;
}): Promise<{
  callbackUrl: string;
  existingTopics: ManagedShopifyWebhookTopic[];
  createdTopics: ManagedShopifyWebhookTopic[];
  subscriptions: ShopifyWebhookSubscriptionNode[];
}> => {
  const callbackUrl = getShopifyWebhookCallbackUrl();
  const existingResponse =
    await shopifyAdminGraphqlRequest<ShopifyWebhookSubscriptionsQuery>({
      shop,
      accessToken,
      query: WEBHOOK_SUBSCRIPTIONS_QUERY,
    });

  const matchingExistingTopics = new Set<ManagedShopifyWebhookTopic>();
  const matchingSubscriptions: ShopifyWebhookSubscriptionNode[] = [];

  for (const subscription of existingResponse.webhookSubscriptions.nodes) {
    const topic = subscription.topic as ManagedShopifyWebhookTopic;

    if (
      MANAGED_SHOPIFY_WEBHOOK_TOPICS.includes(topic) &&
      subscription.uri === callbackUrl
    ) {
      matchingExistingTopics.add(topic);
      matchingSubscriptions.push(subscription);
    }
  }

  const createdTopics: ManagedShopifyWebhookTopic[] = [];

  for (const topic of MANAGED_SHOPIFY_WEBHOOK_TOPICS) {
    if (matchingExistingTopics.has(topic)) {
      continue;
    }

    const creationResponse =
      await shopifyAdminGraphqlRequest<ShopifyWebhookCreateMutation>({
        shop,
        accessToken,
        query: WEBHOOK_SUBSCRIPTION_CREATE_MUTATION,
        variables: {
          topic,
          webhookSubscription: {
            callbackUrl,
            format: "JSON",
          },
        },
      });

    if (creationResponse.webhookSubscriptionCreate.userErrors.length > 0) {
      throw new Error(
        creationResponse.webhookSubscriptionCreate.userErrors
          .map((error) => error.message)
          .join("; "),
      );
    }

    const subscription =
      creationResponse.webhookSubscriptionCreate.webhookSubscription;

    if (!subscription) {
      throw new Error(
        `Shopify did not return a webhook subscription for topic ${topic}.`,
      );
    }

    matchingSubscriptions.push(subscription);
    createdTopics.push(topic);
  }

  return {
    callbackUrl,
    existingTopics: MANAGED_SHOPIFY_WEBHOOK_TOPICS.filter((topic) =>
      matchingExistingTopics.has(topic),
    ),
    createdTopics,
    subscriptions: matchingSubscriptions.sort((left, right) =>
      left.topic.localeCompare(right.topic),
    ),
  };
};

export const markShopifyAppUninstalled = async (
  shopifyDomain: string,
): Promise<boolean> => {
  const normalizedDomain = normalizeShopDomain(shopifyDomain);

  if (!normalizedDomain) {
    return false;
  }

  const integration = await prisma.integrationConnection.findFirst({
    where: {
      type: IntegrationType.SHOPIFY,
      externalAccountId: normalizedDomain,
    },
    select: {
      id: true,
      merchantId: true,
      metadata: true,
    },
  });

  if (!integration) {
    return false;
  }

  const metadata = toRecord(integration.metadata);
  metadata.uninstalledAt = new Date().toISOString();

  await prisma.$transaction(async (tx) => {
    await tx.integrationConnection.update({
      where: {
        id: integration.id,
      },
      data: {
        status: IntegrationStatus.DISCONNECTED,
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        scopes: [],
        metadata: metadata as Prisma.InputJsonValue,
      },
    });

    await tx.merchant.update({
      where: {
        id: integration.merchantId,
      },
      data: {
        appInstalledAt: null,
      },
    });
  });

  logger.info(
    {
      merchantId: integration.merchantId,
      shopifyDomain: normalizedDomain,
    },
    "Marked Shopify app as uninstalled",
  );

  return true;
};
