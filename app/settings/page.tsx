import { IntegrationType, MembershipRole } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../src/lib/access";
import { prisma } from "../../src/lib/prisma";
import { GorgiasSettingsForm } from "./gorgias-settings-form";

interface SettingsPageProps {
  searchParams: {
    merchantId?: string;
  };
}

const formatTimestamp = (value: Date | null | undefined): string =>
  value ? value.toISOString() : "Not yet";

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  let merchantId: string;

  try {
    const access = await requireMerchantAccess({
      merchantId: searchParams.merchantId,
      allowedRoles: [MembershipRole.OWNER, MembershipRole.ADMIN],
    });
    merchantId = access.merchantId;
  } catch (error) {
    if (isAccessError(error) && error.status === 401) {
      redirect("/signin");
    }

    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <section>
          <h1 style={{ color: "#0f172a" }}>Settings access failed</h1>
          <p style={{ color: "#475569" }}>
            {isAccessError(error) ? error.message : "Unexpected error."}
          </p>
        </section>
      </main>
    );
  }

  const merchant = await prisma.merchant.findUnique({
    where: {
      id: merchantId,
    },
    select: {
      id: true,
      name: true,
      shopifyDomain: true,
      billingEmail: true,
      appInstalledAt: true,
      integrations: {
        where: {
          type: {
            in: [IntegrationType.SHOPIFY, IntegrationType.GORGIAS],
          },
        },
        select: {
          type: true,
          status: true,
          externalAccountId: true,
          metadata: true,
          installedAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!merchant) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "2rem",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <section>
          <h1 style={{ color: "#0f172a" }}>Merchant not found</h1>
        </section>
      </main>
    );
  }

  const shopifyConnection =
    merchant.integrations.find(
      (integration) => integration.type === IntegrationType.SHOPIFY,
    ) ?? null;
  const gorgiasConnection =
    merchant.integrations.find(
      (integration) => integration.type === IntegrationType.GORGIAS,
    ) ?? null;
  const gorgiasMetadata =
    gorgiasConnection?.metadata && typeof gorgiasConnection.metadata === "object"
      ? (gorgiasConnection.metadata as Record<string, unknown>)
      : {};

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "2rem",
        background:
          "linear-gradient(180deg, #f8fafc 0%, #eef2ff 50%, #f8fafc 100%)",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <section
        style={{
          maxWidth: "1180px",
          margin: "0 auto",
        }}
      >
        <Link
          href={`/dashboard?merchantId=${merchant.id}`}
          style={{
            color: "#475569",
            textDecoration: "none",
            fontWeight: 700,
          }}
        >
          ← Back to queue
        </Link>

        <h1
          style={{
            marginTop: "0.9rem",
            marginBottom: "0.5rem",
            fontSize: "2.2rem",
            color: "#0f172a",
          }}
        >
          {merchant.name} settings
        </h1>
        <p
          style={{
            marginTop: 0,
            color: "#475569",
            lineHeight: 1.6,
          }}
        >
          {merchant.shopifyDomain} · Billing email {merchant.billingEmail ?? "not set"}
        </p>

        <section
          style={{
            marginTop: "1.5rem",
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          }}
        >
          <article
            style={{
              borderRadius: "1.15rem",
              background: "rgba(255,255,255,0.96)",
              border: "1px solid rgba(148,163,184,0.2)",
              padding: "1.25rem",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: "0.65rem",
                color: "#0f172a",
              }}
            >
              Shopify app
            </h2>
            <div style={{ display: "grid", gap: "0.45rem", color: "#475569" }}>
              <div>Status: {shopifyConnection?.status ?? "PENDING"}</div>
              <div>Installed: {formatTimestamp(merchant.appInstalledAt)}</div>
              <div>
                Connection updated: {formatTimestamp(shopifyConnection?.updatedAt)}
              </div>
              <div>Shop domain: {merchant.shopifyDomain ?? "Not linked"}</div>
            </div>
          </article>

          <article
            style={{
              borderRadius: "1.15rem",
              background: "rgba(255,255,255,0.96)",
              border: "1px solid rgba(148,163,184,0.2)",
              padding: "1.25rem",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: "0.65rem",
                color: "#0f172a",
              }}
            >
              Helpdesk readiness
            </h2>
            <div style={{ display: "grid", gap: "0.45rem", color: "#475569" }}>
              <div>Status: {gorgiasConnection?.status ?? "PENDING"}</div>
              <div>Installed: {formatTimestamp(gorgiasConnection?.installedAt)}</div>
              <div>
                Base URL:{" "}
                {typeof gorgiasMetadata.baseUrl === "string"
                  ? gorgiasMetadata.baseUrl
                  : "Not configured"}
              </div>
              <div>
                API email:{" "}
                {typeof gorgiasMetadata.apiEmail === "string"
                  ? gorgiasMetadata.apiEmail
                  : "Not configured"}
              </div>
            </div>
          </article>
        </section>

        <div style={{ marginTop: "1.5rem" }}>
          <GorgiasSettingsForm
            merchantId={merchant.id}
            initialStatus={gorgiasConnection?.status ?? "PENDING"}
            initialBaseUrl={
              typeof gorgiasMetadata.baseUrl === "string"
                ? gorgiasMetadata.baseUrl
                : ""
            }
            initialApiEmail={
              typeof gorgiasMetadata.apiEmail === "string"
                ? gorgiasMetadata.apiEmail
                : ""
            }
            initialWebhookUrl={`${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/webhooks/gorgias/${merchant.id}`}
          />
        </div>
      </section>
    </main>
  );
}
