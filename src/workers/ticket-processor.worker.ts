import crypto from "node:crypto";

import * as Sentry from "@sentry/node";
import { Job, Worker } from "bullmq";
import {
  IntentLabel,
  Prisma,
  ResolutionActionType,
  TicketStatus,
} from "@prisma/client";

import {
  CustomerHistory,
  OrderContext,
  ResolutionAgentContext,
  SimilarResolvedTicket,
  TicketThreadMessage,
  embedText,
  extractOrderReference,
  runResolutionAgent,
} from "../lib/ai";
import { sentryEnv } from "../lib/env";
import { fetchHelpdeskThread } from "../lib/helpdesk";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { TICKET_PROCESSING_QUEUE, TicketProcessingJob } from "../lib/queue";
import { getRedis } from "../lib/redis";
import {
  buildShopifyCustomerEmailSearchQuery,
  buildShopifyOrderNumberSearchQuery,
  fetchAndSyncShopifyOrderById,
  refreshShopifyCustomerHistory,
  searchAndSyncShopifyOrders,
} from "../lib/shopify-sync";

if (sentryEnv.dsn) {
  Sentry.init({
    dsn: sentryEnv.dsn,
    tracesSampleRate: 1,
    environment: process.env.NODE_ENV ?? "development",
  });
}

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};

const toOrderContext = (
  order: {
    id: string;
    shopifyOrderId: string;
    orderNumber: string | null;
    email: string | null;
    currencyCode: string;
    totalPrice: Prisma.Decimal;
    subtotalPrice: Prisma.Decimal | null;
    totalRefunded: Prisma.Decimal | null;
    fulfillmentStatus: string | null;
    financialStatus: string | null;
    status: string | null;
    lineItemsJson: Prisma.JsonValue;
    shippingAddressJson: Prisma.JsonValue | null;
    billingAddressJson: Prisma.JsonValue | null;
  } | null,
): OrderContext | null => {
  if (!order) {
    return null;
  }

  return {
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
    lineItemsJson: order.lineItemsJson,
    shippingAddressJson: order.shippingAddressJson,
    billingAddressJson: order.billingAddressJson,
  };
};

const transcriptFromMessages = (messages: TicketThreadMessage[]): string =>
  messages
    .map(
      (message) =>
        `[${message.createdAt}] ${message.role} ${message.authorName ?? ""} ${message.authorEmail ?? ""}`.trim() +
        `\n${message.body}`,
    )
    .join("\n\n");

