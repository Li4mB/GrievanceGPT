"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface TestTicketFormProps {
  merchantId: string;
}

export function TestTicketForm({ merchantId }: TestTicketFormProps) {
  const router = useRouter();
  const [subject, setSubject] = useState("Where is my order?");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [message, setMessage] = useState(
    "Hi team, my package still has not arrived and tracking has not moved for days. Can you please help?",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    setError(null);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/merchants/${merchantId}/test-tickets`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subject,
            customerEmail,
            customerName,
            orderNumber,
            message,
          }),
        });

        const payload = (await response.json()) as {
          error?: string;
          ticketId?: string;
        };

        if (!response.ok || !payload.ticketId) {
          setError(payload.error ?? "Failed to create test ticket.");
          return;
        }

        router.push(`/tickets/${payload.ticketId}?merchantId=${merchantId}`);
        router.refresh();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : "Failed to create test ticket.",
        );
      }
    });
  };

  return (
    <section
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
        Create internal test ticket
      </h2>
      <p
        style={{
          marginTop: 0,
          color: "#475569",
          lineHeight: 1.6,
        }}
      >
        This runs the real GrievanceGPT pipeline without Gorgias. The ticket is
        processed immediately and opens in the review workspace when ready.
      </p>

      <div
        style={{
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        }}
      >
        <label style={{ display: "grid", gap: "0.45rem", color: "#0f172a" }}>
          Subject
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            style={{
              borderRadius: "0.85rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.98rem",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: "0.45rem", color: "#0f172a" }}>
          Customer email
          <input
            value={customerEmail}
            onChange={(event) => setCustomerEmail(event.target.value)}
            placeholder="customer@example.com"
            style={{
              borderRadius: "0.85rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.98rem",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: "0.45rem", color: "#0f172a" }}>
          Customer name
          <input
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
            placeholder="Jamie Carter"
            style={{
              borderRadius: "0.85rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.98rem",
            }}
          />
        </label>

        <label style={{ display: "grid", gap: "0.45rem", color: "#0f172a" }}>
          Order number
          <input
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
            placeholder="#1001"
            style={{
              borderRadius: "0.85rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.98rem",
            }}
          />
        </label>
      </div>

      <label
        style={{
          marginTop: "1rem",
          display: "grid",
          gap: "0.45rem",
          color: "#0f172a",
        }}
      >
        Customer message
        <textarea
          rows={9}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          style={{
            width: "100%",
            borderRadius: "1rem",
            border: "1px solid #cbd5e1",
            padding: "1rem",
            fontSize: "0.98rem",
            lineHeight: 1.7,
          }}
        />
      </label>

      <div
        style={{
          marginTop: "1rem",
          display: "flex",
          gap: "0.75rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          disabled={isPending}
          onClick={submit}
          style={{
            border: 0,
            borderRadius: "0.9rem",
            padding: "0.9rem 1rem",
            background: "#0f172a",
            color: "#f8fafc",
            fontWeight: 700,
            cursor: isPending ? "wait" : "pointer",
          }}
        >
          {isPending ? "Running test..." : "Create and process test ticket"}
        </button>

        {error ? <span style={{ color: "#b91c1c" }}>{error}</span> : null}
      </div>
    </section>
  );
}
