import crypto from "node:crypto";

import { OutcomeType, PlanTier, Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";

import { prisma } from "./prisma";

type DatabaseExecutor = PrismaClient | Prisma.TransactionClient;

const USAGE_RATE_CENTS = 8;
const USAGE_MINIMUM_CENTS = 15_000;
const USAGE_CAP_CENTS = 80_000;
const ENTERPRISE_MONTHLY_CENTS = 150_000;

const getUtcBillingPeriod = (at: Date) => {
  const billingPeriodStart = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const billingPeriodEnd = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );

  return { billingPeriodStart, billingPeriodEnd };
};

const calculateAmountDueCents = (
  planTier: PlanTier,
  ticketsProcessed: number,
): number => {
  switch (planTier) {
    case PlanTier.BETA:
      return 0;
    case PlanTier.ENTERPRISE:
      return ENTERPRISE_MONTHLY_CENTS;
    case PlanTier.USAGE_BASED:
      return Math.min(
        USAGE_CAP_CENTS,
        Math.max(USAGE_MINIMUM_CENTS, ticketsProcessed * USAGE_RATE_CENTS),
      );
    default:
      return 0;
  }
};

export const recordResolvedTicketUsage = async ({
  db = prisma,
  merchantId,
  planTier,
  occurredAt = new Date(),
}: {
  db?: DatabaseExecutor;
  merchantId: string;
  planTier: PlanTier;
  occurredAt?: Date;
}): Promise<void> => {
  const { billingPeriodStart, billingPeriodEnd } = getUtcBillingPeriod(occurredAt);
  const planTierLiteral = Prisma.raw(`'${planTier}'::"PlanTier"`);
  const billingStatusLiteral = Prisma.raw(`'DRAFT'::"BillingStatus"`);

  await db.$executeRaw(Prisma.sql`
    INSERT INTO "UsageRecord" (
      "id",
      "merchantId",
      "billingPeriodStart",
      "billingPeriodEnd",
      "planTier",
      "ticketsProcessed",
      "amountDueCents",
      "status",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${crypto.randomUUID()},
      ${merchantId},
      ${billingPeriodStart},
      ${billingPeriodEnd},
      ${planTierLiteral},
      1,
      ${calculateAmountDueCents(planTier, 1)},
      ${billingStatusLiteral},
      NOW(),
      NOW()
    )
    ON CONFLICT ("merchantId", "billingPeriodStart", "billingPeriodEnd")
    DO UPDATE SET
      "ticketsProcessed" = "UsageRecord"."ticketsProcessed" + 1,
      "amountDueCents" = CASE
        WHEN "UsageRecord"."planTier" = 'BETA'::"PlanTier" THEN 0
        WHEN "UsageRecord"."planTier" = 'ENTERPRISE'::"PlanTier" THEN ${ENTERPRISE_MONTHLY_CENTS}
        ELSE LEAST(
          ${USAGE_CAP_CENTS},
          GREATEST(
            ${USAGE_MINIMUM_CENTS},
            ("UsageRecord"."ticketsProcessed" + 1) * ${USAGE_RATE_CENTS}
          )
        )
      END,
      "updatedAt" = NOW()
  `);
};

export const recordTicketOutcome = async ({
  db = prisma,
  merchantId,
  ticketId,
  outcomeType,
  metadata,
}: {
  db?: DatabaseExecutor;
  merchantId: string;
  ticketId: string;
  outcomeType: OutcomeType;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  await db.outcome.create({
    data: {
      merchantId,
      ticketId,
      outcomeType,
      metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
    },
  });
};
