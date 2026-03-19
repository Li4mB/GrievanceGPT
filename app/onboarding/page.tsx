import Link from "next/link";

import { prisma } from "../../src/lib/prisma";

interface OnboardingPageProps {
  searchParams: {
    errorRef?: string;
    installation?: string;
    issue?: string;
    shop?: string;
  };
}

const INSTALLATION_ISSUE_COPY: Record<string, string> = {
  database_connection_failed:
    "The Shopify approval succeeded, but GrievanceGPT could not write the merchant record to the database.",
  encryption_key_invalid:
    "The Shopify approval succeeded, but the server could not encrypt the Shopify token with the configured encryption key.",
  shop_info_fetch_failed:
    "The Shopify approval succeeded, but GrievanceGPT could not fetch the store profile from Shopify.",
  token_exchange_failed:
    "The Shopify callback reached GrievanceGPT, but exchanging the temporary Shopify code for an access token failed.",
  installation_failed:
    "The Shopify callback reached GrievanceGPT, but the installation could not be finalized.",
  shopify_webhooks:
    "The Shopify token and merchant record were saved, but webhook provisioning still needs attention.",
};

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const installationStatus = searchParams.installation ?? "success";
  const installationFailed = installationStatus === "failed";
  const installationPartial = installationStatus === "partial";
  const merchant =
    searchParams.shop && !installationFailed
      ? await prisma.merchant.findUnique({
          where: {
            shopifyDomain: searchParams.shop,
          },
          select: {
            id: true,
            name: true,
            billingEmail: true,
            shopifyDomain: true,
          },
        })
      : null;
  const issueCopy =
    INSTALLATION_ISSUE_COPY[searchParams.issue ?? ""] ??
    INSTALLATION_ISSUE_COPY.installation_failed;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background:
          "linear-gradient(145deg, #fff7ed 0%, #ffedd5 28%, #f8fafc 100%)",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <section
        style={{
          width: "min(760px, 100%)",
          padding: "2rem",
          borderRadius: "1.3rem",
          background: "rgba(255,255,255,0.96)",
          boxShadow: "0 24px 80px rgba(15, 23, 42, 0.12)",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: "0.85rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#9a3412",
          }}
        >
          Onboarding
        </p>
        <h1
          style={{
            marginTop: "0.8rem",
            marginBottom: "0.65rem",
            fontSize: "2.4rem",
            lineHeight: 1.05,
            color: "#0f172a",
          }}
        >
          {installationFailed
            ? "Shopify installation needs one fix."
            : installationPartial
            ? "Shopify installed with follow-up work required."
            : "Shopify installation completed."}
        </h1>
        <p
          style={{
            margin: 0,
            color: "#475569",
            lineHeight: 1.7,
          }}
        >
          {installationFailed
            ? issueCopy
            : `${merchant?.name ?? "Your store"} is now connected to GrievanceGPT. The store owner can sign in with ${
                merchant?.billingEmail ?? "the Shopify billing email"
              } to finish helpdesk setup and policy configuration.`}
        </p>

        {installationPartial ? (
          <div
            style={{
              marginTop: "1.25rem",
              padding: "1rem 1.1rem",
              borderRadius: "1rem",
              background: "#fff7ed",
              color: "#9a3412",
            }}
          >
            Webhook provisioning needs attention. The Shopify token and merchant
            record were saved, but the app still needs webhook subscription
            confirmation before it can process live events safely.
          </div>
        ) : null}

        {installationFailed ? (
          <div
            style={{
              marginTop: "1.25rem",
              padding: "1rem 1.1rem",
              borderRadius: "1rem",
              background: "#fef2f2",
              color: "#991b1b",
            }}
          >
            Failure code: {searchParams.issue ?? "installation_failed"}
            {searchParams.errorRef ? ` · Ref ${searchParams.errorRef}` : ""}
          </div>
        ) : null}

        <div
          style={{
            marginTop: "1.5rem",
            display: "grid",
            gap: "0.9rem",
            color: "#0f172a",
          }}
        >
          {installationFailed ? (
            <>
              <div>1. Fix the environment or integration issue shown above.</div>
              <div>2. Retry the Shopify install link.</div>
              <div>3. Return here and continue onboarding after install succeeds.</div>
            </>
          ) : (
            <>
              <div>1. Sign in with the Shopify owner email.</div>
              <div>2. Connect Gorgias from Settings so tickets can flow in.</div>
              <div>3. Write the plain-English resolution policy for the merchant.</div>
              <div>4. Run a test ticket and confirm the supervisor queue renders.</div>
            </>
          )}
        </div>

        <div
          style={{
            marginTop: "1.6rem",
            display: "flex",
            gap: "0.9rem",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/signin"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "180px",
              borderRadius: "0.95rem",
              padding: "0.95rem 1.1rem",
              background: "#0f172a",
              color: "#f8fafc",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Sign in
          </Link>

          <Link
            href="/dashboard"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "180px",
              borderRadius: "0.95rem",
              padding: "0.95rem 1.1rem",
              background: "#e2e8f0",
              color: "#0f172a",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Open dashboard
          </Link>
        </div>

        {merchant ? (
          <p
            style={{
              marginTop: "1.25rem",
              marginBottom: 0,
              color: "#64748b",
              lineHeight: 1.6,
            }}
          >
            Merchant ID: {merchant.id} · Shopify domain: {merchant.shopifyDomain}
          </p>
        ) : null}
      </section>
    </main>
  );
}
