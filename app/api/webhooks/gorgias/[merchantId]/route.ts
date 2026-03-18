import { IntegrationType, Prisma, TicketSource, TicketStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import {
  extractGorgiasEventType,
  extractGorgiasSignatureFromHeaders,
  extractGorgiasTicketId,
  extractGorgiasTicketSnapshot,
  verifyGorgiasWebhookSignature,
} from "../../../../../src/lib/gorgias";
import { logger } from "../../../../../src/lib/logger";
import { prisma } from "../../../../../src/lib/prisma";
import { enqueueTicketProcessing } from "../../../../../src/lib/queue";
import { decryptString } from "../../../../../src/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: { merchantId: string } },
): Promise<NextResponse> {
  const rawBody = await request.text();
  const connection = await prisma.integrationConnection.findUnique({
    where: {
      merchantId_type: {
        merchantId: params.merchantId,
        type: IntegrationType.GORGIAS,
      },
    },
    select: {
      apiSecretEncrypted: true,
      status: true,
    },
  });

  if (!connection?.apiSecretEncrypted) {
    return NextResponse.json(
      { error: "Gorgias integration is not configured." },
      { status: 404 },
    );
  }

  const webhookSecret = decryptString(connection.apiSecretEncrypted);
  const providedSignature = extractGorgiasSignatureFromHeaders(request.headers);

  if (
    !verifyGorgiasWebhookSignature({
      rawBody,
      providedSignature,
      secret: webhookSecret,
    })
  ) {
    return NextResponse.json(
      { error: "Webhook signature verification failed." },
      { status: 401 },
    );
  }

  const payload = JSON.parse(rawBody) as Record<string, unknown>;
  const eventType = extractGorgiasEventType(payload);

  if (eventType && !eventType.toLowerCase().includes("ticket")) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const helpdeskTicketId = extractGorgiasTicketId(payload);

  if (!helpdeskTicketId) {
    return NextResponse.json(
      { error: "Webhook payload did not contain a ticket id." },
      { status: 400 },
    );
  }

  const snapshot = extractGorgiasTicketSnapshot(payload);
  const ticket = await prisma.ticket.upsert({
    where: {
      merchantId_source_helpdeskTicketId: {
        merchantId: params.merchantId,
        source: TicketSource.GORGIAS,
        helpdeskTicketId,
      },
    },
    update: {
      status: TicketStatus.PENDING,
      subject: snapshot.subject,
      customerEmail: snapshot.customerEmail,
      customerName: snapshot.customerName,
      metadata: payload as Prisma.InputJsonValue,
    },
    create: {
      merchantId: params.merchantId,
      helpdeskTicketId,
      source: TicketSource.GORGIAS,
      status: TicketStatus.PENDING,
      subject: snapshot.subject,
      customerEmail: snapshot.customerEmail,
      customerName: snapshot.customerName,
      metadata: payload as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  await enqueueTicketProcessing({
    merchantId: params.merchantId,
    ticketId: ticket.id,
    helpdeskTicketId,
  });

  logger.info(
    {
      merchantId: params.merchantId,
      helpdeskTicketId,
      ticketId: ticket.id,
      eventType,
    },
    "Accepted Gorgias webhook and enqueued ticket processing",
  );

  return NextResponse.json({
    received: true,
    ticketId: ticket.id,
  });
}
