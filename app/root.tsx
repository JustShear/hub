import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import type { Theme } from "@prisma/client";

import type { Route } from "./+types/root";
import "./app.css";
import { env } from "./lib/env.server";
import { startJobPoller } from "./lib/job-poller.server";
import { startFulfillmentPoller } from "./lib/fulfillment-poller.server";
import type { loader as appLoader } from "./routes/app";

// Typography and design tokens (SRS Section 19.1) are wired up in Milestone 06.
export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/png", href: "/favicon.png" },
];

// Loaders run server-only. Touching `env` here forces the fail-closed
// validation in app/lib/env.server.ts to run on first request rather than
// silently deferring until some later code path happens to need a variable.
// startJobPoller()/startFulfillmentPoller() are idempotent — only the first
// call actually starts each interval — so calling them from a per-request
// loader is safe.
export function loader() {
  void env;
  startJobPoller();
  startFulfillmentPoller();
  return null;
}

// Maps the staff member's Theme preference to the data-theme attribute
// app.css's [data-theme="..."] blocks key off. CLASSIC (and unauthenticated
// pages, which never match routes/app at all — login, webhooks, the public
// proof portal) render with no attribute, since CLASSIC is the @theme
// block's own default and needs no override.
function themeAttribute(theme: Theme | undefined): string | undefined {
  if (theme === "DARK") return "dark";
  if (theme === "COLOURED_MODERN") return "coloured-modern";
  if (theme === "CATS") return "cats";
  return undefined;
}

export function Layout({ children }: { children: React.ReactNode }) {
  // Reads the authenticated layout's already-fetched staffUser rather than
  // doing a second DB round trip — undefined on any route that doesn't
  // nest under routes/app (or if it renders before that loader resolves).
  const appData = useRouteLoaderData<typeof appLoader>("routes/app");

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body data-theme={themeAttribute(appData?.staffUser.theme)}>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
