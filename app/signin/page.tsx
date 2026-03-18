"use client";

import { FormEvent, useState } from "react";
import { signIn } from "next-auth/react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await signIn("email", {
      email,
      callbackUrl: "/dashboard",
      redirect: false,
    });

    setSubmitting(false);

    if (response?.error) {
      setError(
        "Email sign-in is not configured yet or the sign-in request failed.",
      );
      return;
    }

    setSentTo(email);
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background:
          "radial-gradient(circle at top left, #f8fafc 0%, #e2e8f0 48%, #cbd5e1 100%)",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <section
        style={{
          width: "min(480px, 100%)",
          padding: "2rem",
          borderRadius: "1.25rem",
          background: "rgba(255,255,255,0.96)",
          boxShadow: "0 24px 80px rgba(15, 23, 42, 0.14)",
        }}
      >
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
          GrievanceGPT
        </p>
        <h1
          style={{
            marginTop: "0.8rem",
            marginBottom: "0.75rem",
            fontSize: "2.3rem",
            lineHeight: 1.05,
            color: "#0f172a",
          }}
        >
          Sign in to your support ops workspace.
        </h1>
        <p
          style={{
            margin: 0,
            color: "#334155",
            lineHeight: 1.6,
          }}
        >
          Use the same email you installed Shopify with. We’ll send a magic link
          so the store owner can land directly in the dashboard without passwords.
        </p>

        <form
          onSubmit={handleSubmit}
          style={{
            marginTop: "1.5rem",
            display: "grid",
            gap: "0.9rem",
          }}
        >
          <label
            htmlFor="email"
            style={{
              display: "grid",
              gap: "0.45rem",
              fontSize: "0.95rem",
              color: "#0f172a",
            }}
          >
            Work email
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              style={{
                width: "100%",
                borderRadius: "0.85rem",
                border: "1px solid #cbd5e1",
                padding: "0.95rem 1rem",
                fontSize: "1rem",
                color: "#0f172a",
              }}
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            style={{
              border: 0,
              borderRadius: "0.95rem",
              padding: "0.95rem 1rem",
              fontSize: "1rem",
              fontWeight: 700,
              color: "#f8fafc",
              background: submitting ? "#475569" : "#0f172a",
              cursor: submitting ? "wait" : "pointer",
            }}
          >
            {submitting ? "Sending link..." : "Email me a secure sign-in link"}
          </button>
        </form>

        {sentTo ? (
          <p
            style={{
              marginTop: "1rem",
              marginBottom: 0,
              color: "#166534",
              lineHeight: 1.6,
            }}
          >
            Magic link sent to {sentTo}. Open it on this device to continue.
          </p>
        ) : null}

        {error ? (
          <p
            style={{
              marginTop: "1rem",
              marginBottom: 0,
              color: "#b91c1c",
              lineHeight: 1.6,
            }}
          >
            {error}
          </p>
        ) : null}
      </section>
    </main>
  );
}
