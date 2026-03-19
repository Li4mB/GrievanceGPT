import crypto from "node:crypto";

import type { Prisma } from "@prisma/client";
import {
  IntegrationStatus,
  IntegrationType,
  MembershipRole,
  PlanTier,
} from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { logger } from "../../../../src/lib/logger";
import { prisma } from "../../../../src/lib/prisma";
import {
  exchangeShopifyCodeForToken,
  fetchShopInfo,
  normalizeShopDomain,
  verifyShopifyCallbackHmac,
} from "../../../../src/lib/shopify";
import { ensureShopifyWebhookSubscriptions } from "../../../../src/lib/shopify-webhooks";
import { encryptString, safeCompare, slugify } from "../../../../src/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOPIFY_OAUTH_STATE_COOKIE = "__grievance_shopify_oauth_state";
const SHOPIFY_OAUTH_SHOP_COOKIE = "__grievance_shopify_oauth_shop";

const classifyInstallationFailure = (error: unknown): string => {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (message.includes("token exchange")) {
    return "token_exchange_failed";
  }

  if (
    message.includes("shopify graphql request") ||
    message.includes("returned no data")
  ) {
    return "shop_info_fetch_failed";
  }

  if (message.includes("encryption_key")) {
    return "encryption_key_invalid";
  }

  if (
    message.includes("prisma") ||
    message.includes("database") ||
    message.includes("p1000") ||
    message.includes("prepared statement")
  ) {
    return "database_connection_failed";
  }

  return "installation_failed";
};

const buildShopifyIntegrationMetadata = ({
  shopDetails,
  extra,
}: {
  shopDetails: Awaited<ReturnType<typeof fetchShopInfo>>;
  extra?: Record<string, unknown>;
}) => ({
  shopId: shopDetails.id,
  shopName: shopDetails.name,
  primaryDomain: shopDetails.domain,
  myshopifyDomain: shopDetails.myshopify_domain,
  ...extra,
});

