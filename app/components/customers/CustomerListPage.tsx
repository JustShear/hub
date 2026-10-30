import { Form, Link } from "react-router";
import { Search, Users } from "lucide-react";
import type { CustomerListItem } from "~/domain/customers/customer-query.server";
import { PageHeader } from "~/components/shared/PageHeader";
import { EmptyState } from "~/components/shared/EmptyState";
import { formatAuDate } from "~/lib/dates";

export interface CustomerListPageProps {
  customers: CustomerListItem[];
  search: string;
}

export function CustomerListPage({ customers, search }: CustomerListPageProps) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customers"
        description="Open a customer to see every proof they have accepted or asked to change."
      />

      <Form method="get" role="search" className="flex max-w-xl gap-2">
        <label htmlFor="customer-search" className="sr-only">
          Search customers
        </label>
        <input
          id="customer-search"
          name="q"
          type="search"
          defaultValue={search}
          placeholder="Name, email or order number"
          className="min-w-0 flex-1 rounded-lg border border-border bg-page px-3 py-2 text-sm text-ink"
        />
        <button
          type="submit"
          className="flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-medium text-white"
        >
          <Search aria-hidden="true" className="h-4 w-4" />
          Search
        </button>
      </Form>

      {customers.length === 0 ? (
        <EmptyState
          icon={Users}
          title={search ? "No customers match that search" : "No customers yet"}
          description={
            search
              ? "Try a different name, email address or order number."
              : "Customers appear here once their orders have been imported from Shopify."
          }
        />
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {customers.map((customer) => (
            <li key={customer.key}>
              <Link
                to={`/customers/${customer.key}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-page focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
              >
                <span>
                  <span className="block font-medium text-ink">
                    {customer.name ?? "No name on file"}
                  </span>
                  {customer.email ? (
                    <span className="block text-sm text-muted">{customer.email}</span>
                  ) : null}
                </span>
                <span className="text-sm text-muted">
                  {customer.orderCount} order{customer.orderCount === 1 ? "" : "s"} · last{" "}
                  {formatAuDate(customer.lastOrderAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
