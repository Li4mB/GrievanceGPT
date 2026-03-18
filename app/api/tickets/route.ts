import { MembershipRole, TicketStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../../src/lib/access";
import { prisma } from "../../../src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const parseStatuses = (value: string | null): TicketStatus[] | undefined => {
  if (!value) {
    return undefined;
  }

  const entries = value
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean) as TicketStatus[];

  return entries.length > 0 ? entries : undefined;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const access = await requireMerchantAccess({
      merchantId: request.nextUrl.searchParams.get("merchantId"),
      allowedRoles: [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
        MembershipRole.AGENT,
        MembershipRole.VIEWER,
      ],
    });
    const statuses = parseStatuses(request.nextUrl.searchParams.get("status"));
    const limit = Math.min(
      100,
      Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? "25")),
    );

    const tickets = await prisma.ticket.findMany({
      where: {
        merchantId: access.merchantId,
        ...(statuses ? { status: { in: statuses } } : {}),
      },
      select: {
        id: true,
        helpdeskTicketId: true,
        source: true,
        subject: true,
        customerEmail: true,
        customerName: true,
        status: true,
        createdAt: true,
        latestMessageAt: true,
        readyForReviewAt: true,
        metadata: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            shopifyOrderId: true,
            totalPrice: true,
            currencyCode: true,
            fulfillmentStatus: true,
            financialStatus: true,
          },
        },
        resolution: {
          select: {
            intentLabel: true,
            confidenceScore: true,
            recommendedAction: true,
            edited: true,
            modelUsed: true,
            fallbackModelUsed: true,
          },
        },
      },
      orderBy: [{ latestMessageAt: "desc" }, { createdAt: "desc" }],
      take: limit,
    });

    return NextResponse.json({
      merchantId: access.merchantId,
      tickets: tickets.map((ticket) => ({
        ...ticket,
        order: ticket.order
          ? {
              ...ticket.order,
              totalPrice: ticket.order.totalPrice.toString(),
            }
          : null,
      })),
    });
  } catch (error) {
    if (isAccessError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