const generateUniqueMerchantSlug = async (
  tx: Prisma.TransactionClient,
  proposedName: string,
): Promise<string> => {
  const baseSlug = slugify(proposedName) || `merchant-${crypto.randomUUID().slice(0, 8)}`;
  let candidate = baseSlug;
  let suffix = 1;

  while (await tx.merchant.findUnique({ where: { slug: candidate } })) {
    candidate = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return candidate;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const shop = normalizeShopDomain(request.nextUrl.searchParams.get("shop"));
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const hmac = request.nextUrl.searchParams.get("hmac");
  const storedState = request.cookies.get(SHOPIFY_OAUTH_STATE_COOKIE)?.value;
  const storedShop = request.cookies.get(SHOPIFY_OAUTH_SHOP_COOKIE)?.value;

  if (!shop || !code || !state || !hmac) {
    return NextResponse.json(
      { error: "Shopify callback is missing required parameters." },
      { status: 400 },
    );
  }

  if (!storedState || !storedShop) {
    return NextResponse.json(
      { error: "Shopify OAuth session expired. Restart installation." },
      { status: 400 },
    );
  }

  if (!safeCompare(state, storedState) || !safeCompare(shop, storedShop)) {
    return NextResponse.json(
      { error: "Shopify OAuth state validation failed." },
      { status: 400 },
    );
  }

  if (!verifyShopifyCallbackHmac(request.nextUrl.searchParams)) {
    return NextResponse.json(
      { error: "Shopify callback HMAC validation failed." },
      { status: 400 },
    );
  }

  try {
    const tokenResponse = await exchangeShopifyCodeForToken({ shop, code });
    const accessTokenEncrypted = encryptString(tokenResponse.access_token);
    const shopDetails = await fetchShopInfo({
      shop,
      accessToken: tokenResponse.access_token,
    });

    const merchant = await prisma.$transaction(async (tx) => {
      const existingMerchant = await tx.merchant.findUnique({
        where: { shopifyDomain: shop },
      });

      const merchant =
        existingMerchant ??
        (await tx.merchant.create({
          data: {
            name: shopDetails.name,
            slug: await generateUniqueMerchantSlug(tx, shopDetails.name),
            shopifyDomain: shop,
            billingEmail: shopDetails.email,
            planTier: PlanTier.BETA,
            policyText: "",
            timezone: shopDetails.iana_timezone || "UTC",
            currencyCode: shopDetails.currency || "USD",
            appInstalledAt: new Date(),
          },
        }));

      const updatedMerchant = await tx.merchant.update({
        where: { id: merchant.id },
        data: {
          name: shopDetails.name,
          shopifyDomain: shop,
          billingEmail: shopDetails.email,
          timezone: shopDetails.iana_timezone || "UTC",
          currencyCode: shopDetails.currency || "USD",
          appInstalledAt: new Date(),
        },
      });

      if (shopDetails.email) {
        const ownerEmail = shopDetails.email.trim().toLowerCase();
        const ownerUser = await tx.user.upsert({
          where: {
            email: ownerEmail,
          },
          update: {
            name: shopDetails.name,
          },
          create: {
            email: ownerEmail,
            name: shopDetails.name,
          },
        });

        await tx.merchantMembership.upsert({
          where: {
            merchantId_userId: {
              merchantId: merchant.id,
              userId: ownerUser.id,
            },
          },
          update: {
            role: MembershipRole.OWNER,
          },
          create: {
            merchantId: merchant.id,
            userId: ownerUser.id,
            role: MembershipRole.OWNER,
          },
        });
      }

      await tx.integrationConnection.upsert({
        where: {
          merchantId_type: {
            merchantId: merchant.id,
            type: IntegrationType.SHOPIFY,
          },
        },
        update: {
          status: IntegrationStatus.PENDING,
          externalAccountId: shop,
          accessTokenEncrypted,
          scopes: tokenResponse.scope
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean),
          metadata: buildShopifyIntegrationMetadata({
            shopDetails,
          }),
          installedAt: new Date(),
        },
        create: {
          merchantId: merchant.id,
          type: IntegrationType.SHOPIFY,
          status: IntegrationStatus.PENDING,
          externalAccountId: shop,
          accessTokenEncrypted,
          scopes: tokenResponse.scope
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean),
          metadata: buildShopifyIntegrationMetadata({
            shopDetails,
          }),
          installedAt: new Date(),
        },
      });

      return updatedMerchant;
    });

    let installationStatus: "success" | "partial" = "success";
    let redirectIssue: string | null = null;

    try {
      const webhookState = await ensureShopifyWebhookSubscriptions({
        shop,
        accessToken: tokenResponse.access_token,
      });

      await prisma.integrationConnection.update({
        where: {
          merchantId_type: {
            merchantId: merchant.id,
            type: IntegrationType.SHOPIFY,
          },
        },
        data: {
          status: IntegrationStatus.ACTIVE,
          metadata: buildShopifyIntegrationMetadata({
            shopDetails,
            extra: {
              webhookCallbackUrl: webhookState.callbackUrl,
              webhookSubscriptions: webhookState.subscriptions,
              webhookEnsuredAt: new Date().toISOString(),
            },
          }),
          installedAt: new Date(),
        },
      });

      logger.info(
        {
          merchantId: merchant.id,
          shopifyDomain: shop,
          scopes: tokenResponse.scope,
          createdWebhookTopics: webhookState.createdTopics,
          existingWebhookTopics: webhookState.existingTopics,
        },
        "Shopify installation completed",
      );
    } catch (webhookError) {
      installationStatus = "partial";
      redirectIssue = "shopify_webhooks";

      await prisma.integrationConnection.update({
        where: {
          merchantId_type: {
            merchantId: merchant.id,
            type: IntegrationType.SHOPIFY,
          },
        },
        data: {
          status: IntegrationStatus.ERROR,
          metadata: buildShopifyIntegrationMetadata({
            shopDetails,
            extra: {
              installIssue: "webhook_subscription_failed",
              installIssueAt: new Date().toISOString(),
              installIssueMessage:
                webhookError instanceof Error
                  ? webhookError.message
                  : String(webhookError),
            },
          }),
        },
      });

      logger.error(
        {
          error: webhookError,
          merchantId: merchant.id,
          shopifyDomain: shop,
        },
        "Shopify installation completed with webhook provisioning failure",
      );
    }

    const redirectUrl = new URL("/onboarding", request.nextUrl.origin);
    redirectUrl.searchParams.set("shop", shop);
    redirectUrl.searchParams.set("installation", installationStatus);

    if (redirectIssue) {
      redirectUrl.searchParams.set("issue", redirectIssue);
    }

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(SHOPIFY_OAUTH_STATE_COOKIE);
    response.cookies.delete(SHOPIFY_OAUTH_SHOP_COOKIE);

    return response;
  } catch (error) {
    const errorRef = crypto.randomUUID().slice(0, 8);
    const redirectUrl = new URL("/onboarding", request.nextUrl.origin);
    redirectUrl.searchParams.set("installation", "failed");
    redirectUrl.searchParams.set("issue", classifyInstallationFailure(error));
    redirectUrl.searchParams.set("errorRef", errorRef);

    if (shop) {
      redirectUrl.searchParams.set("shop", shop);
    }

    logger.error(
      {
        error,
        errorRef,
        shopifyDomain: shop,
      },
      "Shopify installation failed",
    );

    const response = NextResponse.redirect(redirectUrl);
    response.cookies.delete(SHOPIFY_OAUTH_STATE_COOKIE);
    response.cookies.delete(SHOPIFY_OAUTH_SHOP_COOKIE);

    return response;
  }
}
