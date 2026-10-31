# Customer account page - "My approved proofs"

Source for the Shopify **customer account UI extension** that shows a logged-in
customer their own approved proofs. The Hub side (the secure endpoints it calls)
lives in `app/routes/api.customer-account.*` and `app/domain/customer-account/`;
see `docs/development.md` ("Customer account proofs") for how they work.

This folder is **not** built or deployed by the Hub. It is deployed to Shopify
with Shopify CLI, from a Shopify app project.

## Before you start

1. **New customer accounts must be on.** Customer-account extensions do not work
   with legacy customer accounts. Shopify admin -> Settings -> Customer accounts
   -> choose **New customer accounts**. Customers then sign in with an emailed
   one-time code rather than a password; their order history carries over. Check
   how that looks for your customers before switching.
2. **A Shopify app that can host extensions.** The extension must belong to an app
   created through Shopify CLI / the Dev Dashboard and installed on the store.
   If the Hub's existing app was created there (it has a Client ID and Secret),
   link to it; otherwise create a new app and install it.
3. **Scope and approvals** (Dev Dashboard, for that app):
   - Add the `read_customers` scope. Without it, the session token has no
     customer in it and the Hub rejects every request.
   - Request **protected customer data** access for it.
   - Request **network access** for the extension (it calls an external server).

## Deploy

1. Install Shopify CLI, then from this `shopify-app/` folder either
   `shopify app config link` (link to the existing app) or `shopify app init`.
   If the CLI asks to generate the extension's `package.json`/dependencies, run
   `shopify app generate extension --template customer_account_ui --name customer-proofs`
   once in a scratch copy and take its `package.json`, then keep **our**
   `shopify.extension.toml` and `src/ProofsPage.jsx`.
2. Edit `HUB_URL` at the top of `extensions/customer-proofs/src/ProofsPage.jsx`
   to the Hub's public address (the same as `APP_BASE_URL` on Render).
3. Preview with `shopify app dev` (press `p` for the Dev Console), using a
   development store or the real store with a test customer.
4. `shopify app deploy` to publish it.
5. In Shopify admin -> Settings -> Customer accounts -> **Customize**, add the
   "My approved proofs" page and add a link to it in the account menu.

## Switch the Hub side on

On Render, set:

| Variable | Value |
| --- | --- |
| `SHOPIFY_CLIENT_ID` | The Client ID of the app that owns the extension. |
| `SHOPIFY_EXTENSION_CLIENT_SECRET` | That app's secret - **only** if it is a different app from the one `SHOPIFY_API_SECRET_KEY` belongs to. |

Until `SHOPIFY_CLIENT_ID` is set the endpoints answer 503 and nothing is exposed.

## Gotchas learned the hard way

- **`extensions/customer-proofs/tsconfig.json` is required.** It tells the bundler
  to compile JSX with Preact (`"jsxImportSource": "preact"`). Without it, JSX
  resolves to `react/jsx-runtime`; if a parent folder happens to have React
  installed (as the Hub's repo root does) the build *succeeds* with the wrong
  library, and the page renders completely blank with no error anywhere. Do not
  delete it.
- **A blank page with no error means debug in the preview, not on the live store.**
  `shopify app dev` against a free development store, with a throwaway app
  (`shopify app config link` -> create new app) so the real app is untouched,
  prints the real build errors. `shopify app deploy` does not.
- **The App URL in `shopify.app.toml` (`hub.justshear.com`) is a placeholder that
  doesn't exist.** It only affects opening the app inside Shopify admin; the
  extension uses `HUB_URL` in `ProofsPage.jsx` instead.
- **Run Shopify CLI from Command Prompt** on this machine - PowerShell blocks its
  script wrapper.

## Status

Working in production (confirmed 2026-11-01): a logged-in customer sees their own
approved proofs, images included, with `network_access` enabled and no extra
Shopify approval needed.
