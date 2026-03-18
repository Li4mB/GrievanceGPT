import {
  ComplianceRequestStatus,
  ComplianceRequestTopic,
  Prisma,
} from "@prisma/client";

import { logger } from "./logger";
import { prisma } from "./prisma";

const REDACTED_TEXT = "[redacted for Shopify privacy compliance]";
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface ShopifyComplianceCustomer {
  id?: number | string;
  email?: string | null;
  phone?: string | null;
}

interface ShopifyDataRequestPayload {
  shop_id?: number | string;
  shop_domain?: string;
  orders_requested?: Array<number | string>;
  customer?: ShopifyComplianceCustomer;
  data_request?: {
    id?: number | string;
  };
}

interface ShopifyCustomerRedactPayload {
  shop_id?: number | string;
  shop_domain?: string;
  orders_to_redact?: Array<number | string>;
  customer?: ShopifyComplianceCustomer;
}

interface ShopifyShopRedactPayload {
  shop_id?: number | string;
  shop_domain?: string;
}

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const toNullableString = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return null;
};

export const normalizeShopifyWebhookTopic = (topic: string): string =>
  topic.trim().toLowerCase();

export const isShopifyComplianceTopic = (topic: string): boolean =>
  [
    "customers/data_request",
    "customers/redact",
    "shop/redact",
  ].includes(normalizeShopifyWebhookTopic(topic));

const toComplianceRequestTopic = (
  topic: string,
): ComplianceRequestTopic | null => {
  switch (normalizeShopifyWebhookTopic(topic)) {
    case "customers/data_request":
      return ComplianceRequestTopic.CUSTOMERS_DATA_REQUEST;
    case "customers/redact":
      return ComplianceRequestTopic.CUSTOMERS_REDACT;
    case "shop/redact":
      return ComplianceRequestTopic.SHOP_REDACT;
    default:
      return null;
  }
};

const buildDuplicateRequestWhere = ({
  shopifyDomain,
  topic,
  shopifyDataRequestId,
  shopifyCustomerId,
}: {
  shopifyDomain: string;
  topic: ComplianceRequestTopic;
  shopifyDataRequestId: string | null;
  shopifyCustomerId: string | null;
}): Prisma.ComplianceRequestWhereInput => {
  if (shopifyDataRequestId) {
    return {
      shopifyDomain,
      topic,
      shopifyDataRequestId,
    };
  }

  const receivedAfter = new Date(Date.now() - DUPLICATE_WINDOW_MS);

  if (shopifyCustomerId) {
    return {
      shopifyDomain,
      topic,
      shopifyCustomerId,
      receivedAt: {
        gte: receivedAfter,
      },
    };
  }

  return {
    shopifyDomain,
    topic,
    receivedAt: {
      gte: receivedAfter,
    },
  };
};

const serializeJsonValue = (
  value: Prisma.JsonValue | undefined,
): Prisma.JsonValue => {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeJsonValue(entry)) as Prisma.JsonArray;
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeJsonValue(entry)]),
    ) as Prisma.JsonObject;
  }

  return value;
};

