import { MembershipRole } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../src/lib/access";
import { prisma } from "../../src/lib/prisma";
import { PolicyEditor } from "./policy-editor";

interface PolicyPageProps {
  searchParams: {
    merchantId?: string;
  };
}

export default async function PolicyPage({ searchParams }: PolicyPageProps) {
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
          <h1 style={{ color: "#0f172a" }}>Policy access failed</h1>
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
      policyText: true,
      policyJson: true,
      updatedAt: true,
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
          {merchant.name} policy engine
        </h1>
        <p
          style={{
            marginTop: 0,
            color: "#475569",
            lineHeight: 1.6,
          }}
        >
          {merchant.shopifyDomain} · Last updated {merchant.updatedAt.toISOString()}
        </p>

        <div style={{ marginTop: "1.5rem" }}>
          <PolicyEditor
            merchantId={merchant.id}
            initialPolicyText={merchant.policyText}
            initialPolicyJson={merchant.policyJson}
          />
        </div>
      </section>
    </main>
  );
}
