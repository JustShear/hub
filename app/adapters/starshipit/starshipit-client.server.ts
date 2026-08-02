import { env } from "~/lib/env.server";

// Starshipit doesn't expose a carrier/service/package-preset discovery
// endpoint in its public API reference — carrier_code, carrier_service_code,
// and packaging_type are staff-entered free text (see FreightShipment),
// validated only by Starshipit's own API at request time. Field names below
// are verified against Starshipit's public developer documentation
// (support.starshipit.com/developers) at build time, not guessed — but the
// exact request shape for /api/orders/shipment (the print-label call) is
// confirmed only via its documented response fields, not a full published
// request schema, so double-check against a real sandbox response the first
// time this runs for real and adjust here if Starshipit's account expects a
// slightly different field name.
const STARSHIPIT_API_BASE = "https://api.starshipit.com";

interface StarshipitFetchResult {
  ok: boolean;
  status: number;
  body: unknown;
  errorSummary?: string;
}

async function starshipitFetch(path: string, body: unknown): Promise<StarshipitFetchResult> {
  return starshipitRequest("POST", path, body);
}

async function starshipitRequest(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<StarshipitFetchResult> {
  let response: Response;
  try {
    response = await fetch(`${STARSHIPIT_API_BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "StarShipIT-Api-Key": env.STARSHIPIT_API_KEY,
        "Ocp-Apim-Subscription-Key": env.STARSHIPIT_SUBSCRIPTION_KEY,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network failure — never include the request body (destination address,
    // order details) in the error.
    return {
      ok: false,
      status: 0,
      body: null,
      errorSummary: "Network error contacting Starshipit.",
    };
  }

  let parsedBody: unknown = null;
  try {
    parsedBody = await response.json();
  } catch {
    // Some Starshipit responses may have no body — absence isn't itself an error.
  }

  if (response.ok) {
    return { ok: true, status: response.status, body: parsedBody };
  }
  // Only the HTTP status is ever recorded in the summary — never the
  // response body, which could echo back request details.
  return {
    ok: false,
    status: response.status,
    body: parsedBody,
    errorSummary: `Starshipit API returned HTTP ${response.status}`,
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 0 || status >= 500 || status === 429;
}

export interface StarshipitDestination {
  name: string;
  phone: string | null;
  street: string;
  suburb: string | null;
  city: string;
  state: string | null;
  postCode: string;
  country: string;
  deliveryInstructions: string | null;
}

export interface StarshipitOrderItem {
  description: string;
  sku: string | null;
  quantity: number;
  weight: number | null;
  value: number | null;
}

export interface CreateStarshipitOrderInput {
  /** Our own idempotency key — sent as Starshipit's order_number so a retried request is traceable back to the exact FreightShipment row. */
  orderNumber: string;
  reference: string | null;
  currency: string | null;
  signatureRequired: boolean;
  shippingMethod: string | null;
  destination: StarshipitDestination;
  items: StarshipitOrderItem[];
  packagingPresetName: string | null;
}

export type CreateStarshipitOrderResult =
  { ok: true; starshipitOrderId: string } | { ok: false; errorSummary: string; retryable: boolean };

export async function createStarshipitOrder(
  input: CreateStarshipitOrderInput,
): Promise<CreateStarshipitOrderResult> {
  const result = await starshipitFetch("/api/orders", {
    order: {
      order_number: input.orderNumber,
      reference: input.reference,
      currency: input.currency,
      signature_required: input.signatureRequired,
      shipping_method: input.shippingMethod,
      destination: {
        name: input.destination.name,
        phone: input.destination.phone,
        street: input.destination.street,
        suburb: input.destination.suburb,
        city: input.destination.city,
        state: input.destination.state,
        post_code: input.destination.postCode,
        country: input.destination.country,
        delivery_instructions: input.destination.deliveryInstructions,
      },
      items: input.items.map((item) => ({
        description: item.description,
        sku: item.sku,
        quantity: item.quantity,
        weight: item.weight,
        value: item.value,
      })),
      packages: input.packagingPresetName
        ? [{ packaging_type: input.packagingPresetName }]
        : undefined,
    },
  });

  if (!result.ok) {
    return {
      ok: false,
      errorSummary: result.errorSummary ?? "Starshipit order creation failed.",
      retryable: isRetryableStatus(result.status),
    };
  }

  const body = result.body as { order?: { order_id?: string | number } } | null;
  const orderId = body?.order?.order_id;
  if (orderId === undefined) {
    return {
      ok: false,
      errorSummary: "Starshipit accepted the order but returned no order id.",
      retryable: false,
    };
  }
  return { ok: true, starshipitOrderId: String(orderId) };
}

export type FindStarshipitOrderResult =
  | { ok: true; found: true; starshipitOrderId: string }
  | { ok: true; found: false }
  | { ok: false; errorSummary: string; retryable: boolean };

// This account's Starshipit is natively connected to Shopify (confirmed
// against a real account) — every Shopify order already appears here
// automatically, with a carrier/service Starshipit itself assigned, well
// before this app ever touches it. Calling createStarshipitOrder for an
// order Starshipit already has would create a genuine duplicate, so
// create-freight-shipment.server.ts looks the order up here first and only
// falls back to createStarshipitOrder if it's genuinely not found (e.g. a
// different Starshipit account without the native Shopify sync enabled).
//
// Confirmed by direct testing against a real account: Starshipit returns
// HTTP 200 with `{"success": false, "errors": [...]}` for an order number
// that doesn't exist — never a 404 — so "not found" must be read from the
// body, not the status code.
export async function findStarshipitOrderByOrderNumber(
  orderNumber: string,
): Promise<FindStarshipitOrderResult> {
  const result = await starshipitRequest(
    "GET",
    `/api/orders?order_number=${encodeURIComponent(orderNumber)}`,
  );
  if (!result.ok) {
    return {
      ok: false,
      errorSummary: result.errorSummary ?? "Starshipit order lookup failed.",
      retryable: isRetryableStatus(result.status),
    };
  }

  const body = result.body as {
    success?: boolean;
    order?: { order_id?: string | number };
  } | null;
  if (body?.success === false) {
    return { ok: true, found: false };
  }
  const orderId = body?.order?.order_id;
  if (orderId === undefined) {
    return { ok: true, found: false };
  }
  return { ok: true, found: true, starshipitOrderId: String(orderId) };
}

export interface PrintStarshipitLabelInput {
  starshipitOrderId: string;
  carrierCode: string;
  carrierServiceCode: string;
  /** Staff-entered package weight/dimensions — the same values a rate quote (if any) was based on, so the label matches what was priced. Omitted entirely if never entered. */
  package?: { weightKg: number; heightM: number | null; widthM: number | null; lengthM: number | null };
}

export type PrintStarshipitLabelResult =
  | {
      ok: true;
      carrierName: string | null;
      trackingNumber: string | null;
      labelPdfBase64: string;
    }
  | { ok: false; errorSummary: string; retryable: boolean };

export async function printStarshipitLabel(
  input: PrintStarshipitLabelInput,
): Promise<PrintStarshipitLabelResult> {
  const result = await starshipitFetch("/api/orders/shipment", {
    order_id: input.starshipitOrderId,
    carrier: input.carrierCode,
    carrier_service_code: input.carrierServiceCode,
    packages: input.package
      ? [
          {
            weight: input.package.weightKg,
            height: input.package.heightM,
            width: input.package.widthM,
            length: input.package.lengthM,
          },
        ]
      : undefined,
  });

  if (!result.ok) {
    return {
      ok: false,
      errorSummary: result.errorSummary ?? "Starshipit label creation failed.",
      retryable: isRetryableStatus(result.status),
    };
  }

  const body = result.body as {
    carrier_name?: string;
    tracking_numbers?: string[];
    labels?: string[];
  } | null;
  const label = body?.labels?.[0];
  if (!label) {
    return {
      ok: false,
      errorSummary: "Starshipit returned no label data for this shipment.",
      retryable: false,
    };
  }

  return {
    ok: true,
    carrierName: body.carrier_name ?? null,
    trackingNumber: body.tracking_numbers?.[0] ?? null,
    labelPdfBase64: label,
  };
}

export interface GetDeliveryServicesInput {
  destination: StarshipitDestination;
  weightKg: number;
  heightM: number | null;
  widthM: number | null;
  lengthM: number | null;
}

export interface DeliveryServiceOption {
  carrierCode: string;
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  totalPrice: number | null;
  deliveryEstimate: string | null;
}

export type GetDeliveryServicesResult =
  | { ok: true; services: DeliveryServiceOption[] }
  | { ok: false; errorSummary: string; retryable: boolean };

// POST /api/rates (the other quoting endpoint) only returns rates for
// couriers with "checkout rates" configured in Starshipit — confirmed
// directly with Starshipit support after it consistently returned
// `{"rates": [], "success": true}` against a real account with working
// couriers. /api/deliveryservices returns every available service
// regardless of checkout configuration, which is what this app actually
// needs (comparing real options across every connected carrier, not just
// whichever ones happen to have checkout rates set up). `include_pricing`
// defaults to false in Starshipit's own API — must be set explicitly.
export async function getDeliveryServices(
  input: GetDeliveryServicesInput,
): Promise<GetDeliveryServicesResult> {
  const result = await starshipitFetch("/api/deliveryservices", {
    destination: {
      street: input.destination.street,
      suburb: input.destination.suburb,
      city: input.destination.city,
      state: input.destination.state,
      post_code: input.destination.postCode,
      country_code: input.destination.country,
    },
    packages: [
      {
        weight: input.weightKg,
        height: input.heightM,
        width: input.widthM,
        length: input.lengthM,
      },
    ],
    include_pricing: true,
  });

  if (!result.ok) {
    return {
      ok: false,
      errorSummary: result.errorSummary ?? "Starshipit delivery-services lookup failed.",
      retryable: isRetryableStatus(result.status),
    };
  }

  const body = result.body as {
    success?: boolean;
    services?: {
      carrier?: string;
      carrier_name?: string;
      service_code?: string;
      service_name?: string;
      total_price?: number;
      pricing_breakdown?: Record<string, string>;
    }[];
  } | null;

  if (body?.success === false || !body?.services) {
    return { ok: true, services: [] };
  }

  const services: DeliveryServiceOption[] = [];
  for (const s of body.services) {
    if (!s.carrier || !s.service_code) continue;
    services.push({
      carrierCode: s.carrier,
      carrierName: s.carrier_name ?? s.carrier,
      serviceCode: s.service_code,
      serviceName: s.service_name ?? s.service_code,
      totalPrice: typeof s.total_price === "number" ? s.total_price : null,
      deliveryEstimate: s.pricing_breakdown?.["Predicted Delivery Dates "]?.trim() ?? null,
    });
  }

  return { ok: true, services };
}
