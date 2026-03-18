import {
  MembershipRole,
  MessageAuthorRole,
  OutcomeType,
  Prisma,
  ResolutionActionType,
  TicketStatus,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../../../../src/lib/access";
import {
  recordResolvedTicketUsage,
  recordTicketOutcome,
} from "../../../../../src/lib/billing";
import { sendHelpdeskReply } from "../../../../../src/lib/helpdesk";
import { logger } from "../../../../../src/lib/logger";
import { prisma } from "../../../../../src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReviewAction = "approve" | "edit" | "escalate" | "reject";

const isReviewAction = (value: string): value is ReviewAction =>
  ["approve", "edit", "escalate", "reject"].includes(value);

const normalizeRecommendedAction = (
  value: string | undefined,
  fallback: ResolutionActionType,
): ResolutionActionType => {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toUpperCase();

  return Object.values(ResolutionActionType).includes(
    normalized as ResolutionActionType,
  )
    ? (normalized as ResolutionActionType)
    : fallback;
};

export async function POST(
  request: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      merchantId?: string;
      action?: string;
      responseDraft?: string;
      recommendedAction?: string;
      recommendedActionPayload?: Record<string, unknown>;
      note?: string;
    };

    if (!body.action || !isReviewAction(body.action)) {
      return NextResponse.json(
        { error: "A valid review action is required." },
        { status: 400 },
      );
    }

    const access = await requireMerchantAccess({
      merchantId: body.merchantId,
      allowedRoles: [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
        MembershipRole.AGENT,
      ],
    });
    const merchantId = access.merchantId;
    const action = body.action;

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: params.ticketId,
        merchantId,
      },
      include: {
        resolution: true,
        merchant: {
          select: {
            id: true,
            planTier: true,
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }

    if (
      (action === "approve" || action === "edit") &&
      !ticket.resolution
    ) {
      return NextResponse.json(
        { error: "Ticket does not have an AI resolution to approve." },
        { status: 409 },
      );
    }

    if (ticket.status === TicketStatus.SENT && action !== "reject") {
      return NextResponse.json({
        ticketId: ticket.id,
        status: ticket.status,
        alreadySent: true,
      });
    }

    if (action === "escalate") {
      await prisma.$transaction(async (tx) => {
        await tx.ticket.updateMany({
          where: {
            id: ticket.id,
            merchantId,
          },
          data: {
            status: TicketStatus.ESCALATED,
            failureReason: body.note ?? null,
          },
        });

        await recordTicketOutcome({
          db: tx,
          merchantId,
          ticketId: ticket.id,
          outcomeType: OutcomeType.ESCALATED,
          metadata: body.note ? { note: body.note } : undefined,
        });
      });

      return NextResponse.json({
        merchantId,
        ticketId: ticket.id,
        status: TicketStatus.ESCALATED,
      });
    }

    if (action === "reject") {
      await prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          merchantId,
        },
        data: {
          status: TicketStatus.REJECTED,
          failureReason: body.note ?? null,
        },
      });

      return NextResponse.json({
        merchantId,
        ticketId: ticket.id,
        status: TicketStatus.REJECTED,
      });
    }

    const responseDraft =
      body.responseDraft?.trim() || ticket.resolution!.responseDraft;
    const recommendedAction = normalizeRecommendedAction(
      body.recommendedAction,
      ticket.resolution!.recommendedAction,
    );
    const recommendedActionPayload =
      body.recommendedActionPayload ??
      (ticket.resolution!.recommendedActionPayload as Record<string, unknown> | null) ??
      {};
    const edited =
      action === "edit" ||
      responseDraft !== ticket.resolution!.responseDraft ||
      recommendedAction !== ticket.resolution!.recommendedAction;

    const reply = await sendHelpdeskReply({
      merchantId,
      source: ticket.source,
      helpdeskTicketId: ticket.helpdeskTicketId,
      message: responseDraft,
    });

    const resolvedStatus = TicketStatus.SENT;

    await prisma.$transaction(async (tx) => {
      await tx.ticket.updateMany({
        where: {
          id: ticket.id,
          merchantId,
        },
        data: {
          status: resolvedStatus,
          approvedAt: new Date(),
          sentAt: new Date(),
          failureReason: null,
        },
      });

      await tx.aIResolution.updateMany({
        where: {
          ticketId: ticket.id,
          merchantId,
        },
        data: {
          responseDraft,
          recommendedAction,
          recommendedActionPayload:
            recommendedActionPayload as Prisma.InputJsonValue,
          edited,
          approvedByUserId: access.userId,
          approvedAt: new Date(),
        },
      });

      await tx.ticketMessage.create({
        data: {
          merchantId,
          ticketId: ticket.id,
          externalMessageId: reply.externalMessageId,
          role: MessageAuthorRole.AI,
          authorName: "GrievanceGPT",
          authorEmail: null,
          body: responseDraft,
          metadata: reply.rawPayload as Prisma.InputJsonValue,
          createdAt: new Date(),
        },
      });

      await recordTicketOutcome({
        db: tx,
        merchantId,
        ticketId: ticket.id,
        outcomeType: edited ? OutcomeType.EDITED : OutcomeType.APPROVED,
        metadata: {
          recommendedAction,
          approvedByUserId: access.userId,
        },
      });

      await recordResolvedTicketUsage({
        db: tx,
        merchantId,
        planTier: ticket.merchant.planTier,
      });
    });

    logger.info(
      {
        merchantId,
        ticketId: ticket.id,
        action,
        edited,
        recommendedAction,
        approvedByUserId: access.userId,
      },
      "Supervisor review completed and reply sent",
    );

    return NextResponse.json({
      merchantId,
      ticketId: ticket.id,
      status: resolvedStatus,
      edited,
    });
  } catch (error) {
    if (isAccessError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
