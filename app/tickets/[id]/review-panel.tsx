"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

const ACTION_OPTIONS = [
  "REFUND",
  "RESHIP",
  "REPLACE",
  "GOODWILL_CREDIT",
  "ESCALATE",
  "REQUEST_INFO",
  "NO_ACTION",
] as const;

interface ReviewPanelProps {
  merchantId: string;
  ticketId: string;
  initialDraft: string;
  initialRecommendedAction: string;
  disabled?: boolean;
}

export function ReviewPanel({
  merchantId,
  ticketId,
  initialDraft,
  initialRecommendedAction,
  disabled = false,
}: ReviewPanelProps) {
  const router = useRouter();
  const [responseDraft, setResponseDraft] = useState(initialDraft);
  const [recommendedAction, setRecommendedAction] = useState(
    initialRecommendedAction,
  );
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (action: "approve" | "edit" | "escalate" | "reject") => {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const response = await fetch(`/api/tickets/${ticketId}/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          merchantId,
          action,
          responseDraft,
          recommendedAction,
          note,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        status?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Review action failed.");
        return;
      }

      setMessage(`Ticket updated: ${payload.status ?? action}.`);
      router.refresh();
    });
  };

  return (
    <section
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
          marginBottom: "0.75rem",
          color: "#0f172a",
        }}
      >
        Supervisor actions
      </h2>

      <label
        style={{
          display: "grid",
          gap: "0.45rem",
          color: "#0f172a",
        }}
      >
        Response draft
        <textarea
          value={responseDraft}
          onChange={(event) => setResponseDraft(event.target.value)}
          disabled={disabled || isPending}
          rows={10}
          style={{
            width: "100%",
            borderRadius: "0.95rem",
            border: "1px solid #cbd5e1",
            padding: "0.9rem 1rem",
            fontSize: "0.95rem",
            lineHeight: 1.6,
          }}
        />
      </label>

      <div
        style={{
          marginTop: "1rem",
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        }}
      >
        <label
          style={{
            display: "grid",
            gap: "0.45rem",
            color: "#0f172a",
          }}
        >
          Recommended action
          <select
            value={recommendedAction}
            onChange={(event) => setRecommendedAction(event.target.value)}
            disabled={disabled || isPending}
            style={{
              borderRadius: "0.9rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.95rem",
            }}
          >
            {ACTION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label
          style={{
            display: "grid",
            gap: "0.45rem",
            color: "#0f172a",
          }}
        >
          Escalation / rejection note
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            disabled={disabled || isPending}
            rows={4}
            style={{
              width: "100%",
              borderRadius: "0.9rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.95rem",
              lineHeight: 1.5,
            }}
          />
        </label>
      </div>

      <div
        style={{
          marginTop: "1rem",
          display: "flex",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          disabled={disabled || isPending}
          onClick={() => submit("approve")}
          style={{
            border: 0,
            borderRadius: "0.9rem",
            padding: "0.9rem 1rem",
            background: "#0f172a",
            color: "#f8fafc",
            fontWeight: 700,
            cursor: disabled || isPending ? "not-allowed" : "pointer",
          }}
        >
          Approve and send
        </button>
        <button
          type="button"
          disabled={disabled || isPending}
          onClick={() => submit("edit")}
          style={{
            border: 0,
            borderRadius: "0.9rem",
            padding: "0.9rem 1rem",
            background: "#1d4ed8",
            color: "#eff6ff",
            fontWeight: 700,
            cursor: disabled || isPending ? "not-allowed" : "pointer",
          }}
        >
          Send edited reply
        </button>
        <button
          type="button"
          disabled={disabled || isPending}
          onClick={() => submit("escalate")}
          style={{
            border: 0,
            borderRadius: "0.9rem",
            padding: "0.9rem 1rem",
            background: "#f97316",
            color: "#fff7ed",
            fontWeight: 700,
            cursor: disabled || isPending ? "not-allowed" : "pointer",
          }}
        >
          Escalate
        </button>
        <button
          type="button"
          disabled={disabled || isPending}
          onClick={() => submit("reject")}
          style={{
            border: 0,
            borderRadius: "0.9rem",
            padding: "0.9rem 1rem",
            background: "#e2e8f0",
            color: "#0f172a",
            fontWeight: 700,
            cursor: disabled || isPending ? "not-allowed" : "pointer",
          }}
        >
          Reject
        </button>
      </div>

      {message ? (
        <p
          style={{
            marginTop: "1rem",
            marginBottom: 0,
            color: "#047857",
          }}
        >
          {message}
        </p>
      ) : null}

      {error ? (
        <p
          style={{
            marginTop: "1rem",
            marginBottom: 0,
            color: "#b91c1c",
          }}
        >
          {error}
        </p>
      ) : null}
    </section>
  );
}
