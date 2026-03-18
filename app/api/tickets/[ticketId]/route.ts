import { MembershipRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../../../src/lib/access";
import { prisma } from "../../../../src/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { ticketId: string } },
): Promise<NextResponse> {
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

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: params.ticketId,
        merchantId: access.merchantId,
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
        order: true,
        resolution: true,
        outcomes: {
          orderBy: {
            recordedAt: "desc",
          },
        },
        merchant: {
          select: {
            id: true,
            name: true,
            planTier: true,
            policyText: true,
            policyJson: true,
          },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }

    return NextResponse.json({
      merchantId: access.merchantId,
      ticket: {
        ...ticket,
        order: ticket.order
          ? {
              ...ticket.order,
              totalPrice: ticket.order.totalPrice.toString(),
              subtotalPrice: ticket.order.subtotalPrice?.toString() ?? null,
              totalRefunded: ticket.order.totalRefunded?.toString() ?? null,
            }
          : null,
      },
    });
  } catch (error) {
    if (isAccessError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    throw error;
  }
}
