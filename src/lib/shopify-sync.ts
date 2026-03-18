import { IntegrationType, Prisma } from "@prisma/client";

import { prisma } from "./prisma";
import { decryptString } from "./security";
import {
  buildShopifyGid,
  extractLegacyResourceId,
  normalizeShopDomain,
  ShopifyCustomer,
  ShopifyOrder,
  shopifyAdminGraphqlRequest,
} from "./shopify";

interface ShopifyMoneyValue {
  amount: string;
  currencyCode: string;
}

interface ShopifyMoneyBag {
  shopMoney: ShopifyMoneyValue;
}

interface ShopifyGraphqlEmailAddress {
  emailAddress: string | null;
}

interface ShopifyGraphqlPhoneNumber {
  phoneNumber: string | null;
}

interface ShopifyGraphqlMailingAddress {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  country?: string | null;
  zip?: string | null;
  phone?: string | null;
  name?: string | null;
  provinceCode?: string | null;
  countryCodeV2?: string | null;
  company?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface ShopifyGraphqlCustomerNode {
  id: string;
  legacyResourceId?: string | number | null;
  firstName: string | null;
  lastName: string | null;
  email?: string | null;
  phone?: string | null;
  defaultEmailAddress?: ShopifyGraphqlEmailAddress | null;
  defaultPhoneNumber?: ShopifyGraphqlPhoneNumber | null;
  numberOfOrders?: string | number | null;
  amountSpent?: ShopifyMoneyValue | null;
  defaultAddress?: ShopifyGraphqlMailingAddress | null;
}

interface ShopifyGraphqlLineItemNode {
  id: string;
  name: string;
  quantity: number;
  sku: string | null;
  variantTitle: string | null;
  originalUnitPriceSet?: ShopifyMoneyBag | null;
  variant?: {
    id: string;
    title: string;
  } | null;
  product?: {
    id: string;
    title: string;
  } | null;
}

interface ShopifyGraphqlOrderNode {
  id: string;
  legacyResourceId?: string | number | null;
  name: string;
  email: string | null;
  createdAt: string;
  updatedAt: string;
  currencyCode: string;
  currentTotalPriceSet?: ShopifyMoneyBag | null;
  currentSubtotalPriceSet?: ShopifyMoneyBag | null;
  totalRefundedSet?: ShopifyMoneyBag | null;
  displayFulfillmentStatus?: string | null;
  displayFinancialStatus?: string | null;
  cancelledAt?: string | null;
  lineItems?: {
    nodes: ShopifyGraphqlLineItemNode[];
  } | null;
  shippingAddress?: ShopifyGraphqlMailingAddress | null;
  billingAddress?: ShopifyGraphqlMailingAddress | null;
  customer?: ShopifyGraphqlCustomerNode | null;
}

interface ShopifyOrderQueryResponse {
  order: ShopifyGraphqlOrderNode | null;
}

interface ShopifyOrdersSearchResponse {
  orders: {
    nodes: ShopifyGraphqlOrderNode[];
  };
}

interface ShopifyCustomerHistoryResponse {
  customer: (ShopifyGraphqlCustomerNode & {
    orders: {
      nodes: ShopifyGraphqlOrderNode[];
    };
  }) | null;
}

const SHOPIFY_MAILING_ADDRESS_FIELDS = `
  address1
  address2
  city
  province
  country
  zip
  phone
  name
  provinceCode
  countryCodeV2
  company
  firstName
  lastName
  latitude
  longitude
`;

const SHOPIFY_CUSTOMER_FIELDS = `
  id
  legacyResourceId
  firstName
  lastName
  email
  phone
  defaultEmailAddress {
    emailAddress
  }
  defaultPhoneNumber {
    phoneNumber
  }
  numberOfOrders
  amountSpent {
    amount
    currencyCode
  }
  defaultAddress {
    ${SHOPIFY_MAILING_ADDRESS_FIELDS}
  }
`;

const SHOPIFY_ORDER_FIELDS = `
  id
  legacyResourceId
  name
  email
  createdAt
  updatedAt
  currencyCode
  currentTotalPriceSet {
    shopMoney {
      amount
      currencyCode
    }
  }
  currentSubtotalPriceSet {
    shopMoney {
      amount
      currencyCode
    }
  }
  totalRefundedSet {
    shopMoney {
      amount
      currencyCode
    }
  }
  displayFulfillmentStatus
  displayFinancialStatus
  cancelledAt
  lineItems(first: 100) {
    nodes {
      id
      name
      quantity
      sku
      variantTitle
      originalUnitPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      variant {
        id
        title
      }
      product {
        id
        title
      }
    }
  }
  shippingAddress {
    ${SHOPIFY_MAILING_ADDRESS_FIELDS}
  }
  billingAddress {
    ${SHOPIFY_MAILING_ADDRESS_FIELDS}
  }
  customer {
    ${SHOPIFY_CUSTOMER_FIELDS}
  }
`;

const SHOPIFY_ORDER_FIELDS_WITHOUT_CUSTOMER = `
  id
  legacyResourceId
  name
  email
  createdAt
  updatedAt
  currencyCode
  currentTotalPriceSet {
    shopMoney {
      amount
      currencyCode
    }
  }
  currentSubtotalPriceSet {
    shopMoney {
      amount
      currencyCode
    }
  }
  totalRefundedSet {
    shopMoney {
      amount
      currencyCode
    }
  }
  displayFulfillmentStatus
  displayFinancialStatus
  cancelledAt
  lineItems(first: 100) {
    nodes {
      id
      name
      quantity
      sku
      variantTitle
      originalUnitPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
      variant {
        id
        title
      }
      product {
        id
        title
      }
    }
  }
  shippingAddress {
    ${SHOPIFY_MAILING_ADDRESS_FIELDS}
  }
  billingAddress {
    ${SHOPIFY_MAILING_ADDRESS_FIELDS}
  }
`;

const escapeShopifySearchValue = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

const getCustomerEmail = (
  customer: ShopifyGraphqlCustomerNode,
): string | null =>
  customer.email ??
  customer.defaultEmailAddress?.emailAddress ??
  null;

const getCustomerPhone = (
  customer: ShopifyGraphqlCustomerNode,
): string | null =>
  customer.phone ??
  customer.defaultPhoneNumber?.phoneNumber ??
  null;

const mapGraphqlCustomerToShopifyCustomer = (
  customer: ShopifyGraphqlCustomerNode,
): ShopifyCustomer => ({
  id: extractLegacyResourceId(customer.id, customer.legacyResourceId),
  email: getCustomerEmail(customer),
  first_name: customer.firstName,
  last_name: customer.lastName,
  phone: getCustomerPhone(customer),
  orders_count: Number(customer.numberOfOrders ?? 0),
  total_spent: customer.amountSpent?.amount ?? "0",
  default_address: customer.defaultAddress
    ? (customer.defaultAddress as Record<string, unknown>)
    : null,
});

const mapGraphqlLineItems = (
  lineItems: ShopifyGraphqlLineItemNode[] | undefined,
): Array<Record<string, unknown>> =>
  (lineItems ?? []).map((lineItem) => ({
    id: lineItem.id,
    name: lineItem.name,
    quantity: lineItem.quantity,
    sku: lineItem.sku,
    variantTitle: lineItem.variantTitle,
    originalUnitPrice:
      lineItem.originalUnitPriceSet?.shopMoney.amount ?? null,
    currencyCode:
      lineItem.originalUnitPriceSet?.shopMoney.currencyCode ?? null,
    variant: lineItem.variant,
    product: lineItem.product,
  }));

const mapGraphqlOrderToShopifyOrder = ({
  order,
  customerOverride,
}: {
  order: ShopifyGraphqlOrderNode;
  customerOverride?: ShopifyGraphqlCustomerNode | null;
}): ShopifyOrder => {
  const customer = customerOverride ?? order.customer ?? null;

  return {
    id: extractLegacyResourceId(order.id, order.legacyResourceId),
    name: order.name,
    email: order.email ?? (customer ? getCustomerEmail(customer) : null),
    created_at: order.createdAt,
    updated_at: order.updatedAt,
    currency:
      order.currentTotalPriceSet?.shopMoney.currencyCode ??
      order.currencyCode,
    current_total_price: order.currentTotalPriceSet?.shopMoney.amount ?? "0",
    subtotal_price: order.currentSubtotalPriceSet?.shopMoney.amount ?? null,
    total_refunds: order.totalRefundedSet?.shopMoney.amount ?? null,
    fulfillment_status: order.displayFulfillmentStatus ?? null,
    financial_status: order.displayFinancialStatus ?? null,
    cancelled_at: order.cancelledAt ?? null,
    line_items: mapGraphqlLineItems(order.lineItems?.nodes),
    shipping_address: order.shippingAddress
      ? (order.shippingAddress as Record<string, unknown>)
      : null,
    billing_address: order.billingAddress
      ? (order.billingAddress as Record<string, unknown>)
      : null,
    customer: customer
      ? mapGraphqlCustomerToShopifyCustomer(customer)
      : null,
  };
};

const fetchShopifyOrderByLegacyId = async ({
  shop,
  accessToken,
  shopifyOrderId,
}: {
  shop: string;
  accessToken: string;
  shopifyOrderId: string;
}): Promise<ShopifyGraphqlOrderNode | null> => {
  const response = await shopifyAdminGraphqlRequest<ShopifyOrderQueryResponse>({
    shop,
    accessToken,
    query: `
      query OrderById($id: ID!) {
        order(id: $id) {
          ${SHOPIFY_ORDER_FIELDS}
        }
      }
    `,
    variables: {
      id: buildShopifyGid("Order", shopifyOrderId),
    },
  });

  return response.order;
};

const searchShopifyOrders = async ({
  shop,
  accessToken,
  query,
  first = 10,
}: {
  shop: string;
  accessToken: string;
  query: string;
  first?: number;
}): Promise<ShopifyGraphqlOrderNode[]> => {
  const response =
    await shopifyAdminGraphqlRequest<ShopifyOrdersSearchResponse>({
      shop,
      accessToken,
      query: `
        query SearchOrders($query: String!, $first: Int!) {
          orders(first: $first, reverse: true, query: $query) {
            nodes {
              ${SHOPIFY_ORDER_FIELDS}
            }
          }
        }
      `,
      variables: {
        query,
        first,
      },
    });

  return response.orders.nodes;
};

const fetchShopifyCustomerHistory = async ({
  shop,
  accessToken,
  shopifyCustomerId,
  orderLimit = 10,
}: {
  shop: string;
  accessToken: string;
  shopifyCustomerId: string;
  orderLimit?: number;
}): Promise<ShopifyCustomerHistoryResponse["customer"]> => {
  const response =
    await shopifyAdminGraphqlRequest<ShopifyCustomerHistoryResponse>({
      shop,
      accessToken,
      query: `
        query CustomerHistory($id: ID!, $orderLimit: Int!) {
          customer(id: $id) {
            ${SHOPIFY_CUSTOMER_FIELDS}
            orders(first: $orderLimit, reverse: true) {
              nodes {
                ${SHOPIFY_ORDER_FIELDS_WITHOUT_CUSTOMER}
              }
            }
          }
        }
      `,
      variables: {
        id: buildShopifyGid("Customer", shopifyCustomerId),
        orderLimit,
      },
    });

  return response.customer;
};

export const getShopifyAdminCredentials = async (merchantId: string) => {
  const connection = await prisma.integrationConnection.findUnique({
    where: {
      merchantId_type: {
        merchantId,
        type: IntegrationType.SHOPIFY,
      },
    },
    select: {
      externalAccountId: true,
      accessTokenEncrypted: true,
    },
  });

  if (!connection?.externalAccountId || !connection.accessTokenEncrypted) {
    throw new Error(`Missing Shopify connection for merchant ${merchantId}`);
  }

  const shop = normalizeShopDomain(connection.externalAccountId);

  if (!shop) {
    throw new Error(`Invalid Shopify domain for merchant ${merchantId}`);
  }

  return {
    shop,
    accessToken: decryptString(connection.accessTokenEncrypted),
  };
};

export const upsertCustomerFromShopify = async ({
  merchantId,
  customer,
}: {
  merchantId: string;
  customer: ShopifyCustomer | null;
}): Promise<string | null> => {
  if (!customer) {
    return null;
  }

  const shopifyCustomerId = String(customer.id);

  const persisted = await prisma.customer.upsert({
    where: {
      merchantId_shopifyCustomerId: {
        merchantId,
        shopifyCustomerId,
      },
    },
    update: {
      email: customer.email,
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
      orderCount: customer.orders_count,
      totalSpent: new Prisma.Decimal(customer.total_spent || "0"),
      defaultAddressJson: customer.default_address
        ? (customer.default_address as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      metadata: customer as unknown as Prisma.InputJsonValue,
    },
    create: {
      merchantId,
      shopifyCustomerId,
      email: customer.email,
      firstName: customer.first_name,
      lastName: customer.last_name,
      phone: customer.phone,
      orderCount: customer.orders_count,
      totalSpent: new Prisma.Decimal(customer.total_spent || "0"),
      defaultAddressJson: customer.default_address
        ? (customer.default_address as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      metadata: customer as unknown as Prisma.InputJsonValue,
    },
    select: {
      id: true,
    },
  });

  return persisted.id;
};

export const upsertOrderFromShopify = async ({
  merchantId,
  order,
}: {
  merchantId: string;
  order: ShopifyOrder;
}) => {
  const customerId = await upsertCustomerFromShopify({
    merchantId,
    customer: order.customer,
  });

  return prisma.order.upsert({
    where: {
      merchantId_shopifyOrderId: {
        merchantId,
        shopifyOrderId: String(order.id),
      },
    },
    update: {
      customerId,
      orderNumber: order.name?.replace(/^#/, "") ?? null,
      email: order.email,
      currencyCode: order.currency,
      totalPrice: new Prisma.Decimal(order.current_total_price || "0"),
      subtotalPrice: order.subtotal_price
        ? new Prisma.Decimal(order.subtotal_price)
        : null,
      totalRefunded: order.total_refunds
        ? new Prisma.Decimal(order.total_refunds)
        : null,
      fulfillmentStatus: order.fulfillment_status,
      financialStatus: order.financial_status,
      status: order.cancelled_at ? "cancelled" : "open",
      lineItemsJson: order.line_items as unknown as Prisma.InputJsonValue,
      shippingAddressJson: order.shipping_address
        ? (order.shipping_address as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      billingAddressJson: order.billing_address
        ? (order.billing_address as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      rawPayload: order as unknown as Prisma.InputJsonValue,
    },
    create: {
      merchantId,
      customerId,
      shopifyOrderId: String(order.id),
      orderNumber: order.name?.replace(/^#/, "") ?? null,
      email: order.email,
      currencyCode: order.currency,
      totalPrice: new Prisma.Decimal(order.current_total_price || "0"),
      subtotalPrice: order.subtotal_price
        ? new Prisma.Decimal(order.subtotal_price)
        : null,
      totalRefunded: order.total_refunds
        ? new Prisma.Decimal(order.total_refunds)
        : null,
      fulfillmentStatus: order.fulfillment_status,
      financialStatus: order.financial_status,
      status: order.cancelled_at ? "cancelled" : "open",
      lineItemsJson: order.line_items as unknown as Prisma.InputJsonValue,
      shippingAddressJson: order.shipping_address
        ? (order.shipping_address as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      billingAddressJson: order.billing_address
        ? (order.billing_address as Prisma.InputJsonValue)
        : Prisma.JsonNull,
      rawPayload: order as unknown as Prisma.InputJsonValue,
    },
  });
};

export const fetchAndSyncShopifyOrderById = async ({
  merchantId,
  shopifyOrderId,
}: {
  merchantId: string;
  shopifyOrderId: string;
}) => {
  const { shop, accessToken } = await getShopifyAdminCredentials(merchantId);
  const order = await fetchShopifyOrderByLegacyId({
    shop,
    accessToken,
    shopifyOrderId,
  });

  if (!order) {
    return null;
  }

  return upsertOrderFromShopify({
    merchantId,
    order: mapGraphqlOrderToShopifyOrder({
      order,
    }),
  });
};

export const searchAndSyncShopifyOrders = async ({
  merchantId,
  searchQuery,
  first = 10,
}: {
  merchantId: string;
  searchQuery: string;
  first?: number;
}) => {
  const { shop, accessToken } = await getShopifyAdminCredentials(merchantId);
  const orders = await searchShopifyOrders({
    shop,
    accessToken,
    query: searchQuery,
    first,
  });

  return Promise.all(
    orders.map((order) =>
      upsertOrderFromShopify({
        merchantId,
        order: mapGraphqlOrderToShopifyOrder({
          order,
        }),
      }),
    ),
  );
};

export const buildShopifyOrderNumberSearchQuery = (orderNumber: string): string =>
  `name:${escapeShopifySearchValue(orderNumber.replace(/^#/, ""))}`;

export const buildShopifyCustomerEmailSearchQuery = (
  customerEmail: string,
): string => `email:"${escapeShopifySearchValue(customerEmail)}"`;

export const refreshShopifyCustomerHistory = async ({
  merchantId,
  shopifyCustomerId,
  orderLimit = 10,
}: {
  merchantId: string;
  shopifyCustomerId: string;
  orderLimit?: number;
}): Promise<void> => {
  const { shop, accessToken } = await getShopifyAdminCredentials(merchantId);
  const customer = await fetchShopifyCustomerHistory({
    shop,
    accessToken,
    shopifyCustomerId,
    orderLimit,
  });

  if (!customer) {
    return;
  }

  await upsertCustomerFromShopify({
    merchantId,
    customer: mapGraphqlCustomerToShopifyCustomer(customer),
  });

  await Promise.all(
    customer.orders.nodes.map((order) =>
      upsertOrderFromShopify({
        merchantId,
        order: mapGraphqlOrderToShopifyOrder({
          order,
          customerOverride: customer,
        }),
      }),
    ),
  );
};
