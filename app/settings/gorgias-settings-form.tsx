"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface GorgiasSettingsFormProps {
  merchantId: string;
  initialStatus: string;
  initialBaseUrl: string;
  initialApiEmail: string;
  initialWebhookUrl: string;
}

export function GorgiasSettingsForm({
  merchantId,
  initialStatus,
  initialBaseUrl,
  initialApiEmail,
  initialWebhookUrl,
}: GorgiasSettingsFormProps) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(initialBaseUrl);
  const [apiEmail, setApiEmail] = useState(initialApiEmail);
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [visibleSecret, setVisibleSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const save = () => {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const response = await fetch(
        `/api/merchants/${merchantId}/integrations/gorgias`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            baseUrl,
            apiEmail,
            apiKey,
            webhookSecret: webhookSecret || undefined,
          }),
        },
      );

      const payload = (await response.json()) as {
        error?: string;
        connected?: boolean;
        webhookUrl?: string;
        webhookSecret?: string | null;
      };

      if (!response.ok) {
        setError(payload.error ?? "Failed to save Gorgias settings.");
        return;
      }

      setStatus("ACTIVE");
      setVisibleSecret(payload.webhookSecret ?? null);
      setApiKey("");
      setWebhookSecret("");
      setMessage("Gorgias settings saved.");
      router.refresh();
    });
  };

  return (
    <section
      style={{
        borderRadius: "1.15rem",
        background: "rgba(255,255,255,0.96)",
        border: "1px solid rgba(148,163,184,0.2)",
        padding: "1.25rem",
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
          <h2
            style={{
              marginTop: 0,
              marginBottom: "0.4rem",
              color: "#0f172a",
            }}
          >
            Gorgias connection
          </h2>
          <p
            style={{
              margin: 0,
              color: "#475569",
            }}
          >
            Current status: {status}
          </p>
        </div>
      </div>

      <div
        style={{
          marginTop: "1rem",
          display: "grid",
          gap: "1rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        }}
      >
        <label
          style={{
            display: "grid",
            gap: "0.45rem",
            color: "#0f172a",
          }}
        >
          Gorgias base URL
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://yourbrand.gorgias.com"
            style={{
              borderRadius: "0.9rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.95rem",
            }}
          />
        </label>

        <label
          style={{
            display: "grid",
            gap: "0.45rem",
            color: "#0f172a",
          }}
        >
          API email
          <input
            value={apiEmail}
            onChange={(event) => setApiEmail(event.target.value)}
            placeholder="ops@brand.com"
            style={{
              borderRadius: "0.9rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.95rem",
            }}
          />
        </label>

        <label
          style={{
            display: "grid",
            gap: "0.45rem",
            color: "#0f172a",
          }}
        >
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste a new Gorgias API key"
            style={{
              borderRadius: "0.9rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.95rem",
            }}
          />
        </label>

        <label
          style={{
            display: "grid",
            gap: "0.45rem",
            color: "#0f172a",
          }}
        >
          Optional webhook secret rotation
          <input
            type="text"
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
            placeholder="Leave blank to keep existing"
            style={{
              borderRadius: "0.9rem",
              border: "1px solid #cbd5e1",
              padding: "0.85rem 0.95rem",
              fontSize: "0.95rem",
            }}
          />
        </label>
      </div>

      <div
        style={{
          marginTop: "1rem",
          padding: "0.95rem 1rem",
          borderRadius: "0.95rem",
          background: "#f8fafc",
          color: "#334155",
          lineHeight: 1.6,
          wordBreak: "break-word",
        }}
      >
        Webhook target: {initialWebhookUrl}
      </div>

      {visibleSecret ? (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.95rem 1rem",
            borderRadius: "0.95rem",
            background: "#fff7ed",
            color: "#9a3412",
            lineHeight: 1.6,
            wordBreak: "break-word",
          }}
        >
          Store this webhook secret in Gorgias now: {visibleSecret}
        </div>
      ) : null}

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
          onClick={save}
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
          {isPending ? "Saving..." : "Save Gorgias settings"}
        </button>

        {message ? <span style={{ color: "#047857" }}>{message}</span> : null}
        {error ? <span style={{ color: "#b91c1c" }}>{error}</span> : null}
      </div>
    </section>
  );
}
