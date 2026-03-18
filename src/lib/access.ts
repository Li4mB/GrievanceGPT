import { MembershipRole } from "@prisma/client";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";

import { authOptions } from "./auth";
import { prisma } from "./prisma";

export class AccessError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AccessError";
  }
}

export const isAccessError = (error: unknown): error is AccessError =>
  error instanceof AccessError;

interface MerchantAccessContext {
  merchantId: string;
  membershipId: string;
  role: MembershipRole;
  session: Session;
  userId: string;
}

const getAuthenticatedSession = async (): Promise<{
  session: Session;
  userId: string;
}> => {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!session || !userId) {
    throw new AccessError(401, "Authentication required.");
  }

  return {
    session,
    userId,
  };
};

export const requireMerchantAccess = async ({
  merchantId,
  allowedRoles,
}: {
  merchantId?: string | null;
  allowedRoles?: MembershipRole[];
}): Promise<MerchantAccessContext> => {
  const { session, userId } = await getAuthenticatedSession();
  const roleFilter =
    allowedRoles && allowedRoles.length > 0
      ? { role: { in: allowedRoles } }
      : {};

  if (merchantId) {
    const membership = await prisma.merchantMembership.findFirst({
      where: {
        merchantId,
        userId,
        ...roleFilter,
      },
      select: {
        id: true,
        merchantId: true,
        role: true,
      },
    });

    if (!membership) {
      throw new AccessError(403, "Merchant access denied.");
    }

    return {
      merchantId: membership.merchantId,
      membershipId: membership.id,
      role: membership.role,
      session,
      userId,
    };
  }

  const memberships = await prisma.merchantMembership.findMany({
    where: {
      userId,
      ...roleFilter,
    },
    select: {
      id: true,
      merchantId: true,
      role: true,
    },
    orderBy: {
      createdAt: "asc",
    },
    take: 2,
  });

  if (memberships.length === 0) {
    throw new AccessError(403, "No merchant membership found.");
  }

  if (memberships.length > 1) {
    throw new AccessError(
      400,
      "merchantId is required when your account belongs to multiple merchants.",
    );
  }

  const membership = memberships[0];

  return {
    merchantId: membership.merchantId,
    membershipId: membership.id,
    role: membership.role,
    session,
    userId,
  };
};
