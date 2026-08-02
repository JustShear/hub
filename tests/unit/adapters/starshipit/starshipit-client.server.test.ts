import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findStarshipitOrderByOrderNumber,
  getDeliveryServices,
} from "~/adapters/starshipit/starshipit-client.server";

const TEST_DESTINATION = {
  name: "Cameron McKenzie",
  phone: null,
  street: "65 North St",
  suburb: "Harden",
  city: "Harden",
  state: "NSW",
  postCode: "2587",
  country: "AU",
  deliveryInstructions: null,
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

// Confirmed against a real Starshipit account: an order lookup always
// returns HTTP 200 — a genuinely missing order comes back as
// `{"success": false, "errors": [...]}`, never a 404. These tests encode
// that real, non-obvious behaviour rather than the more "normal" REST
// assumption that not-found would be a 404.
describe("findStarshipitOrderByOrderNumber", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns found with the order id when Starshipit has the order", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, order: { order_id: 737822374 } })),
    );

    const result = await findStarshipitOrderByOrderNumber("36355");

    expect(result).toEqual({ ok: true, found: true, starshipitOrderId: "737822374" });
  });

  it("returns not-found for Starshipit's real 'success: false' shape, despite HTTP 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: false,
          errors: [{ message: "General Exception", details: "Unable to find order number: 99999" }],
        }),
      ),
    );

    const result = await findStarshipitOrderByOrderNumber("99999");

    expect(result).toEqual({ ok: true, found: false });
  });

  it("sends the order number as a query parameter via GET", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, order: { order_id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);

    await findStarshipitOrderByOrderNumber("36355");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.starshipit.com/api/orders?order_number=36355");
    expect(init.method).toBe("GET");
  });

  it("reports a genuine API failure (not a 'not found') as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 })));

    const result = await findStarshipitOrderByOrderNumber("36355");

    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it("treats a network failure as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));

    const result = await findStarshipitOrderByOrderNumber("36355");

    expect(result).toMatchObject({ ok: false, retryable: true });
  });
});

// Confirmed against a real Starshipit account: /api/rates only returns
// "checkout rates" (a separate configuration most accounts don't have set
// up) and came back empty every time; /api/deliveryservices returns every
// connected carrier's service regardless, but only includes pricing when
// `include_pricing: true` is sent explicitly (it defaults to false).
describe("getDeliveryServices", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a real multi-carrier response into DeliveryServiceOption[]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          services: [
            {
              carrier: "AusPost",
              carrier_name: "Australia Post",
              service_code: "3D85",
              service_name: "Parcel Post",
              total_price: 19.9,
              pricing_breakdown: { "Predicted Delivery Dates ": " 3-5 business days " },
            },
            {
              carrier: "TGE",
              carrier_name: "Team Global Express",
              service_code: "ROAD",
              service_name: "Road Express",
              total_price: 24.5,
            },
          ],
        }),
      ),
    );

    const result = await getDeliveryServices({
      destination: TEST_DESTINATION,
      weightKg: 1.5,
      heightM: 0.1,
      widthM: 0.2,
      lengthM: 0.3,
    });

    expect(result).toEqual({
      ok: true,
      services: [
        {
          carrierCode: "AusPost",
          carrierName: "Australia Post",
          serviceCode: "3D85",
          serviceName: "Parcel Post",
          totalPrice: 19.9,
          deliveryEstimate: "3-5 business days",
        },
        {
          carrierCode: "TGE",
          carrierName: "Team Global Express",
          serviceCode: "ROAD",
          serviceName: "Road Express",
          totalPrice: 24.5,
          deliveryEstimate: null,
        },
      ],
    });
  });

  it("sends include_pricing: true explicitly, since Starshipit defaults it to false", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, services: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await getDeliveryServices({
      destination: TEST_DESTINATION,
      weightKg: 1.5,
      heightM: null,
      widthM: null,
      lengthM: null,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { include_pricing?: boolean };
    expect(body.include_pricing).toBe(true);
  });

  it("returns an empty list for Starshipit's real 'success: false' shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ success: false, errors: [] })));

    const result = await getDeliveryServices({
      destination: TEST_DESTINATION,
      weightKg: 1.5,
      heightM: null,
      widthM: null,
      lengthM: null,
    });

    expect(result).toEqual({ ok: true, services: [] });
  });

  it("skips any service entry missing a carrier or service code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          services: [
            { carrier: "AusPost", service_code: "3D85", service_name: "Parcel Post" },
            { carrier_name: "Missing carrier code", service_code: "X" },
            { carrier: "Missing service code" },
          ],
        }),
      ),
    );

    const result = await getDeliveryServices({
      destination: TEST_DESTINATION,
      weightKg: 1.5,
      heightM: null,
      widthM: null,
      lengthM: null,
    });

    expect(result).toEqual({
      ok: true,
      services: [
        {
          carrierCode: "AusPost",
          carrierName: "AusPost",
          serviceCode: "3D85",
          serviceName: "Parcel Post",
          totalPrice: null,
          deliveryEstimate: null,
        },
      ],
    });
  });

  it("reports a genuine API failure as a retryable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, { status: 500 })));

    const result = await getDeliveryServices({
      destination: TEST_DESTINATION,
      weightKg: 1.5,
      heightM: null,
      widthM: null,
      lengthM: null,
    });

    expect(result).toMatchObject({ ok: false, retryable: true });
  });

  it("treats a network failure as retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unreachable")));

    const result = await getDeliveryServices({
      destination: TEST_DESTINATION,
      weightKg: 1.5,
      heightM: null,
      widthM: null,
      lengthM: null,
    });

    expect(result).toMatchObject({ ok: false, retryable: true });
  });
});
