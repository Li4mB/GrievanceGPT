const required = (name: string): string => {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
};

const optional = (name: string): string | undefined => process.env[name];

export const appEnv = {
  appUrl: required("APP_URL"),
  nodeEnv: optional("NODE_ENV") ?? "development",
  logLevel: optional("LOG_LEVEL") ?? "info",
  encryptionKey: required("ENCRYPTION_KEY"),
};

export const databaseEnv = {
  databaseUrl: required("DATABASE_URL"),
};

export const shopifyEnv = {
  apiKey: required("SHOPIFY_API_KEY"),
  apiSecret: required("SHOPIFY_API_SECRET"),
  scopes:
    optional("SHOPIFY_APP_SCOPES") ??
    "read_orders,read_all_orders,read_customers,read_customer_email,read_customer_name,read_customer_phone,read_customer_address,write_fulfillments",
  apiVersion: optional("SHOPIFY_API_VERSION") ?? "2026-01",
};

export const queueEnv = {
  redisUrl: required("REDIS_URL"),
};

export const authEnv = {
  nextAuthSecret:
    optional("NEXTAUTH_SECRET") ?? optional("AUTH_SECRET") ?? undefined,
  nextAuthUrl: optional("NEXTAUTH_URL") ?? appEnv.appUrl,
  smtpHost: optional("AUTH_SMTP_HOST"),
  smtpPort: optional("AUTH_SMTP_PORT"),
  smtpUser: optional("AUTH_SMTP_USER"),
  smtpPassword: optional("AUTH_SMTP_PASSWORD"),
  emailFrom: optional("AUTH_EMAIL_FROM"),
};

export const aiEnv = {
  openAiApiKey: required("OPENAI_API_KEY"),
  openAiTicketModel: optional("OPENAI_TICKET_MODEL") ?? "gpt-4o",
  openAiEmbeddingModel:
    optional("OPENAI_EMBEDDING_MODEL") ?? "text-embedding-3-small",
  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  anthropicFallbackModel:
    optional("ANTHROPIC_FALLBACK_MODEL") ?? "claude-3-5-sonnet-latest",
};

export const sentryEnv = {
  dsn: optional("SENTRY_DSN"),
};
