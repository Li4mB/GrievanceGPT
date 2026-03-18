import { getServerSession } from "next-auth";
import Link from "next/link";

import { authOptions } from "../src/lib/auth";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        background:
          "linear-gradient(135deg, rgba(245,247,250,1) 0%, rgba(226,232,240,1) 100%)",
      }}
    >
      <section
        style={{
          width: "min(720px, 92vw)",
          padding: "2rem",
          borderRadius: "1rem",
          background: "rgba(255,255,255,0.92)",
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
            color: "#64748b",
          }}
        >
          GrievanceGPT
        </p>
        <h1
          style={{
            marginTop: "0.75rem",
            marginBottom: "0.75rem",
            fontSize: "clamp(2rem, 6vw, 3.5rem)",
            lineHeight: 1,
            color: "#0f172a",
          }}
        >
          Complaint resolution pipeline is online.
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "1.05rem",
            lineHeight: 1.6,
            color: "#334155",
          }}
        >
          The API surface for Shopify install, Shopify webhooks, Gorgias webhooks,
          queue processing, and merchant policy parsing is scaffolded in this repo.
        </p>

        <div
          style={{
            marginTop: "1.5rem",
            display: "flex",
            gap: "0.9rem",
            flexWrap: "wrap",
          }}
        >
          <Link
            href={session?.user ? "/dashboard" : "/signin"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: "180px",
              padding: "0.9rem 1rem",
              borderRadius: "0.9rem",
              background: "#0f172a",
              color: "#f8fafc",
              fontWeight: 700,
              textDecoration: "none",
            }}
          >
            {session?.user ? "Open dashboard" : "Sign in"}
          </Link>
        </div>
      </section>
    </main>
  );
}
