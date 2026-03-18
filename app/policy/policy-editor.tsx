"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface PolicyEditorProps {
  merchantId: string;
  initialPolicyText: string;
  initialPolicyJson: unknown;
}

export function PolicyEditor({
  merchantId,
  initialPolicyText,
  initialPolicyJson,
}: PolicyEditorProps) {
  const router = useRouter();
  const [policyText, setPolicyText] = useState(initialPolicyText);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [policyJsonPreview, setPolicyJsonPreview] = useState(
    JSON.stringify(initialPolicyJson ?? {}, null, 2),
  );
  const [isPending, startTransition] = useTransition();

  const savePolicy = () => {
    setMessage(null);
    setError(null);

    startTransition(async () => {
      const response = await fetch(`/api/merchants/${merchantId}/policy`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          policyText,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        policyJson?: unknown;
      };

      if (!response.ok) {
        setError(payload.error ?? "Failed to save policy.");
        return;
      }

      setPolicyJsonPreview(JSON.stringify(payload.policyJson ?? {}, null, 2));
      setMessage("Policy saved and re-parsed for the agent.");
      router.refresh();
    });
  };

  return (
    <section
      style={{
        display: "grid",
        gap: "1rem",
        gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
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
            marginBottom: "0.75rem",
            color: "#0f172a",
          }}
        >
          Plain-English policy rules
        </h2>
        <textarea
          value={policyText}
          onChange={(event) => setPolicyText(event.target.value)}
          rows={18}
          style={{
            width: "100%",
            borderRadius: "1rem",
            border: "1px solid #cbd5e1",
            padding: "1rem",
            fontSize: "0.98rem",
            lineHeight: 1.7,
          }}
        />

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
            onClick={savePolicy}
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
            {isPending ? "Saving..." : "Save policy"}
          </button>

          {message ? <span style={{ color: "#047857" }}>{message}</span> : null}
          {error ? <span style={{ color: "#b91c1c" }}>{error}</span> : null}
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
            marginBottom: "0.75rem",
            color: "#0f172a",
          }}
        >
          Parsed policy JSON
        </h2>
        <pre
          style={{
            margin: 0,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            color: "#0f172a",
            lineHeight: 1.5,
          }}
        >
          {policyJsonPreview}
        </pre>
      </article>
    </section>
  );
}
