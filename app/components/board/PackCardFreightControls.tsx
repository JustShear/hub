import { useEffect, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import type { OrderProductionSummary } from "@prisma/client";
import { evaluateFreightShipmentEligibility } from "~/domain/freight/freight-eligibility";
import type { BoardCardFreightShipment } from "~/domain/orders/board-query.server";

interface DeliveryRateOption {
  carrierCode: string;
  carrierName: string;
  serviceCode: string;
  serviceName: string;
  totalPrice: number | null;
  deliveryEstimate: string | null;
}

type FreightActionResponse =
  | { intent: string; ok: true; freightShipmentId?: string; trackingNumber?: string | null }
  | { intent: "getDeliveryRates"; ok: true; services: DeliveryRateOption[] }
  | { intent: string; ok: false; error: string };

export interface PackCardFreightControlsProps {
  orderId: string;
  productionSummary: OrderProductionSummary;
  isCancelled: boolean;
  existingShipment: BoardCardFreightShipment | null;
  canCreate: boolean;
}

/**
 * Inline freight controls on a Pack-column Kanban card — reuses the exact
 * same orders.$orderId.freight.tsx resource route (getDeliveryRates /
 * createFreightShipment intents) the order drawer's Freight tab already
 * uses. Only the create-flow goes inline; download/cancel/retry-sync stay
 * drawer-only — see PackCardFreightControls' "Manage in order drawer" link.
 */
export function PackCardFreightControls({
  orderId,
  productionSummary,
  isCancelled,
  existingShipment,
  canCreate,
}: PackCardFreightControlsProps) {
  if (!canCreate) return null;

  if (existingShipment) {
    return (
      <div className="rounded-md border border-dashed border-border bg-page p-2 text-xs">
        <p className="font-medium text-ink">
          {existingShipment.status === "CREATED" ? "Freight label created" : "Freight in progress"}
          {existingShipment.trackingNumber ? ` · ${existingShipment.trackingNumber}` : ""}
        </p>
        <a href={`/orders/${orderId}?tab=freight`} className="text-brand-navy hover:underline">
          Manage in order drawer →
        </a>
      </div>
    );
  }

  const eligibility = evaluateFreightShipmentEligibility({
    productionSummary,
    hasActiveShipment: false,
    orderCancelledAt: isCancelled ? new Date() : null,
  });

  if (!eligibility.eligible) {
    return (
      <p className="text-xs text-muted">
        {eligibility.reason ?? "This order isn't eligible for a freight shipment yet."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <CreatePackFreightForm orderId={orderId} />
      <MarkFulfilledButton orderId={orderId} />
    </div>
  );
}

type MarkFulfilledResponse =
  | { intent: "markFulfilledManually"; ok: true }
  | { intent: "markFulfilledManually"; ok: false; error: string };

// The "no label" path — for orders that don't need shipping (local pickup,
// hand delivery, a carrier this app doesn't integrate with). Separate from
// CreatePackFreightForm since it needs none of that form's weight/dimension
// inputs; see mark-order-fulfilled-manually.server.ts for what it actually does.
function MarkFulfilledButton({ orderId }: { orderId: string }) {
  const fetcher = useFetcher<MarkFulfilledResponse>();
  const revalidator = useRevalidator();
  const response = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok) {
      // Once FULFILLED, the order drops off the board entirely — revalidate
      // so it disappears from Pack without waiting for the next poll.
      void revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, response]);

  return (
    <fetcher.Form
      method="post"
      action={`/orders/${orderId}/freight`}
      onClick={(e) => {
        // Stop the click reaching the draggable card wrapper.
        e.stopPropagation();
      }}
    >
      <input type="hidden" name="_intent" value="markFulfilledManually" />
      {response && !response.ok ? (
        <p role="alert" className="text-[11px] text-error">
          {response.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={fetcher.state !== "idle"}
        className="self-start text-[11px] text-muted underline hover:text-ink disabled:opacity-50"
      >
        {fetcher.state !== "idle" ? "Marking fulfilled…" : "Mark fulfilled — no label needed"}
      </button>
    </fetcher.Form>
  );
}

function CreatePackFreightForm({ orderId }: { orderId: string }) {
  const fetcher = useFetcher<FreightActionResponse>();
  const revalidator = useRevalidator();
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [carrierCode, setCarrierCode] = useState("");
  const [carrierServiceCode, setCarrierServiceCode] = useState("Standard");
  const [weightKg, setWeightKg] = useState("");
  const [heightM, setHeightM] = useState("");
  const [widthM, setWidthM] = useState("");
  const [lengthM, setLengthM] = useState("");
  const [rateOptions, setRateOptions] = useState<DeliveryRateOption[]>([]);
  const response = fetcher.data;

  /* eslint-disable react-hooks/set-state-in-effect -- reacting to an async fetch completing
     (an external system), not mirroring a prop into state. */
  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok && "services" in response) {
      setRateOptions(response.services);
    }
    if (fetcher.state === "idle" && response?.ok && "freightShipmentId" in response) {
      setIdempotencyKey(crypto.randomUUID());
      setCarrierCode("");
      setCarrierServiceCode("Standard");
      setWeightKg("");
      setHeightM("");
      setWidthM("");
      setLengthM("");
      setRateOptions([]);
      // The card doesn't own board-level optimistic state the way drag
      // moves do — revalidate so card.freightShipment reflects the new
      // shipment without waiting for the next polling refresh.
      void revalidator.revalidate();
    }
    // Only re-run when the fetcher actually settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, response]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <fetcher.Form
      method="post"
      action={`/orders/${orderId}/freight`}
      className="flex flex-col gap-2 rounded-md border border-dashed border-border p-2"
      onClick={(e) => {
        // Stop the click reaching the draggable card wrapper.
        e.stopPropagation();
      }}
    >
      <input type="hidden" name="_intent" value="createFreightShipment" />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div className="grid grid-cols-2 gap-1.5">
        <label className="flex flex-col gap-0.5 text-[11px] font-medium text-muted">
          Weight (kg)
          <input
            type="number"
            step="0.01"
            min="0"
            name="weightKg"
            required
            value={weightKg}
            onChange={(e) => {
              setWeightKg(e.target.value);
            }}
            className="rounded border border-border px-1.5 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] font-medium text-muted">
          Height (m)
          <input
            type="number"
            step="0.01"
            min="0"
            name="heightM"
            value={heightM}
            onChange={(e) => {
              setHeightM(e.target.value);
            }}
            className="rounded border border-border px-1.5 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] font-medium text-muted">
          Width (m)
          <input
            type="number"
            step="0.01"
            min="0"
            name="widthM"
            value={widthM}
            onChange={(e) => {
              setWidthM(e.target.value);
            }}
            className="rounded border border-border px-1.5 py-1 text-xs"
          />
        </label>
        <label className="flex flex-col gap-0.5 text-[11px] font-medium text-muted">
          Length (m)
          <input
            type="number"
            step="0.01"
            min="0"
            name="lengthM"
            value={lengthM}
            onChange={(e) => {
              setLengthM(e.target.value);
            }}
            className="rounded border border-border px-1.5 py-1 text-xs"
          />
        </label>
      </div>

      <button
        type="button"
        disabled={fetcher.state !== "idle" || weightKg.trim().length === 0}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "getDeliveryRates");
          formData.set("weightKg", weightKg);
          formData.set("heightM", heightM);
          formData.set("widthM", widthM);
          formData.set("lengthM", lengthM);
          void fetcher.submit(formData, { method: "post", action: `/orders/${orderId}/freight` });
        }}
        className="self-start rounded-md border border-border px-2 py-1 text-xs text-ink disabled:opacity-50"
      >
        {fetcher.state !== "idle" ? "Getting rates…" : "Get rates"}
      </button>

      {rateOptions.length > 0 ? (
        <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
          {rateOptions.map((option) => {
            const isSelected = carrierServiceCode === option.serviceCode;
            return (
              <li key={`${option.carrierCode}-${option.serviceCode}`}>
                <button
                  type="button"
                  onClick={() => {
                    setCarrierCode(option.carrierCode);
                    setCarrierServiceCode(option.serviceCode);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded border px-1.5 py-1 text-left text-[11px] ${
                    isSelected ? "border-brand-navy bg-brand-navy/5" : "border-border hover:bg-page"
                  }`}
                >
                  <span className="truncate">
                    {option.carrierName} · {option.serviceName}
                  </span>
                  <span className="shrink-0 font-medium text-ink">
                    {option.totalPrice !== null ? `$${option.totalPrice.toFixed(2)}` : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      <input type="hidden" name="carrierCode" value={carrierCode} />
      <input type="hidden" name="carrierServiceCode" value={carrierServiceCode} />

      {response && !response.ok ? (
        <p role="alert" className="text-[11px] text-error">
          {response.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={fetcher.state !== "idle" || !carrierCode || !carrierServiceCode}
        className="self-start rounded-md bg-brand-navy px-2 py-1 text-xs text-white disabled:opacity-50"
      >
        {fetcher.state !== "idle" ? "Creating label…" : "Create freight label"}
      </button>
    </fetcher.Form>
  );
}
