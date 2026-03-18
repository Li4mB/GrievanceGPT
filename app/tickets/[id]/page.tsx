import { MembershipRole, TicketStatus } from "@prisma/client";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  isAccessError,
  requireMerchantAccess,
} from "../../../src/lib/access";
import { prisma } from "../../../src/lib/prisma";
import { ReviewPanel } from "./review-panel";

interface TicketDetailPageProps {
  params: {
    id: string;
  };
  searchParams: {
    merchantId?: string;
  };
}

const formatTimestamp = (value: Date | null | undefined): string =>
  value ? value.toISOString() : "Not yet";

export default async function TicketDetailPage({
  params,
  searchParams,
}: TicketDetailPageProps) {
  let merchantId: string;

  try {
    const access = await requireMerchantAccess({
      merchantId: searchParams.merchantId,
      allowedRoles: [
        MembershipRole.OWNER,
        MembershipRole.ADMIN,
        MembershipRole.AGENT,
        MembershipRole.VIEWER,
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
          <h1 style={{ color: "#0f172a" }}>Ticket access failed</h1>
          <p style={{ color: "#475569" }}>
            {isAccessError(error) ? error.message : "Unexpected error."}
          </p>
        </section>
      </main>
    );
  }

  const ticket = await prisma.ticket.findFirst({
    where: {
      id: params.id,
      merchantId,
    },
    include: {
      messages: {
        orderBy: {
          createdAt: "asc",
        },
      },
      order: true,
      resolution: true,
      outcomes: {
        orderBy: {
          recordedAt: "desc",
        },
      },
      merchant: {
        select: {
          id: true,
          name: true,
          policyText: true,
        },
      },
    },
  });

  if (!ticket) {
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
          <h1 style={{ color: "#0f172a" }}>Ticket not found</h1>
          <p style={{ color: "#475569" }}>
            No ticket matched that merchant and ticket id combination.
          </p>
        </section>
      </main>
    );
  }

  const reviewDisabled =
    ticket.status === TicketStatus.SENT ||
    ticket.status === TicketStatus.REJECTED;

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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div>
            <Link
              href={`/dashboard?merchantId=${merchantId}`}
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
                marginTop: "0.85rem",
                marginBottom: "0.5rem",
                fontSize: "2.2rem",
                color: "#0f172a",
              }}
            >
              {ticket.subject ?? `Ticket ${ticket.helpdeskTicketId}`}
            </h1>
            <p
              style={{
                margin: 0,
                color: "#475569",
              }}
            >
              {ticket.merchant.name} · {ticket.status} · Last message{" "}
              {formatTimestamp(ticket.latestMessageAt)}
            </p>
          </div>

          <Link
            href={`/policy?merchantId=${merchantId}`}
            style={{
              padding: "0.85rem 1rem",
              borderRadius: "0.9rem",
              background: "#0f172a",
              color: "#f8fafc",
              textDecoration: "none",
              fontWeight: 700,
            }}
          >
            Open policy
          </Link>
        </div>

        <div
          style={{
            marginTop: "1.5rem",
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          }}
        >
          <section
            style={{
              display: "grid",
              gap: "1rem",
            }}
          >
            <article
              style={{
                borderRadius: "1.1rem",
                background: "rgba(255,255,255,0.96)",
                border: "1px solid rgba(148,163,184,0.2)",
                padding: "1.25rem",
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: "0.8rem",
                  color: "#0f172a",
                }}
              >
                Conversation
              </h2>
              <div
                style={{
                  display: "grid",
                  gap: "0.85rem",
                }}
              >
                {ticket.messages.map((message) => (
                  <div
                    key={message.id}
                    style={{
                      borderRadius: "0.95rem",
                      padding: "0.95rem 1rem",
                      background:
                        message.role === "CUSTOMER" ? "#eff6ff" : "#f8fafc",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "1rem",
                        flexWrap: "wrap",
                        color: "#475569",
                        fontSize: "0.9rem",
                      }}
                    >
                      <span>
                        {message.role} · {message.authorName ?? message.authorEmail ?? "Unknown"}
                      </span>
                      <span>{formatTimestamp(message.createdAt)}</span>
                    </div>
                    <p
                      style={{
                        marginTop: "0.55rem",
                        marginBottom: 0,
                        color: "#0f172a",
                        lineHeight: 1.7,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {message.body}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            {ticket.resolution ? (
              <ReviewPanel
                merchantId={merchantId}
                ticketId={ticket.id}
                initialDraft={ticket.resolution.responseDraft}
                initialRecommendedAction={ticket.resolution.recommendedAction}
                disabled={reviewDisabled}
              />
            ) : (
              <article
                style={{
                  borderRadius: "1.1rem",
                  background: "rgba(255,255,255,0.96)",
                  border: "1px solid rgba(148,163,184,0.2)",
                  padding: "1.25rem",
                  color: "#475569",
                }}
              >
                No AI resolution is stored for this ticket yet.
              </article>
            )}
          </section>

          <aside
            style={{
              display: "grid",
              gap: "1rem",
            }}
          >
            <article
              style={{
                borderRadius: "1.1rem",
                background: "rgba(255,255,255,0.96)",
                border: "1px solid rgba(148,163,184,0.2)",
                padding: "1.25rem",
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: "0.8rem",
                  color: "#0f172a",
                }}
              >
                AI recommendation
              </h2>

              {ticket.resolution ? (
                <>
                  <div style={{ color: "#475569" }}>
                    Intent: {ticket.resolution.intentLabel}
                  </div>
                  <div style={{ color: "#475569", marginTop: "0.35rem" }}>
                    Action: {ticket.resolution.recommendedAction}
                  </div>
                  <div style={{ color: "#475569", marginTop: "0.35rem" }}>
                    Confidence: {Math.round(ticket.resolution.confidenceScore * 100)}%
                  </div>
                  <p
                    style={{
                      marginTop: "0.9rem",
                      marginBottom: 0,
                      color: "#0f172a",
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {ticket.resolution.reasoning}
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, color: "#475569" }}>
                  Resolution not available yet.
                </p>
              )}
            </article>

            <article
              style={{
                borderRadius: "1.1rem",
                background: "rgba(255,255,255,0.96)",
                border: "1px solid rgba(148,163,184,0.2)",
                padding: "1.25rem",
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: "0.8rem",
                  color: "#0f172a",
                }}
              >
                Order context
              </h2>

              {ticket.order ? (
                <div style={{ display: "grid", gap: "0.45rem", color: "#475569" }}>
                  <div>Order: #{ticket.order.orderNumber ?? ticket.order.shopifyOrderId}</div>
                  <div>
                    Total: {ticket.order.totalPrice.toString()} {ticket.order.currencyCode}
                  </div>
                  <div>
                    Refunded: {ticket.order.totalRefunded?.toString() ?? "0.00"}{" "}
                    {ticket.order.currencyCode}
                  </div>
                  <div>Fulfillment: {ticket.order.fulfillmentStatus ?? "Unknown"}</div>
                  <div>Financial: {ticket.order.financialStatus ?? "Unknown"}</div>
                  <div>Order status: {ticket.order.status ?? "Unknown"}</div>
                </div>
              ) : (
                <p style={{ margin: 0, color: "#475569" }}>
                  No order was matched to this ticket.
                </p>
              )}
            </article>

            <article
              style={{
                borderRadius: "1.1rem",
                background: "rgba(255,255,255,0.96)",
                border: "1px solid rgba(148,163,184,0.2)",
                padding: "1.25rem",
              }}
            >
              <h2
                style={{
                  marginTop: 0,
                  marginBottom: "0.8rem",
                  color: "#0f172a",
                }}
              >
                Outcome history
              </h2>

              <div style={{ display: "grid", gap: "0.6rem" }}>
                {ticket.outcomes.map((outcome) => (
                  <div key={outcome.id} style={{ color: "#475569" }}>
                    {outcome.outcomeType} · {formatTimestamp(outcome.recordedAt)}
                  </div>
                ))}

                {ticket.outcomes.length === 0 ? (
                  <p style={{ margin: 0, color: "#64748b" }}>
                    No outcomes have been recorded for this ticket yet.
                  </p>
                ) : null}
              </div>
            </article>
          </aside>
        </div>
      </section>
    </main>
  );
}
