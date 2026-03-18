import { NextRequest, NextResponse } from "next/server";

import {
  handleShopifyComplianceWebhook,
  isShopifyComplianceTopic,
  normalizeShopifyWebhookTopic,
} from "../../../../src/lib/compliance";
import { logger } from "../../../../src/lib/logger";
import { prisma } from "../../../../src/lib/prisma";
import {
  fetchAndSyncShopifyOrderById,
  upsertOrderFromShopify,
} from "../../../../src/lib/shopify-sync";
import {
  ShopifyOrder,
  normalizeShopDomain,
  verifyShopifyWebhookHmac,
} from "../../../../src/lib/shopify";
import { markShopifyAppUninstalled } from "../../../../src/lib/shopify-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const extractRefundOrderId = (payload: Record<string, unknown>): string | null => {
  const orderId = payload.order_id;

  if (typeof orderId === "number") {
    return String(orderId);
  }

  if (typeof orderId === "string" && orderId.trim().length > 0) {
    return orderId;
  }

  return null;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();
  const shop = normalizeShopDomain(
    request.headers.get("x-shopify-shop-domain"),
  );
  const topicHeader = request.headers.get("x-shopify-topic");
  const hmac = request.headers.get("x-shopify-hmac-sha256");

  if (!shop || !topicHeader) {
    return NextResponse.json(
      { error: "Missing Shopify webhook headers." },
      { status: 400 },
    );
  }

  if (
    !verifyShopifyWebhookHmac({
      rawBody,
      providedSignature: hmac,
    })
  ) {
    return NextResponse.json(
      { error: "Shopify webhook signature verification failed." },
      { status: 401 },
    );
  }

  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Shopify webhook payload was not valid JSON." },
      { status: 400 },
    );
  }

  const topic = normalizeShopifyWebhookTopic(topicHeader);

  if (isShopifyComplianceTopic(topic)) {
    await handleShopifyComplianceWebhook({
      topic,
      shopifyDomain: shop,
      payload,
    });

    return NextResponse.json({ received: true });
  }

  if (topic === "app/uninstalled") {
    const uninstalled = await markShopifyAppUninstalled(shop);

    return NextResponse.json({
      received: true,
      processed: uninstalled,
    });
  }

  const merchant = await prisma.merchant.findUnique({
    where: {
      shopifyDomain: shop,
    },
    select: {
      id: true,
    },
  });

  if (!merchant) {
    logger.warn(
      {
        shopifyDomain: shop,
        topic,
      },
      "Ignoring Shopify webhook because merchant was not found",
    );

    return NextResponse.json({ received: true, ignored: true });
  }

  switch (topic) {
    case "orders/create":
    case "orders/updated": {
      await upsertOrderFromShopify({
        merchantId: merchant.id,
        order: payload as unknown as ShopifyOrder,
      });
      break;
    }
    case "refunds/create": {
      const orderId = extractRefundOrderId(payload);

      if (!orderId) {
        return NextResponse.json(
          { error: "Refund webhook payload did not contain an order_id." },
          { status: 400 },
        );
      }

      await fetchAndSyncShopifyOrderById({
        merchantId: merchant.id,
        shopifyOrderId: orderId,
      });
      break;
    }
    default:
      logger.info(
        {
          merchantId: merchant.id,
          shopifyDomain: shop,
          topic,
        },
        "Ignoring unsupported Shopify webhook topic",
      );

      return NextResponse.json({ received: true, ignored: true });
  }

  logger.info(
    {
      merchantId: merchant.id,
      shopifyDomain: shop,
      topic,
    },
    "Processed Shopify webhook",
  );

  return NextResponse.json({ received: true });
}
