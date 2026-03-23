import { MembershipRole } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../src/lib/access";
import { prisma } from "../../src/lib/prisma";
import { TestTicketForm } from "./test-ticket-form";

interface TestTicketPageProps {
  searchParams: {
    merchantId?: string;
  };
}

const formatOrderTotal = (totalPrice: string, currencyCode: string): string =>
  `${totalPrice} ${currencyCode}`;

export default async function TestTicketPage({
  searchParams,
}: TestTicketPageProps) {
  let merchantId: string;

  try {
    const access = await requireMerchantAccess({
      merchantId: searchParams.merchantId,
      allowedRoles: [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
        MembershipRole.AGENT,
      ],
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
          <h1 style={{ color: "#0f172a" }}>Test ticket access failed</h1>
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
      orders: {
        orderBy: {
          createdAt: "desc",
        },
        take: 6,
        select: {
          orderNumber: true,
          email: true,
          totalPrice: true,
          currencyCode: true,
          createdAt: true,
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
          Run an internal test ticket
        </h1>
        <p
          style={{
            marginTop: 0,
            color: "#475569",
            lineHeight: 1.6,
            maxWidth: "760px",
          }}
        >
          Use this for free end-to-end validation before Gorgias is connected.
          The ticket behaves like a real complaint inside GrievanceGPT, including
          Shopify order matching, policy reasoning, and supervisor review.
        </p>

        <div
          style={{
            marginTop: "1.5rem",
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "minmax(0, 2fr) minmax(280px, 1fr)",
            alignItems: "start",
          }}
        >
          <TestTicketForm merchantId={merchant.id} />

          <aside
            style={{
              borderRadius: "1.2rem",
              background: "rgba(255,255,255,0.96)",
              border: "1px solid rgba(148,163,184,0.2)",
              padding: "1.25rem",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: "0.6rem",
                color: "#0f172a",
              }}
            >
              Recent Shopify orders
            </h2>
            <p
              style={{
                marginTop: 0,
                color: "#475569",
                lineHeight: 1.6,
              }}
            >
              Copy one of these order numbers into the test form for a realistic
              resolution pass.
            </p>

            <div style={{ display: "grid", gap: "0.8rem" }}>
              {merchant.orders.map((order) => (
                <div
                  key={`${order.orderNumber ?? "unknown"}-${order.createdAt.toISOString()}`}
                  style={{
                    borderRadius: "0.95rem",
                    background: "#f8fafc",
                    padding: "0.85rem 0.95rem",
                    border: "1px solid rgba(226,232,240,0.9)",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#0f172a" }}>
                    {order.orderNumber ? `#${order.orderNumber}` : "No order number"}
                  </div>
                  <div
                    style={{
                      marginTop: "0.2rem",
                      color: "#475569",
                      fontSize: "0.92rem",
                    }}
                  >
                    {order.email ?? "No email"} ·{" "}
                    {formatOrderTotal(order.totalPrice.toString(), order.currencyCode)}
                  </div>
                </div>
              ))}

              {merchant.orders.length === 0 ? (
                <div style={{ color: "#64748b" }}>
                  No synced orders yet. You can still submit a test ticket without
                  an order number.
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}