const fetchShopifyOrder = async ({
  merchantId,
  orderReference,
  customerEmail,
}: {
  merchantId: string;
  orderReference: Awaited<ReturnType<typeof extractOrderReference>>;
  customerEmail: string | null;
}) => {
  const localByShopifyId =
    orderReference.shopifyOrderId &&
    (await prisma.order.findUnique({
      where: {
        merchantId_shopifyOrderId: {
          merchantId,
          shopifyOrderId: orderReference.shopifyOrderId,
        },
      },
    }));

  if (localByShopifyId) {
    return localByShopifyId;
  }

  const localByOrderNumber =
    orderReference.orderNumber &&
    (await prisma.order.findFirst({
      where: {
        merchantId,
        orderNumber: orderReference.orderNumber.replace(/^#/, ""),
      },
    }));

  if (localByOrderNumber) {
    return localByOrderNumber;
  }

  if (orderReference.shopifyOrderId) {
    return fetchAndSyncShopifyOrderById({
      merchantId,
      shopifyOrderId: orderReference.shopifyOrderId,
    });
  }

  if (orderReference.orderNumber) {
    const orders = await searchAndSyncShopifyOrders({
      merchantId,
      searchQuery: buildShopifyOrderNumberSearchQuery(orderReference.orderNumber),
      first: 1,
    });

    return orders[0] ?? null;
  }

  if (customerEmail) {
    const orders = await searchAndSyncShopifyOrders({
      merchantId,
      searchQuery: buildShopifyCustomerEmailSearchQuery(customerEmail),
      first: 1,
    });

    return orders[0] ?? null;
  }

  return null;
};

const buildCustomerHistory = async ({
  merchantId,
  ticketId,
  customerEmail,
  order,
}: {
  merchantId: string;
  ticketId: string;
  customerEmail: string | null;
  order: Awaited<ReturnType<typeof fetchShopifyOrder>>;
}): Promise<CustomerHistory> => {
  const customer = order?.customerId
    ? await prisma.customer.findFirst({
        where: {
          id: order.customerId,
          merchantId,
        },
      })
    : customerEmail
      ? await prisma.customer.findFirst({
          where: {
            merchantId,
            email: customerEmail,
          },
        })
      : null;

  if (customer?.shopifyCustomerId) {
    try {
      await refreshShopifyCustomerHistory({
        merchantId,
        shopifyCustomerId: customer.shopifyCustomerId,
        orderLimit: 10,
      });
    } catch (error) {
      logger.warn(
        { error, merchantId, customerId: customer.id },
        "Failed to refresh Shopify customer history, using local data",
      );
    }
  }

  const orders = await prisma.order.findMany({
    where: customer
      ? {
          merchantId,
          OR: [
            { customerId: customer.id },
            ...(customer.email ? [{ email: customer.email }] : []),
          ],
        }
      : customerEmail
        ? {
            merchantId,
            email: customerEmail,
          }
        : {
            merchantId,
            id: "__none__",
          },
    orderBy: {
      createdAt: "desc",
    },
    take: 10,
  });

  const previousTickets = await prisma.ticket.findMany({
    where:
      customerEmail || order?.id
        ? {
            merchantId,
            id: {
              not: ticketId,
            },
            OR: [
              ...(customerEmail ? [{ customerEmail }] : []),
              ...(order?.id ? [{ orderId: order.id }] : []),
            ],
          }
        : {
            merchantId,
            id: "__none__",
          },
    include: {
      resolution: {
        select: {
          intentLabel: true,
          recommendedAction: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 10,
  });

  return {
    customerId: customer?.id ?? null,
    email: customer?.email ?? customerEmail,
    orderCount: customer?.orderCount ?? orders.length,
    totalSpent: customer?.totalSpent.toString() ?? "0.00",
    orders: orders.map((entry) => ({
      orderId: entry.id,
      shopifyOrderId: entry.shopifyOrderId,
      orderNumber: entry.orderNumber,
      createdAt: entry.createdAt.toISOString(),
      totalPrice: entry.totalPrice.toString(),
      fulfillmentStatus: entry.fulfillmentStatus,
      financialStatus: entry.financialStatus,
      status: entry.status,
    })),
    previousTickets: previousTickets.map((entry) => ({
      ticketId: entry.id,
      status: entry.status,
      createdAt: entry.createdAt.toISOString(),
      intentLabel: entry.resolution?.intentLabel ?? null,
      recommendedAction: entry.resolution?.recommendedAction ?? null,
    })),
  };
};

type SimilarTicketRow = {
  ticketId: string;
  similarity: number;
  intentLabel: IntentLabel;
  recommendedAction: ResolutionActionType;
  responseDraft: string;
  reasoning: string;
};

const getSimilarResolvedTickets = async ({
  merchantId,
  ticketId,
  ticketText,
}: {
  merchantId: string;
  ticketId: string;
  ticketText: string;
}): Promise<SimilarResolvedTicket[]> => {
  if (!ticketText.trim()) {
    return [];
  }

  try {
    const embedding = await embedText(ticketText);

    if (!embedding.length) {
      return [];
    }

    const vectorLiteral = Prisma.raw(`'[${embedding.join(",")}]'::vector`);

    const rows = await prisma.$queryRaw<SimilarTicketRow[]>(Prisma.sql`
      SELECT
        te."ticketId" AS "ticketId",
        1 - (te."embedding" <=> ${vectorLiteral}) AS "similarity",
        ar."intentLabel" AS "intentLabel",
        ar."recommendedAction" AS "recommendedAction",
        ar."responseDraft" AS "responseDraft",
        ar."reasoning" AS "reasoning"
      FROM "TicketEmbedding" te
      INNER JOIN "AIResolution" ar ON ar."ticketId" = te."ticketId"
      WHERE te."merchantId" = ${merchantId}
        AND te."ticketId" <> ${ticketId}
      ORDER BY te."embedding" <=> ${vectorLiteral}
      LIMIT 3
    `);

    return rows.map((row) => ({
      ticketId: row.ticketId,
      similarity: Number(row.similarity),
      intentLabel: row.intentLabel,
      recommendedAction: row.recommendedAction,
      responseDraft: row.responseDraft,
      reasoning: row.reasoning,
    }));
  } catch (error) {
    logger.warn(
      { error, merchantId, ticketId },
      "Similar ticket retrieval failed, continuing without few-shot examples",
    );

    return [];
  }
};

const upsertTicketEmbedding = async ({
  merchantId,
  ticketId,
  content,
}: {
  merchantId: string;
  ticketId: string;
  content: string;
}): Promise<void> => {
  try {
    const embedding = await embedText(content);

    if (!embedding.length) {
      return;
    }

    const vectorLiteral = Prisma.raw(`'[${embedding.join(",")}]'::vector`);

    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "TicketEmbedding" (
        "id",
        "merchantId",
        "ticketId",
        "content",
        "embedding",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${crypto.randomUUID()},
        ${merchantId},
        ${ticketId},
        ${content},
        ${vectorLiteral},
        NOW(),
        NOW()
      )
      ON CONFLICT ("ticketId")
      DO UPDATE SET
        "content" = EXCLUDED."content",
        "embedding" = EXCLUDED."embedding",
        "updatedAt" = NOW()
    `);
  } catch (error) {
    logger.warn(
      { error, merchantId, ticketId },
      "Ticket embedding write failed, continuing without vector update",
    );
  }
};

const setTicketManualReview = async ({
  merchantId,
  ticketId,
  error,
}: {
  merchantId: string;
  ticketId: string;
  error: unknown;
}) => {
  const existing = await prisma.ticket.findFirst({
    where: {
      id: ticketId,
      merchantId,
    },
    select: {
      metadata: true,
    },
  });

  const metadata = toRecord(existing?.metadata);
  metadata.requiresManualHandling = true;
  metadata.lastProcessingError =
    error instanceof Error ? error.message : "Unknown processing error";

  await prisma.ticket.updateMany({
    where: {
      id: ticketId,
      merchantId,
    },
    data: {
      status: TicketStatus.READY_FOR_REVIEW,
      readyForReviewAt: new Date(),
      failedAt: new Date(),
      failureReason:
        error instanceof Error ? error.stack ?? error.message : String(error),
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
};

const processTicketJob = async (
  job: Job<TicketProcessingJob>,
): Promise<void> => {
  const startedAt = Date.now();
  const { merchantId, ticketId, helpdeskTicketId } = job.data;

  logger.info(
    {
      jobId: job.id,
      merchantId,
      ticketId,
      helpdeskTicketId,
    },
    "Starting ticket processing job",
  );

  try {
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        merchantId,
      },
      include: {
        merchant: {
          select: {
            id: true,
            policyText: true,
            policyJson: true,
            brandVoice: true,
            escalationThreshold: true,
          },
        },
      },
    });

    if (!ticket) {
      throw new Error(`Ticket ${ticketId} not found for merchant ${merchantId}`);
    }

    await prisma.ticket.updateMany({
      where: {
        id: ticketId,
        merchantId,
      },
      data: {
        status: TicketStatus.PROCESSING,
        processingStartedAt: new Date(),
        failureReason: null,
      },
    });

    const helpdeskThread = await fetchHelpdeskThread({
      merchantId,
      source: ticket.source,
      helpdeskTicketId,
    });

    await prisma.$transaction(async (tx) => {
      await tx.ticket.updateMany({
        where: {
          id: ticketId,
          merchantId,
        },
        data: {
          subject: helpdeskThread.subject,
          customerEmail: helpdeskThread.customerEmail,
          customerName: helpdeskThread.customerName,
          ticketText: transcriptFromMessages(
            helpdeskThread.messages.map((message) => ({
              role: message.role,
              authorName: message.authorName,
              authorEmail: message.authorEmail,
              body: message.body,
              createdAt: message.createdAt.toISOString(),
            })),
          ),
          latestMessageAt:
            helpdeskThread.messages[helpdeskThread.messages.length - 1]?.createdAt ??
            new Date(),
          metadata: helpdeskThread.rawPayload as Prisma.InputJsonValue,
        },
      });

      await tx.ticketMessage.deleteMany({
        where: {
          merchantId,
          ticketId,
        },
      });

      if (helpdeskThread.messages.length > 0) {
        await tx.ticketMessage.createMany({
          data: helpdeskThread.messages.map((message) => ({
            merchantId,
            ticketId,
            externalMessageId: message.externalMessageId,
            role: message.role,
            authorName: message.authorName,
            authorEmail: message.authorEmail,
            body: message.body,
            metadata: (message.metadata ?? {}) as Prisma.InputJsonValue,
            createdAt: message.createdAt,
          })),
        });
      }
    });

    const threadMessages: TicketThreadMessage[] = helpdeskThread.messages.map(
      (message) => ({
        role: message.role,
        authorName: message.authorName,
        authorEmail: message.authorEmail,
        body: message.body,
        createdAt: message.createdAt.toISOString(),
      }),
    );
    const ticketText = transcriptFromMessages(threadMessages);

    const orderReference = await extractOrderReference(ticketText).catch((error) => {
      logger.warn(
        { error, merchantId, ticketId },
        "Order extraction fallback failed, continuing without order reference",
      );

      return {
        orderNumber: null,
        shopifyOrderId: null,
        extractionMethod: "none" as const,
      };
    });

    const order = await fetchShopifyOrder({
      merchantId,
      orderReference,
      customerEmail: helpdeskThread.customerEmail,
    });

    const customerHistory = await buildCustomerHistory({
      merchantId,
      ticketId,
      customerEmail: helpdeskThread.customerEmail,
      order,
    });

    const similarTickets = await getSimilarResolvedTickets({
      merchantId,
      ticketId,
      ticketText,
    });

    const context: ResolutionAgentContext = {
      merchantId,
      ticketId,
      customerEmail: helpdeskThread.customerEmail,
      customerName: helpdeskThread.customerName,
      subject: helpdeskThread.subject,
      ticketText,
      thread: threadMessages,
      order: toOrderContext(order),
      customerHistory,
      policy: {
        merchantId: ticket.merchant.id,
        policyText: ticket.merchant.policyText,
        policyJson: ticket.merchant.policyJson,
        brandVoice: ticket.merchant.brandVoice,
        escalationThreshold: ticket.merchant.escalationThreshold,
      },
      similarTickets,
    };

    const resolution = await runResolutionAgent(context);
    const requiresMandatoryReview =
      resolution.confidenceScore < ticket.merchant.escalationThreshold;
    const existingMetadata: Record<string, unknown> = {
      ...toRecord(ticket.metadata),
      helpdesk: helpdeskThread.rawPayload,
    };

    existingMetadata.orderExtraction = orderReference;
    existingMetadata.requiresMandatoryReview = requiresMandatoryReview;
    existingMetadata.modelUsed = resolution.modelUsed;
    existingMetadata.fallbackModelUsed = resolution.fallbackModelUsed;

    await prisma.$transaction(async (tx) => {
      await tx.ticket.updateMany({
        where: {
          id: ticketId,
          merchantId,
        },
        data: {
          orderId: order?.id ?? null,
          status: TicketStatus.READY_FOR_REVIEW,
          readyForReviewAt: new Date(),
          metadata: existingMetadata as Prisma.InputJsonValue,
        },
      });

      const resolutionData = {
        merchantId,
        ticketId,
        intentLabel: resolution.intentLabel,
        confidenceScore: resolution.confidenceScore,
        responseDraft: resolution.responseDraft,
        recommendedAction: resolution.recommendedAction,
        recommendedActionPayload:
          resolution.recommendedActionPayload as Prisma.InputJsonValue,
        reasoning: resolution.reasoning,
        modelUsed: resolution.modelUsed,
        fallbackModelUsed: resolution.fallbackModelUsed,
        inputTokens: resolution.inputTokens,
        outputTokens: resolution.outputTokens,
        latencyMs: resolution.latencyMs,
        edited: false,
      } satisfies Prisma.AIResolutionUncheckedCreateInput;

      const existingResolution = await tx.aIResolution.findFirst({
        where: {
          merchantId,
          ticketId,
        },
        select: {
          id: true,
        },
      });

      if (existingResolution) {
        await tx.aIResolution.updateMany({
          where: {
            merchantId,
            ticketId,
          },
          data: {
            intentLabel: resolution.intentLabel,
            confidenceScore: resolution.confidenceScore,
            responseDraft: resolution.responseDraft,
            recommendedAction: resolution.recommendedAction,
            recommendedActionPayload:
              resolution.recommendedActionPayload as Prisma.InputJsonValue,
            reasoning: resolution.reasoning,
            modelUsed: resolution.modelUsed,
            fallbackModelUsed: resolution.fallbackModelUsed,
            inputTokens: resolution.inputTokens,
            outputTokens: resolution.outputTokens,
            latencyMs: resolution.latencyMs,
            edited: false,
          },
        });
      } else {
        await tx.aIResolution.create({
          data: resolutionData,
        });
      }
    });

    await upsertTicketEmbedding({
      merchantId,
      ticketId,
      content: ticketText,
    });

    logger.info(
      {
        merchantId,
        ticketId,
        helpdeskTicketId,
        modelUsed: resolution.modelUsed,
        fallbackModelUsed: resolution.fallbackModelUsed,
        confidenceScore: resolution.confidenceScore,
        intentLabel: resolution.intentLabel,
        recommendedAction: resolution.recommendedAction,
        latencyMs: Date.now() - startedAt,
        inputTokens: resolution.inputTokens,
        outputTokens: resolution.outputTokens,
      },
      "Ticket moved to ready_for_review and will fan out over Supabase Realtime via row updates",
    );
  } catch (error) {
    Sentry.captureException(error, {
      tags: {
        merchantId,
        ticketId,
      },
    });

    logger.error(
      {
        error,
        merchantId,
        ticketId,
        helpdeskTicketId,
      },
      "Ticket processing failed; routing ticket to manual review queue",
    );

    await setTicketManualReview({
      merchantId,
      ticketId,
      error,
    });
  }
};

export const ticketProcessingWorker = new Worker<TicketProcessingJob>(
  TICKET_PROCESSING_QUEUE,
  processTicketJob,
  {
    connection: getRedis() as unknown as import("bullmq").ConnectionOptions,
    concurrency: 8,
  },
);

ticketProcessingWorker.on("completed", (job) => {
  logger.info(
    {
      jobId: job.id,
      merchantId: job.data.merchantId,
      ticketId: job.data.ticketId,
    },
    "Ticket processing job completed",
  );
});

ticketProcessingWorker.on("failed", (job, error) => {
  logger.error(
    {
      error,
      jobId: job?.id,
      merchantId: job?.data.merchantId,
      ticketId: job?.data.ticketId,
    },
    "Ticket processing job failed",
  );
});

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Shutting down ticket processing worker");
  await ticketProcessingWorker.close();
  await prisma.$disconnect();
  await getRedis().quit();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