const compileCustomerDataRequest = async ({
  merchantId,
  shopifyCustomerId,
  customerEmail,
  requestedOrderIds,
}: {
  merchantId: string | null;
  shopifyCustomerId: string | null;
  customerEmail: string | null;
  requestedOrderIds: string[];
}): Promise<Prisma.InputJsonValue> => {
  if (!merchantId) {
    return {
      merchantFound: false,
      customerFound: false,
      orders: [],
      tickets: [],
      messages: [],
      resolutions: [],
      outcomes: [],
    };
  }

  const customer = await prisma.customer.findFirst({
    where: {
      merchantId,
      ...((shopifyCustomerId || customerEmail)
        ? {
            OR: [
              ...(shopifyCustomerId ? [{ shopifyCustomerId }] : []),
              ...(customerEmail ? [{ email: customerEmail }] : []),
            ],
          }
        : {
            id: "__none__",
          }),
    },
  });

  const orderLookupClauses = [
    ...(customer?.id ? [{ customerId: customer.id }] : []),
    ...(customerEmail ? [{ email: customerEmail }] : []),
    ...(requestedOrderIds.length > 0
      ? [{ shopifyOrderId: { in: requestedOrderIds } }]
      : []),
  ];

  const orders = await prisma.order.findMany({
    where: {
      merchantId,
      ...(orderLookupClauses.length > 0
        ? { OR: orderLookupClauses }
        : { id: "__none__" }),
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const orderIds = orders.map((order) => order.id);
  const ticketLookupClauses = [
    ...(customerEmail ? [{ customerEmail }] : []),
    ...(orderIds.length > 0 ? [{ orderId: { in: orderIds } }] : []),
  ];

  const tickets = await prisma.ticket.findMany({
    where: {
      merchantId,
      ...(ticketLookupClauses.length > 0
        ? { OR: ticketLookupClauses }
        : { id: "__none__" }),
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const ticketIds = tickets.map((ticket) => ticket.id);
  const [messages, resolutions, outcomes] = await Promise.all([
    prisma.ticketMessage.findMany({
      where: {
        merchantId,
        ...(ticketIds.length > 0 ? { ticketId: { in: ticketIds } } : { id: "__none__" }),
      },
      orderBy: {
        createdAt: "asc",
      },
    }),
    prisma.aIResolution.findMany({
      where: {
        merchantId,
        ...(ticketIds.length > 0 ? { ticketId: { in: ticketIds } } : { id: "__none__" }),
      },
      orderBy: {
        createdAt: "desc",
      },
    }),
    prisma.outcome.findMany({
      where: {
        merchantId,
        ...(ticketIds.length > 0 ? { ticketId: { in: ticketIds } } : { id: "__none__" }),
      },
      orderBy: {
        recordedAt: "desc",
      },
    }),
  ]);

  return {
    merchantFound: true,
    customerFound: Boolean(customer),
    customer: customer
      ? {
          id: customer.id,
          shopifyCustomerId: customer.shopifyCustomerId,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          phone: customer.phone,
          orderCount: customer.orderCount,
          totalSpent: customer.totalSpent.toString(),
          defaultAddressJson: serializeJsonValue(
            customer.defaultAddressJson as Prisma.JsonValue,
          ),
          metadata: serializeJsonValue(customer.metadata as Prisma.JsonValue),
          createdAt: customer.createdAt.toISOString(),
          updatedAt: customer.updatedAt.toISOString(),
        }
      : null,
    orders: orders.map((order) => ({
      id: order.id,
      shopifyOrderId: order.shopifyOrderId,
      orderNumber: order.orderNumber,
      email: order.email,
      currencyCode: order.currencyCode,
      totalPrice: order.totalPrice.toString(),
      subtotalPrice: order.subtotalPrice?.toString() ?? null,
      totalRefunded: order.totalRefunded?.toString() ?? null,
      fulfillmentStatus: order.fulfillmentStatus,
      financialStatus: order.financialStatus,
      status: order.status,
      lineItemsJson: serializeJsonValue(order.lineItemsJson as Prisma.JsonValue),
      shippingAddressJson: serializeJsonValue(
        order.shippingAddressJson as Prisma.JsonValue,
      ),
      billingAddressJson: serializeJsonValue(
        order.billingAddressJson as Prisma.JsonValue,
      ),
      rawPayload: serializeJsonValue(order.rawPayload as Prisma.JsonValue),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    })),
    tickets: tickets.map((ticket) => ({
      id: ticket.id,
      helpdeskTicketId: ticket.helpdeskTicketId,
      source: ticket.source,
      subject: ticket.subject,
      customerEmail: ticket.customerEmail,
      customerName: ticket.customerName,
      orderId: ticket.orderId,
      status: ticket.status,
      ticketText: ticket.ticketText,
      summary: ticket.summary,
      latestMessageAt: ticket.latestMessageAt?.toISOString() ?? null,
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
      metadata: serializeJsonValue(ticket.metadata as Prisma.JsonValue),
    })),
    messages: messages.map((message) => ({
      id: message.id,
      ticketId: message.ticketId,
      externalMessageId: message.externalMessageId,
      role: message.role,
      authorName: message.authorName,
      authorEmail: message.authorEmail,
      body: message.body,
      metadata: serializeJsonValue(message.metadata as Prisma.JsonValue),
      createdAt: message.createdAt.toISOString(),
      insertedAt: message.insertedAt.toISOString(),
    })),
    resolutions: resolutions.map((resolution) => ({
      id: resolution.id,
      ticketId: resolution.ticketId,
      intentLabel: resolution.intentLabel,
      confidenceScore: resolution.confidenceScore,
      responseDraft: resolution.responseDraft,
      recommendedAction: resolution.recommendedAction,
      recommendedActionPayload: serializeJsonValue(
        resolution.recommendedActionPayload as Prisma.JsonValue,
      ),
      reasoning: resolution.reasoning,
      modelUsed: resolution.modelUsed,
      fallbackModelUsed: resolution.fallbackModelUsed,
      edited: resolution.edited,
      approvedAt: resolution.approvedAt?.toISOString() ?? null,
      createdAt: resolution.createdAt.toISOString(),
      updatedAt: resolution.updatedAt.toISOString(),
    })),
    outcomes: outcomes.map((outcome) => ({
      id: outcome.id,
      ticketId: outcome.ticketId,
      outcomeType: outcome.outcomeType,
      metadata: serializeJsonValue(outcome.metadata as Prisma.JsonValue),
      recordedAt: outcome.recordedAt.toISOString(),
    })),
  } satisfies Prisma.InputJsonValue;
};

const redactCustomerData = async ({
  merchantId,
  shopifyCustomerId,
  customerEmail,
  orderIdsToRedact,
}: {
  merchantId: string | null;
  shopifyCustomerId: string | null;
  customerEmail: string | null;
  orderIdsToRedact: string[];
}): Promise<Prisma.InputJsonValue> => {
  if (!merchantId) {
    return {
      merchantFound: false,
      customerRedacted: false,
      affectedOrders: 0,
      affectedTickets: 0,
      affectedMessages: 0,
      affectedResolutions: 0,
      deletedEmbeddings: 0,
    };
  }

  const customer = await prisma.customer.findFirst({
    where: {
      merchantId,
      ...((shopifyCustomerId || customerEmail)
        ? {
            OR: [
              ...(shopifyCustomerId ? [{ shopifyCustomerId }] : []),
              ...(customerEmail ? [{ email: customerEmail }] : []),
            ],
          }
        : {
            id: "__none__",
          }),
    },
    select: {
      id: true,
      email: true,
    },
  });

  const orderLookupClauses = [
    ...(customer?.id ? [{ customerId: customer.id }] : []),
    ...(customer?.email ? [{ email: customer.email }] : []),
    ...(orderIdsToRedact.length > 0
      ? [{ shopifyOrderId: { in: orderIdsToRedact } }]
      : []),
  ];

  const orders = await prisma.order.findMany({
    where: {
      merchantId,
      ...(orderLookupClauses.length > 0
        ? { OR: orderLookupClauses }
        : { id: "__none__" }),
    },
    select: {
      id: true,
      shopifyOrderId: true,
      orderNumber: true,
      currencyCode: true,
      totalPrice: true,
    },
  });

  const orderRecordIds = orders.map((order) => order.id);
  const ticketLookupClauses = [
    ...(customer?.email ? [{ customerEmail: customer.email }] : []),
    ...(orderRecordIds.length > 0 ? [{ orderId: { in: orderRecordIds } }] : []),
  ];

  const ticketIds = (
    await prisma.ticket.findMany({
      where: {
        merchantId,
        ...(ticketLookupClauses.length > 0
          ? { OR: ticketLookupClauses }
          : { id: "__none__" }),
      },
      select: {
        id: true,
      },
    })
  ).map((ticket) => ticket.id);

  const redactedAt = new Date().toISOString();

  const result = await prisma.$transaction(async (tx) => {
    if (customer?.id) {
      await tx.customer.update({
        where: {
          id: customer.id,
        },
        data: {
          email: null,
          firstName: null,
          lastName: null,
          phone: null,
          defaultAddressJson: Prisma.JsonNull,
          metadata: {
            redacted: true,
            redactedAt,
            source: "shopify_customers_redact",
          },
        },
      });
    }

    for (const order of orders) {
      await tx.order.update({
        where: {
          id: order.id,
        },
        data: {
          email: null,
          shippingAddressJson: Prisma.JsonNull,
          billingAddressJson: Prisma.JsonNull,
          rawPayload: {
            redacted: true,
            redactedAt,
            shopifyOrderId: order.shopifyOrderId,
            orderNumber: order.orderNumber,
            currencyCode: order.currencyCode,
            totalPrice: order.totalPrice.toString(),
          },
        },
      });
    }

    const affectedTickets = ticketIds.length
      ? await tx.ticket.updateMany({
          where: {
            merchantId,
            id: {
              in: ticketIds,
            },
          },
          data: {
            customerEmail: null,
            customerName: null,
            ticketText: REDACTED_TEXT,
            summary: REDACTED_TEXT,
            metadata: {
              redacted: true,
              redactedAt,
              source: "shopify_customers_redact",
            },
          },
        })
      : { count: 0 };

    const affectedMessages = ticketIds.length
      ? await tx.ticketMessage.updateMany({
          where: {
            merchantId,
            ticketId: {
              in: ticketIds,
            },
          },
          data: {
            authorName: null,
            authorEmail: null,
            body: REDACTED_TEXT,
            metadata: {
              redacted: true,
              redactedAt,
              source: "shopify_customers_redact",
            },
          },
        })
      : { count: 0 };

    const affectedResolutions = ticketIds.length
      ? await tx.aIResolution.updateMany({
          where: {
            merchantId,
            ticketId: {
              in: ticketIds,
            },
          },
          data: {
            responseDraft: REDACTED_TEXT,
            reasoning: REDACTED_TEXT,
            recommendedActionPayload: {
              redacted: true,
              redactedAt,
            },
          },
        })
      : { count: 0 };

    const deletedEmbeddings = ticketIds.length
      ? await tx.ticketEmbedding.deleteMany({
          where: {
            merchantId,
            ticketId: {
              in: ticketIds,
            },
          },
        })
      : { count: 0 };

    return {
      customerRedacted: Boolean(customer?.id),
      affectedOrders: orders.length,
      affectedTickets: affectedTickets.count,
      affectedMessages: affectedMessages.count,
      affectedResolutions: affectedResolutions.count,
      deletedEmbeddings: deletedEmbeddings.count,
    };
  });

  return {
    merchantFound: true,
    ...result,
  };
};

const redactShopData = async ({
  merchantId,
}: {
  merchantId: string | null;
}): Promise<Prisma.InputJsonValue> => {
  if (!merchantId) {
    return {
      merchantFound: false,
      deletedMerchant: false,
    };
  }

  const merchant = await prisma.merchant.findUnique({
    where: {
      id: merchantId,
    },
    select: {
      id: true,
      _count: {
        select: {
          integrations: true,
          tickets: true,
          ticketMessages: true,
          resolutions: true,
          orders: true,
          customers: true,
          outcomes: true,
          usageRecords: true,
          ticketEmbeddings: true,
          complianceRequests: true,
        },
      },
    },
  });

  if (!merchant) {
    return {
      merchantFound: false,
      deletedMerchant: false,
    };
  }

  await prisma.merchant.delete({
    where: {
      id: merchant.id,
    },
  });

  return {
    merchantFound: true,
    deletedMerchant: true,
    deletedMerchantId: merchant.id,
    deletedCounts: merchant._count,
  };
};

export const handleShopifyComplianceWebhook = async ({
  topic,
  shopifyDomain,
  payload,
}: {
  topic: string;
  shopifyDomain: string;
  payload: Record<string, unknown>;
}) => {
  const complianceTopic = toComplianceRequestTopic(topic);

  if (!complianceTopic) {
    return null;
  }

  const merchant = await prisma.merchant.findUnique({
    where: {
      shopifyDomain,
    },
    select: {
      id: true,
    },
  });

  const customerPayload = toRecord(payload.customer);
  const shopifyCustomerId = toNullableString(customerPayload.id);
  const customerEmail = toNullableString(customerPayload.email);
  const shopifyDataRequestId = toNullableString(
    toRecord(payload.data_request).id,
  );

  const existingRequest = await prisma.complianceRequest.findFirst({
    where: buildDuplicateRequestWhere({
      shopifyDomain,
      topic: complianceTopic,
      shopifyDataRequestId,
      shopifyCustomerId,
    }),
    orderBy: {
      receivedAt: "desc",
    },
  });

  if (
    existingRequest &&
    existingRequest.status !== ComplianceRequestStatus.FAILED
  ) {
    return existingRequest;
  }

  const request = await prisma.complianceRequest.create({
    data: {
      merchantId: merchant?.id ?? null,
      shopifyDomain,
      topic: complianceTopic,
      status: ComplianceRequestStatus.RECEIVED,
      shopifyShopId: toNullableString(payload.shop_id),
      shopifyCustomerId,
      shopifyDataRequestId,
      payload: payload as Prisma.InputJsonValue,
    },
  });

  await prisma.complianceRequest.update({
    where: {
      id: request.id,
    },
    data: {
      status: ComplianceRequestStatus.PROCESSING,
    },
  });

  try {
    let resultJson: Prisma.InputJsonValue;

    switch (complianceTopic) {
      case ComplianceRequestTopic.CUSTOMERS_DATA_REQUEST: {
        const dataRequestPayload = payload as ShopifyDataRequestPayload;
        resultJson = await compileCustomerDataRequest({
          merchantId: merchant?.id ?? null,
          shopifyCustomerId,
          customerEmail,
          requestedOrderIds: (dataRequestPayload.orders_requested ?? [])
            .map((value) => toNullableString(value))
            .filter((value): value is string => Boolean(value)),
        });
        break;
      }
      case ComplianceRequestTopic.CUSTOMERS_REDACT: {
        const redactPayload = payload as ShopifyCustomerRedactPayload;
        resultJson = await redactCustomerData({
          merchantId: merchant?.id ?? null,
          shopifyCustomerId,
          customerEmail,
          orderIdsToRedact: (redactPayload.orders_to_redact ?? [])
            .map((value) => toNullableString(value))
            .filter((value): value is string => Boolean(value)),
        });
        break;
      }
      case ComplianceRequestTopic.SHOP_REDACT: {
        const shopRedactPayload = payload as ShopifyShopRedactPayload;
        resultJson = await redactShopData({
          merchantId: merchant?.id ?? null,
        });

        if (shopRedactPayload.shop_id) {
          const base = resultJson as Record<string, unknown>;
          resultJson = {
            ...base,
            shopifyShopId: toNullableString(shopRedactPayload.shop_id),
          };
        }
        break;
      }
    }

    const completedRequest = await prisma.complianceRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: ComplianceRequestStatus.COMPLETED,
        resultJson,
        failureReason: null,
        processedAt: new Date(),
      },
    });

    logger.info(
      {
        complianceRequestId: completedRequest.id,
        merchantId: completedRequest.merchantId,
        shopifyDomain,
        topic: normalizeShopifyWebhookTopic(topic),
      },
      "Processed Shopify compliance webhook",
    );

    return completedRequest;
  } catch (error) {
    await prisma.complianceRequest.update({
      where: {
        id: request.id,
      },
      data: {
        status: ComplianceRequestStatus.FAILED,
        failureReason:
          error instanceof Error ? error.stack ?? error.message : String(error),
        processedAt: new Date(),
      },
    });

    logger.error(
      {
        error,
        complianceRequestId: request.id,
        merchantId: merchant?.id,
        shopifyDomain,
        topic: normalizeShopifyWebhookTopic(topic),
      },
      "Failed to process Shopify compliance webhook",
    );

    throw error;
  }
};
