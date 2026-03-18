import { NextRequest, NextResponse } from "next/server";

import {
  buildShopifyAuthorizeUrl,
  normalizeShopDomain,
} from "../../../../src/lib/shopify";
import { generateStateToken } from "../../../../src/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHOPIFY_OAUTH_STATE_COOKIE = "__grievance_shopify_oauth_state";
const SHOPIFY_OAUTH_SHOP_COOKIE = "__grievance_shopify_oauth_shop";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const shop = normalizeShopDomain(request.nextUrl.searchParams.get("shop"));

  if (!shop) {
    return NextResponse.json(
      { error: "A valid Shopify shop domain is required." },
      { status: 400 },
    );
  }

  const state = generateStateToken();
  const authorizationUrl = buildShopifyAuthorizeUrl({ shop, state });
  const response = NextResponse.redirect(authorizationUrl);
  const secure = process.env.NODE_ENV === "production";

  response.cookies.set({
    name: SHOPIFY_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });

  response.cookies.set({
    name: SHOPIFY_OAUTH_SHOP_COOKIE,
    value: shop,
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}
