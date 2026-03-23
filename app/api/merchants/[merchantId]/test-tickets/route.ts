import crypto from "node:crypto";

import {
  MembershipRole,
  MessageAuthorRole,
  Prisma,
  TicketSource,
  TicketStatus,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../../../../src/lib/access";
import { logger } from "../../../../../src/lib/logger";
import { prisma } from "../../../../../src/lib/prisma";
import { processTicketProcessingJob } from "../../../../../src/lib/ticket-processing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const normalizeOrderNumber = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().replace(/^#/, "");
  return normalized.length > 0 ? normalized : null;
};

const normalizeMessageBody = ({
  message,
  orderNumber,
}: {
  message: string;
  orderNumber: string | null;
}): string =>
  orderNumber
    ? `Order reference: #${orderNumber}\n\n${message.trim()}`
    : message.trim();

export async function POST(
  request: NextRequest,
  { params }: { params: { merchantId: string } },
): Promise<NextResponse> {
  try {
    await requireMerchantAccess({
      merchantId: params.merchantId,
      allowedRoles: [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
        MembershipRole.AGENT,
      ],
    });

    const body = (await request.json()) as {
      subject?: string;
      customerEmail?: string;
      customerName?: string;
      message?: string;
      orderNumber?: string;
    };

    const subject = body.subject?.trim() ?? "";
    const customerEmail = body.customerEmail?.trim().toLowerCase() ?? "";
    const customerName = body.customerName?.trim() || null;
    const orderNumber = normalizeOrderNumber(body.orderNumber);
    const message = body.message?.trim() ?? "";

    if (!subject) {
      return NextResponse.json(
        { error: "Ticket subject is required." },
        { status: 400 },
      );
    }

    if (!customerEmail || !customerEmail.includes("@")) {
      return NextResponse.json(
        { error: "A valid customer email is required." },
        { status: 400 },
      );
    }

    if (!message) {
      return NextResponse.json(
        { error: "Ticket message is required." },
        { status: 400 },
      );
    }

    const helpdeskTicketId = `internal-${crypto.randomUUID()}`;
    const createdAt = new Date();
    const normalizedMessage = normalizeMessageBody({
      message,
      orderNumber,
    });

    const ticket = await prisma.$transaction(async (tx) => {
      const createdTicket = await tx.ticket.create({
        data: {
          merchantId: params.merchantId,
          helpdeskTicketId,
          source: TicketSource.EMAIL,
          subject,
          customerEmail,
          customerName,
          status: TicketStatus.PENDING,
          ticketText: normalizedMessage,
          latestMessageAt: createdAt,
          metadata: {
            internalTestTicket: true,
            createdVia: "dashboard_test_ticket",
            orderNumberHint: orderNumber,
          } as Prisma.InputJsonValue,
        },
        select: {
          id: true,
        },
      });

      await tx.ticketMessage.create({
        data: {
          merchantId: params.merchantId,
          ticketId: createdTicket.id,
          externalMessageId: helpdeskTicketId,
          role: MessageAuthorRole.CUSTOMER,
          authorName: customerName,
          authorEmail: customerEmail,
          body: normalizedMessage,
          metadata: {
            internalTestTicket: true,
          } as Prisma.InputJsonValue,
          createdAt,
        },
      });

      return createdTicket;
    });

    await processTicketProcessingJob({
      merchantId: params.merchantId,
      ticketId: ticket.id,
      helpdeskTicketId,
    });

    const processedTicket = await prisma.ticket.findFirst({
      where: {
        id: ticket.id,
        merchantId: params.merchantId,
      },
      select: {
        id: true,
        status: true,
      },
    });

    logger.info(
      {
        merchantId: params.merchantId,
        ticketId: ticket.id,
        helpdeskTicketId,
      },
      "Internal test ticket created and processed",
    );

    return NextResponse.json({
      merchantId: params.merchantId,
      ticketId: ticket.id,
      status: processedTicket?.status ?? TicketStatus.PENDING,
    });
  } catch (error) {
    if (isAccessError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    logger.error(
      {
        error,
        merchantId: params.merchantId,
      },
      "Failed to create internal test ticket",
    );

    return NextResponse.json(
      { error: "Failed to create test ticket." },
      { status: 500 },
    );
  }
}
