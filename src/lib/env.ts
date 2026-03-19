const normalizeEnvValue = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
};

const required = (name: string): string => {
  const value = normalizeEnvValue(process.env[name]);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const optional = (name: string): string | undefined =>
  normalizeEnvValue(process.env[name]);

const resolveAppUrl = (): string => {
  const explicitAppUrl = optional("APP_URL");

  if (explicitAppUrl) {
    return explicitAppUrl;
  }

  const nextAuthUrl = optional("NEXTAUTH_URL") ?? optional("AUTH_URL");

  if (nextAuthUrl) {
    return nextAuthUrl;
  }

  const vercelUrl = optional("VERCEL_URL");

  if (vercelUrl) {
    return vercelUrl.startsWith("http")
      ? vercelUrl
      : `https://${vercelUrl}`;
  }

  throw new Error(
    "Missing required environment variable: APP_URL (or NEXTAUTH_URL / VERCEL_URL).",
  );
};

export const appEnv = {
  get appUrl(): string {
    return resolveAppUrl();
  },
  get nodeEnv(): string {
    return optional("NODE_ENV") ?? "development";
  },
  get logLevel(): string {
    return optional("LOG_LEVEL") ?? "info";
  },
  get encryptionKey(): string {
    return required("ENCRYPTION_KEY");
  },
};

export const databaseEnv = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
};

export const shopifyEnv = {
  get apiKey(): string {
    return required("SHOPIFY_API_KEY");
  },
  get apiSecret(): string {
    return required("SHOPIFY_API_SECRET");
  },
  get scopes(): string {
    return (
      optional("SHOPIFY_APP_SCOPES") ??
      "read_orders,read_customers,write_fulfillments"
    );
  },
  get apiVersion(): string {
    return optional("SHOPIFY_API_VERSION") ?? "2026-01";
  },
};

export const queueEnv = {
  get redisUrl(): string {
    return required("REDIS_URL");
  },
};

export const authEnv = {
  get nextAuthSecret(): string | undefined {
    return optional("NEXTAUTH_SECRET") ?? optional("AUTH_SECRET") ?? undefined;
  },
  get nextAuthUrl(): string {
    return optional("NEXTAUTH_URL") ?? appEnv.appUrl;
  },
  get smtpHost(): string | undefined {
    return optional("AUTH_SMTP_HOST");
  },
  get smtpPort(): string | undefined {
    return optional("AUTH_SMTP_PORT");
  },
  get smtpUser(): string | undefined {
    return optional("AUTH_SMTP_USER");
  },
  get smtpPassword(): string | undefined {
    return optional("AUTH_SMTP_PASSWORD");
  },
  get emailFrom(): string | undefined {
    return optional("AUTH_EMAIL_FROM");
  },
};

export const aiEnv = {
  get openAiApiKey(): string {
    return required("OPENAI_API_KEY");
  },
  get openAiTicketModel(): string {
    return optional("OPENAI_TICKET_MODEL") ?? "gpt-4o";
  },
  get openAiEmbeddingModel(): string {
    return optional("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small";
  },
  get anthropicApiKey(): string | undefined {
    return optional("ANTHROPIC_API_KEY");
  },
  get anthropicFallbackModel(): string {
    return optional("ANTHROPIC_FALLBACK_MODEL") ?? "claude-3-5-sonnet-latest";
  },
};

export const sentryEnv = {
  get dsn(): string | undefined {
    return optional("SENTRY_DSN");
  },
};
