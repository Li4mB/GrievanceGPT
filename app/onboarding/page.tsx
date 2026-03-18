import Link from "next/link";

import { prisma } from "../../src/lib/prisma";

interface OnboardingPageProps {
  searchParams: {
    installation?: string;
    issue?: string;
    shop?: string;
  };
}

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const merchant = searchParams.shop
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

  const installationStatus = searchParams.installation ?? "success";
  const installationPartial = installationStatus === "partial";

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
          {installationPartial
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
          {merchant?.name ?? "Your store"} is now connected to GrievanceGPT.
          The store owner can sign in with{" "}
          {merchant?.billingEmail ?? "the Shopify billing email"} to finish helpdesk
          setup and policy configuration.
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

        <div
          style={{
            marginTop: "1.5rem",
            display: "grid",
            gap: "0.9rem",
            color: "#0f172a",
          }}
        >
          <div>1. Sign in with the Shopify owner email.</div>
          <div>2. Connect Gorgias from Settings so tickets can flow in.</div>
          <div>3. Write the plain-English resolution policy for the merchant.</div>
          <div>4. Run a test ticket and confirm the supervisor queue renders.</div>
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
