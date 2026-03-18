import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";

import { authEnv } from "./env";
import { logger } from "./logger";
import { prisma } from "./prisma";

export const isEmailAuthConfigured = Boolean(
  authEnv.emailFrom &&
    authEnv.smtpHost &&
    authEnv.smtpPort &&
    authEnv.smtpUser &&
    authEnv.smtpPassword,
);

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  secret: authEnv.nextAuthSecret,
  session: {
    strategy: "database",
  },
  pages: {
    signIn: "/signin",
  },
  providers: isEmailAuthConfigured
    ? [
        EmailProvider({
          from: authEnv.emailFrom,
          server: {
            host: authEnv.smtpHost,
            port: Number(authEnv.smtpPort),
            auth: {
              user: authEnv.smtpUser,
              pass: authEnv.smtpPassword,
            },
          },
        }),
      ]
    : [],
  callbacks: {
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }

      return session;
    },
  },
  logger: {
    error(code, metadata) {
      logger.error(
        {
          code,
          metadata,
        },
        "NextAuth error",
      );
    },
    warn(code) {
      logger.warn(
        {
          code,
        },
        "NextAuth warning",
      );
    },
    debug(code, metadata) {
      logger.debug(
        {
          code,
          metadata,
        },
        "NextAuth debug",
      );
    },
  },
};
