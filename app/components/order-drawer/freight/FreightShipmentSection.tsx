import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Badge, type BadgeTone } from "~/components/shared/Badge";
import { FREIGHT_SHIPMENT_STATUS_LABELS } from "~/domain/freight/labels";
import { formatAuDateTime } from "~/lib/dates";
import type { OrderDetailFreightShipment } from "~/domain/freight/freight-query.server";

const STATUS_TONE: Record<string, BadgeTone> = {
  PREPARING: "neutral",
  CREATED: "success",
  FAILED: "error",
  CANCELLED: "neutral",
};

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

function GetRatesButton({
  orderId,
  weightKg,
  heightM,
  widthM,
  lengthM,
  onRates,
}: {
  orderId: string;
  weightKg: string;
  heightM: string;
  widthM: string;
  lengthM: string;
  onRates: (services: DeliveryRateOption[]) => void;
}) {
  const fetcher = useFetcher<FreightActionResponse>();
  const response = fetcher.data;

  useEffect(() => {
    if (fetcher.state === "idle" && response?.ok && "services" in response) {
      onRates(response.services);
    }
    // Only re-run when the fetcher actually settles — including onRates
    // would re-run this every render since it's a fresh closure each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, response]);

  return (
    <div className="flex flex-col gap-1">
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
        className="self-start rounded-md border border-border px-3 py-1.5 text-sm text-ink disabled:opacity-50"
      >
        {fetcher.state !== "idle" ? "Getting rates…" : "Get rates"}
      </button>
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}

function DeliveryRateList({
  services,
  selectedServiceCode,
  onSelect,
}: {
  services: DeliveryRateOption[];
  selectedServiceCode: string | null;
  onSelect: (option: DeliveryRateOption) => void;
}) {
  if (services.length === 0) {
    return <p className="text-xs text-muted">No delivery services returned for this package.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {services.map((option) => {
        const isSelected = selectedServiceCode === option.serviceCode;
        return (
          <li key={`${option.carrierCode}-${option.serviceCode}`}>
            <button
              type="button"
              onClick={() => {
                onSelect(option);
              }}
              className={`flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-1.5 text-left text-sm ${
                isSelected ? "border-brand-navy bg-brand-navy/5" : "border-border hover:bg-page"
              }`}
            >
              <span>
                <span className="font-medium text-ink">{option.carrierName}</span>
                <span className="text-muted"> · {option.serviceName}</span>
                {option.deliveryEstimate ? (
                  <span className="ml-1 text-xs text-muted">({option.deliveryEstimate})</span>
                ) : null}
              </span>
              <span className="font-medium text-ink">
                {option.totalPrice !== null ? `$${option.totalPrice.toFixed(2)}` : "—"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function CreateFreightShipmentForm({
  orderId,
  eligible,
  ineligibleReason,
}: {
  orderId: string;
  eligible: boolean;
  ineligibleReason: string | null;
}) {
  const fetcher = useFetcher<FreightActionResponse>();
  const formRef = useRef<HTMLFormElement>(null);
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
    if (fetcher.state === "idle" && response?.ok && "freightShipmentId" in response) {
      formRef.current?.reset();
      setIdempotencyKey(crypto.randomUUID());
      setCarrierCode("");
      setCarrierServiceCode("Standard");
      setWeightKg("");
      setHeightM("");
      setWidthM("");
      setLengthM("");
      setRateOptions([]);
    }
  }, [fetcher.state, response]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!eligible) {
    return (
      <p className="text-xs text-muted">
        {ineligibleReason ?? "This order isn't eligible for a freight shipment yet."}
      </p>
    );
  }

  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      action={`/orders/${orderId}/freight`}
      className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3"
    >
      <input type="hidden" name="_intent" value="createFreightShipment" />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
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
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
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
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
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
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
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
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <GetRatesButton
        orderId={orderId}
        weightKg={weightKg}
        heightM={heightM}
        widthM={widthM}
        lengthM={lengthM}
        onRates={setRateOptions}
      />

      {rateOptions.length > 0 ? (
        <DeliveryRateList
          services={rateOptions}
          selectedServiceCode={carrierServiceCode}
          onSelect={(option) => {
            setCarrierCode(option.carrierCode);
            setCarrierServiceCode(option.serviceCode);
          }}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Carrier
          <input
            type="text"
            name="carrierCode"
            placeholder="e.g. AusPost"
            required
            value={carrierCode}
            onChange={(e) => {
              setCarrierCode(e.target.value);
            }}
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Service level
          <input
            type="text"
            name="carrierServiceCode"
            placeholder="Standard"
            required
            value={carrierServiceCode}
            onChange={(e) => {
              setCarrierServiceCode(e.target.value);
            }}
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Package preset (optional)
          <input
            type="text"
            name="packagingPresetName"
            placeholder="Uses Starshipit's account default"
            className="rounded border border-border px-2 py-1.5 text-sm"
          />
        </label>
      </div>
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={fetcher.state !== "idle"}
        className="self-start rounded-md bg-brand-navy px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {fetcher.state !== "idle" ? "Creating label…" : "Create freight label"}
      </button>
    </fetcher.Form>
  );
}

function RetrySyncButton({
  orderId,
  freightShipmentId,
}: {
  orderId: string;
  freightShipmentId: string;
}) {
  const fetcher = useFetcher<FreightActionResponse>();
  const response = fetcher.data;
  return (
    <div>
      <button
        type="button"
        disabled={fetcher.state !== "idle"}
        onClick={() => {
          const formData = new FormData();
          formData.set("_intent", "retryShopifySync");
          formData.set("freightShipmentId", freightShipmentId);
          void fetcher.submit(formData, { method: "post", action: `/orders/${orderId}/freight` });
        }}
        className="rounded-md border border-border px-2.5 py-1 text-xs text-ink disabled:opacity-50"
      >
        Retry Shopify sync
      </button>
      {response && !response.ok ? (
        <p role="alert" className="mt-1 text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}

function CancelShipmentForm({
  orderId,
  freightShipmentId,
}: {
  orderId: string;
  freightShipmentId: string;
}) {
  const fetcher = useFetcher<FreightActionResponse>();
  const [reason, setReason] = useState("");
  const [showForm, setShowForm] = useState(false);
  const response = fetcher.data;

  if (!showForm) {
    return (
      <button
        type="button"
        onClick={() => {
          setShowForm(true);
        }}
        className="text-xs text-error hover:underline"
      >
        Cancel shipment
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-1 rounded border border-error/40 bg-error/5 p-2">
      <input
        type="text"
        placeholder="Reason for cancelling (required)"
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
        }}
        className="rounded border border-border px-2 py-1 text-xs"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={reason.trim().length === 0 || fetcher.state !== "idle"}
          onClick={() => {
            const formData = new FormData();
            formData.set("_intent", "cancelFreightShipment");
            formData.set("freightShipmentId", freightShipmentId);
            formData.set("reason", reason);
            void fetcher.submit(formData, { method: "post", action: `/orders/${orderId}/freight` });
          }}
          className="rounded-md bg-error px-2.5 py-1 text-xs text-white disabled:opacity-50"
        >
          Confirm cancellation
        </button>
        <button
          type="button"
          onClick={() => {
            setShowForm(false);
          }}
          className="rounded-md px-2.5 py-1 text-xs text-muted"
        >
          Back
        </button>
      </div>
      {response && !response.ok ? (
        <p role="alert" className="text-xs text-error">
          {response.error}
        </p>
      ) : null}
    </div>
  );
}

function FreightShipmentRow({
  orderId,
  shipment,
  canDownload,
  canCancel,
  canRetrySync,
}: {
  orderId: string;
  shipment: OrderDetailFreightShipment;
  canDownload: boolean;
  canCancel: boolean;
  canRetrySync: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[shipment.status] ?? "neutral"}>
          {FREIGHT_SHIPMENT_STATUS_LABELS[shipment.status]}
        </Badge>
        <p className="font-medium text-ink">
          {shipment.carrierName ?? shipment.carrierCode} · {shipment.carrierServiceCode}
        </p>
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {shipment.createdByStaffName} · {formatAuDateTime(shipment.createdAt)}
      </p>
      {shipment.trackingNumber ? (
        <p className="mt-1 text-sm text-ink">
          Tracking: {shipment.trackingNumber}
          {shipment.trackingUrl ? (
            <a
              href={shipment.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="ml-2 text-xs text-brand-navy hover:underline"
            >
              Track
            </a>
          ) : null}
        </p>
      ) : null}
      <p className="mt-0.5 text-xs text-muted">
        Shopify sync: {shipment.shopifyFulfillmentId ? "Synced" : "Not yet synced"}
      </p>
      {shipment.cancelReason ? (
        <p className="mt-1 text-xs text-error">{shipment.cancelReason}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canDownload && shipment.hasLabel ? (
          <a
            href={`/freight-shipments/${shipment.id}/label`}
            className="rounded-md bg-brand-navy px-2.5 py-1 text-xs text-white"
          >
            Download label
          </a>
        ) : null}
        {canRetrySync && shipment.status === "CREATED" && !shipment.shopifyFulfillmentId ? (
          <RetrySyncButton orderId={orderId} freightShipmentId={shipment.id} />
        ) : null}
        {canCancel && shipment.status !== "CANCELLED" ? (
          <CancelShipmentForm orderId={orderId} freightShipmentId={shipment.id} />
        ) : null}
      </div>
    </div>
  );
}

export interface FreightShipmentSectionProps {
  orderId: string;
  shipments: OrderDetailFreightShipment[];
  eligible: boolean;
  ineligibleReason: string | null;
  canCreate: boolean;
  canDownload: boolean;
  canCancel: boolean;
}

export function FreightShipmentSection({
  orderId,
  shipments,
  eligible,
  ineligibleReason,
  canCreate,
  canDownload,
  canCancel,
}: FreightShipmentSectionProps) {
  const hasActiveShipment = shipments.some(
    (s) => s.status === "PREPARING" || s.status === "CREATED",
  );

  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-sm font-semibold text-ink">Freight shipments</h4>
      {shipments.length === 0 ? (
        <p className="text-sm text-muted">No freight shipments yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {shipments.map((shipment) => (
            <FreightShipmentRow
              key={shipment.id}
              orderId={orderId}
              shipment={shipment}
              canDownload={canDownload}
              canCancel={canCancel}
              canRetrySync={canCreate}
            />
          ))}
        </div>
      )}
      {canCreate ? (
        <CreateFreightShipmentForm
          orderId={orderId}
          eligible={eligible && !hasActiveShipment}
          ineligibleReason={
            hasActiveShipment ? "This order already has an active shipment." : ineligibleReason
          }
        />
      ) : null}
    </section>
  );
}
