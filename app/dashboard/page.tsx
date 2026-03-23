import { TicketStatus } from "@prisma/client";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authOptions } from "../../src/lib/auth";
import { prisma } from "../../src/lib/prisma";

interface DashboardPageProps {
  searchParams: {
    merchantId?: string;
  };
}

const formatCount = (value: number): string =>
  new Intl.NumberFormat("en-US").format(value);

const formatTimestamp = (value: Date | null | undefined): string =>
  value ? value.toISOString() : "Not yet";

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/signin");
  }

  const memberships = await prisma.merchantMembership.findMany({
    where: {
      userId: session.user.id,
    },
    include: {
      merchant: {
        select: {
          id: true,
          name: true,
          shopifyDomain: true,
          planTier: true,
          appInstalledAt: true,
          _count: {
            select: {
              tickets: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  const activeMembership =
    memberships.find(
      (membership) => membership.merchantId === searchParams.merchantId,
    ) ?? (memberships.length === 1 ? memberships[0] : null);

  const queueTickets = activeMembership
    ? await prisma.ticket.findMany({
        where: {
          merchantId: activeMembership.merchantId,
          status: {
            in: [
              TicketStatus.PENDING,
              TicketStatus.PROCESSING,
              TicketStatus.READY_FOR_REVIEW,
              TicketStatus.ESCALATED,
            ],
          },
        },
        select: {
          id: true,
          helpdeskTicketId: true,
          source: true,
          subject: true,
          customerEmail: true,
          customerName: true,
          status: true,
          latestMessageAt: true,
          createdAt: true,
          order: {
            select: {
              orderNumber: true,
              totalPrice: true,
              currencyCode: true,
              fulfillmentStatus: true,
            },
          },
          resolution: {
            select: {
              intentLabel: true,
              confidenceScore: true,
              recommendedAction: true,
            },
          },
        },
        orderBy: [{ latestMessageAt: "desc" }, { createdAt: "desc" }],
        take: 40,
      })
    : [];

  const queueStatusCounts = activeMembership
    ? Object.fromEntries(
        await Promise.all(
          [
            TicketStatus.PENDING,
            TicketStatus.PROCESSING,
            TicketStatus.READY_FOR_REVIEW,
            TicketStatus.ESCALATED,
          ].map(async (status) => [
            status,
            await prisma.ticket.count({
              where: {
                merchantId: activeMembership.merchantId,
                status,
              },
            }),
          ]),
        ),
      ) as Record<TicketStatus, number>
    : null;

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
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <div>
            <p
              style={{
                margin: 0,
                fontSize: "0.85rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#64748b",
              }}
            >
              Dashboard
            </p>
            <h1
              style={{
                marginTop: "0.65rem",
                marginBottom: "0.5rem",
                fontSize: "2.4rem",
                lineHeight: 1.05,
                color: "#0f172a",
              }}
            >
              Supervisor queue is live.
            </h1>
            <p
              style={{
                margin: 0,
                color: "#334155",
                lineHeight: 1.6,
                maxWidth: "760px",
              }}
            >
              Signed in as {session.user.email}. Pick a merchant to review its
              active queue, policy rules, and onboarding state.
            </p>
          </div>

          <Link
            href="/api/auth/signout"
            style={{
              color: "#0f172a",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            Sign out
          </Link>
        </header>

        <div
          style={{
            marginTop: "1.6rem",
            display: "flex",
            gap: "0.8rem",
            flexWrap: "wrap",
          }}
        >
          {memberships.map((membership) => {
            const isActive = membership.merchantId === activeMembership?.merchantId;

            return (
              <Link
                key={membership.id}
                href={`/dashboard?merchantId=${membership.merchantId}`}
                style={{
                  padding: "0.85rem 1rem",
                  borderRadius: "0.95rem",
                  textDecoration: "none",
                  background: isActive ? "#0f172a" : "rgba(255,255,255,0.9)",
                  color: isActive ? "#f8fafc" : "#0f172a",
                  border: "1px solid rgba(148,163,184,0.25)",
                  minWidth: "220px",
                }}
              >
                <div style={{ fontWeight: 700 }}>{membership.merchant.name}</div>
                <div
                  style={{
                    marginTop: "0.25rem",
                    fontSize: "0.9rem",
                    opacity: 0.8,
                  }}
                >
                  {membership.role} · {membership.merchant.planTier}
                </div>
              </Link>
            );
          })}
        </div>

        {!activeMembership ? (
          <article
            style={{
              marginTop: "1.5rem",
              borderRadius: "1.2rem",
              background: "rgba(255,255,255,0.96)",
              padding: "1.5rem",
              border: "1px solid rgba(148,163,184,0.2)",
            }}
          >
            <h2
              style={{
                marginTop: 0,
                marginBottom: "0.5rem",
                color: "#0f172a",
              }}
            >
              Choose a merchant
            </h2>
            <p
              style={{
                margin: 0,
                color: "#475569",
                lineHeight: 1.6,
              }}
            >
              Once a merchant is selected, this page becomes the live queue for
              pending, processing, ready-for-review, and escalated tickets.
            </p>
          </article>
        ) : (
          <>
            <section
              style={{
                marginTop: "1.5rem",
                display: "grid",
                gap: "1rem",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              {[
                {
                  label: "Pending",
                  status: TicketStatus.PENDING,
                  color: "#7c2d12",
                  background: "#ffedd5",
                },
                {
                  label: "Processing",
                  status: TicketStatus.PROCESSING,
                  color: "#1d4ed8",
                  background: "#dbeafe",
                },
                {
                  label: "Ready",
                  status: TicketStatus.READY_FOR_REVIEW,
                  color: "#047857",
                  background: "#d1fae5",
                },
                {
                  label: "Escalated",
                  status: TicketStatus.ESCALATED,
                  color: "#7c3aed",
                  background: "#ede9fe",
                },
              ].map((card) => (
                <article
                  key={card.status}
                  style={{
                    borderRadius: "1.15rem",
                    padding: "1rem 1.1rem",
                    background: card.background,
                  }}
                >
                  <div style={{ fontSize: "0.85rem", color: card.color }}>
                    {card.label}
                  </div>
                  <div
                    style={{
                      marginTop: "0.25rem",
                      fontSize: "1.75rem",
                      fontWeight: 700,
                      color: "#0f172a",
                    }}
                  >
                    {formatCount(queueStatusCounts?.[card.status] ?? 0)}
                  </div>
                </article>
              ))}
            </section>

            <section
              style={{
                marginTop: "1.5rem",
                display: "flex",
                justifyContent: "space-between",
                gap: "1rem",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div>
                <h2
                  style={{
                    marginTop: 0,
                    marginBottom: "0.35rem",
                    color: "#0f172a",
                  }}
                >
                  {activeMembership.merchant.name}
                </h2>
                <p
                  style={{
                    margin: 0,
                    color: "#475569",
                  }}
                >
                  {activeMembership.merchant.shopifyDomain} · Installed{" "}
                  {formatTimestamp(activeMembership.merchant.appInstalledAt)}
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "0.75rem",
                  flexWrap: "wrap",
                }}
              >
                <Link
                  href={`/policy?merchantId=${activeMembership.merchantId}`}
                  style={{
                    padding: "0.8rem 1rem",
                    borderRadius: "0.9rem",
                    background: "#0f172a",
                    color: "#f8fafc",
                    textDecoration: "none",
                    fontWeight: 700,
                  }}
                >
                  Open policy editor
                </Link>
                <Link
                  href={`/settings?merchantId=${activeMembership.merchantId}`}
                  style={{
                    padding: "0.8rem 1rem",
                    borderRadius: "0.9rem",
                    background: "#cbd5e1",
                    color: "#0f172a",
                    textDecoration: "none",
                    fontWeight: 700,
                  }}
                >
                  Open settings
                </Link>
                <Link
                  href={`/test-ticket?merchantId=${activeMembership.merchantId}`}
                  style={{
                    padding: "0.8rem 1rem",
                    borderRadius: "0.9rem",
                    background: "#dbeafe",
                    color: "#0f172a",
                    textDecoration: "none",
                    fontWeight: 700,
                  }}
                >
                  Run test ticket
                </Link>
                <Link
                  href={`/onboarding?shop=${activeMembership.merchant.shopifyDomain ?? ""}`}
                  style={{
                    padding: "0.8rem 1rem",
                    borderRadius: "0.9rem",
                    background: "#e2e8f0",
                    color: "#0f172a",
                    textDecoration: "none",
                    fontWeight: 700,
                  }}
                >
                  Open onboarding
                </Link>
              </div>
            </section>

            <section
              style={{
                marginTop: "1rem",
                borderRadius: "1.2rem",
                background: "rgba(255,255,255,0.96)",
                border: "1px solid rgba(148,163,184,0.2)",
                overflowX: "auto",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                  gap: "1rem",
                  minWidth: "920px",
                  padding: "1rem 1.2rem",
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                }}
              >
                <div>Ticket</div>
                <div>Customer</div>
                <div>Order</div>
                <div>AI</div>
                <div>Status</div>
              </div>

              {queueTickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/tickets/${ticket.id}?merchantId=${activeMembership.merchantId}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                    gap: "1rem",
                    minWidth: "920px",
                    padding: "1rem 1.2rem",
                    textDecoration: "none",
                    color: "#0f172a",
                    borderTop: "1px solid rgba(226,232,240,0.9)",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>
                      {ticket.subject ?? `Ticket ${ticket.helpdeskTicketId}`}
                    </div>
                    <div
                      style={{
                        marginTop: "0.25rem",
                        color: "#64748b",
                        fontSize: "0.9rem",
                      }}
                    >
                      {ticket.source} · {formatTimestamp(ticket.latestMessageAt)}
                    </div>
                  </div>
                  <div>
                    <div>{ticket.customerName ?? "Unknown customer"}</div>
                    <div
                      style={{
                        marginTop: "0.25rem",
                        color: "#64748b",
                        fontSize: "0.9rem",
                      }}
                    >
                      {ticket.customerEmail ?? "No email"}
                    </div>
                  </div>
                  <div>
                    <div>
                      {ticket.order?.orderNumber
                        ? `#${ticket.order.orderNumber}`
                        : "Not matched"}
                    </div>
                    <div
                      style={{
                        marginTop: "0.25rem",
                        color: "#64748b",
                        fontSize: "0.9rem",
                      }}
                    >
                      {ticket.order
                        ? `${ticket.order.totalPrice.toString()} ${ticket.order.currencyCode}`
                        : "No order context"}
                    </div>
                  </div>
                  <div>
                    <div>
                      {ticket.resolution?.recommendedAction ?? "Awaiting AI"}
                    </div>
                    <div
                      style={{
                        marginTop: "0.25rem",
                        color: "#64748b",
                        fontSize: "0.9rem",
                      }}
                    >
                      {ticket.resolution
                        ? `${ticket.resolution.intentLabel} · ${Math.round(
                            ticket.resolution.confidenceScore * 100,
                          )}%`
                        : "No resolution yet"}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700 }}>{ticket.status}</div>
                </Link>
              ))}

              {queueTickets.length === 0 ? (
                <div
                  style={{
                    padding: "1.2rem",
                    color: "#64748b",
                  }}
                >
                  No active queue items for this merchant right now.
                </div>
              ) : null}
            </section>
          </>
        )}
      </section>
    </main>
  );
}
