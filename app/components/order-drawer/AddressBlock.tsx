// Addresses are stored as opaque Json (ADR-0003) — this reads the known
// Shopify GraphQL address shape defensively without normalising the
// underlying schema, and formats it for display only. Never mutates or
// re-stores the source value.
interface ParsedAddress {
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  zip: string | null;
  countryCodeV2: string | null;
  phone: string | null;
}

function parseAddress(value: unknown): ParsedAddress | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const asString = (key: string): string | null =>
    typeof record[key] === "string" ? record[key] : null;
  const parsed: ParsedAddress = {
    name: asString("name"),
    address1: asString("address1"),
    address2: asString("address2"),
    city: asString("city"),
    provinceCode: asString("provinceCode"),
    zip: asString("zip"),
    countryCodeV2: asString("countryCodeV2"),
    phone: asString("phone"),
  };
  const fields: (string | null)[] = [
    parsed.name,
    parsed.address1,
    parsed.address2,
    parsed.city,
    parsed.provinceCode,
    parsed.zip,
    parsed.countryCodeV2,
    parsed.phone,
  ];
  const hasAnyField = fields.some((field) => field !== null && field.trim().length > 0);
  return hasAnyField ? parsed : null;
}

export function AddressBlock({ value, label }: { value: unknown; label: string }) {
  const address = parseAddress(value);

  if (!address) {
    return (
      <div>
        <h4 className="text-xs font-medium text-muted">{label}</h4>
        <p className="mt-1 text-sm text-muted">Not provided.</p>
      </div>
    );
  }

  const cityLine = [address.city, address.provinceCode, address.zip].filter(Boolean).join(" ");

  return (
    <div>
      <h4 className="text-xs font-medium text-muted">{label}</h4>
      <address className="mt-1 text-sm not-italic text-ink">
        {address.name ? <div>{address.name}</div> : null}
        {address.address1 ? <div>{address.address1}</div> : null}
        {address.address2 ? <div>{address.address2}</div> : null}
        {cityLine ? <div>{cityLine}</div> : null}
        {address.countryCodeV2 ? <div>{address.countryCodeV2}</div> : null}
        {address.phone ? (
          <div>
            <a href={`tel:${address.phone}`} className="text-brand-navy hover:underline">
              {address.phone}
            </a>
          </div>
        ) : null}
      </address>
    </div>
  );
}
