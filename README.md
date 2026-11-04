# InGallery

This project contains the TypeScript frontend and a Node/Express API for the InGallery photography SaaS experience. Supabase provides authentication and persistence. Firebase is not used.

## Product and architecture docs

- [Product requirements (`prd.md`)](prd.md) describes InGallery's users, goals, core requirements, success measures, and known gaps.
- [System architecture (`architecture.md`)](architecture.md) explains the frontend, API, Supabase, private R2 media storage, payment providers, upload/payment data flows, security boundaries, and deployment shape.

The gallery management list provides a QR preview and PNG download for each gallery. Each code encodes the existing public client gallery URL, so scanning it opens the same gallery view as the share link and follows the same preview and payment rules. A QR code is only a link: it does not provide account access or gallery editing permissions. QR generation runs locally in the browser using the `qrcode` dependency.

These documents describe the current repository as well as intended behavior. Update them when product scope, API behavior, data ownership, or infrastructure changes.

## Scripts

- `npm install`
- `npm run dev`
- `npm run dev:server`
- `npm run build`
- `npm run build:server`
- `npm run start:server`
- `npm test`

## Environment

Copy `.env.example` to `.env` for the API server and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`, `FRONTEND_ORIGIN`, and `PORT`. Set `VITE_API_BASE_URL` to the Express API URL and `VITE_PUBLIC_FRONTEND_URL` to the frontend origin used in gallery share links and QR codes. Never expose the Supabase service-role key, payment encryption key, or Cloudflare R2 secret key to the browser.

Required server-side storage configuration:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`

`R2_PUBLIC_URL` is optional and is only used by development/demo behavior. Real gallery files stay in a private R2 bucket. Never put R2 credentials or the Supabase service-role key in frontend environment variables.

The API applies the registered SQL migrations on startup when `SUPABASE_DB_URL` is configured. This includes gallery metadata, tenant storage quota, preview dimensions, gallery interactions, image variants, cover videos, studio logo storage, and per-gallery cover designs. `SUPABASE_DB_URL` is the Postgres connection string from Supabase, not the publishable or secret API key.

Generate a stable 32-byte hex key for `PAYMENT_CREDENTIALS_ENCRYPTION_KEY` with `openssl rand -hex 32`. Keep the same key in the API host's secret manager across deployments and backups; losing or rotating it makes saved merchant credentials undecryptable. Do not use a `VITE_` prefix.

Photographers connect their own ClickPesa, Malipo by Tunzaa, or Stakaba merchant account in Studio Settings. Gallery checkouts use the gallery owner's selected credentials; the application does not fall back to platform payment credentials. Configure each merchant account to settle directly to that photographer. ClickPesa has no sandbox; Malipo and Stakaba support sandbox keys. Set `PUBLIC_API_BASE_URL` to the public API origin, configure the Malipo callback at `POST /api/payments/malipo/callback`, the ClickPesa webhook at `POST /api/payments/clickpesa/webhook`, and each Stakaba merchant's dashboard webhook at `POST /api/payments/stakaba/webhook`. Set each ClickPesa hosted application's Return URL to the public frontend's `/payment_pending_status/code.html` page.

Stakaba collection checkout currently supports whole-number TZS prices and M-Pesa, Mixx by Yas (`TigoPesa`), Airtel Money, and HaloPesa. Photographers select their sandbox/live key type in Settings. The API verifies every Stakaba webhook or status poll against the merchant's transaction API before granting buyer access.

Paid access is granted per verified order, not by making the gallery public. The buyer receives an HMAC-signed token for their successful order; paid original/variant endpoints require it, while unpaid visitors only receive the configured previews. Dashboard sales are gross paid order totals separated by currency, scoped to the photographer's own `owner_id`; provider fees and settlement adjustments are not included.

## Image upload and delivery

1. The authenticated API checks gallery ownership and tenant quota, reserves the original file size, and returns a short-lived signed R2 PUT URL.
2. The browser uploads the original bytes directly to R2. Object keys are tenant/gallery scoped and include a random identifier; the original is not recompressed or overwritten.
   The browser stages selected files in small batches and uploads up to four original photos concurrently to reduce per-file wait time without reducing image quality.
3. The API verifies the uploaded object and reservation, records the original metadata, and enqueues variant work. The request does not wait for image decoding/resizing.
4. A bounded API-side background queue uses Sharp to create WebP preview (max 380×480), medium (max 1200×1500), and large (max 2000×2500) variants. It stores them under separate immutable keys beside the original and tracks `queued`, `processing`, `ready`, or `failed` in `gallery_images`.
   Standalone gallery covers are also converted asynchronously to a separate WebP cover preview; choosing a gallery photo as the cover reuses that photo's generated preview.
5. Variants are quota-accounted in addition to the original. Failed processing leaves the original intact and reports a failed preview state; unlocked clients can still download the original.
6. Public gallery metadata is paged in batches of 60. The browser uses lazy-loaded responsive `srcset` images and a Load More control. Locked galleries only receive preview URLs for the first 10 images.
7. Photo/lightbox display uses optimized variants only. Original download URLs are separately signed only when the gallery is unlocked, with the original filename in `Content-Disposition`.

The API does not proxy normal preview or original-download bytes: the browser downloads directly from R2 using temporary signed URLs. The ZIP “Download All” endpoint is an intentional server-side stream. Variant responses use private, long-lived cache metadata; keys derive from each randomly named original and are not reused for a different upload. Locked public gallery metadata uses a short private browser cache; paid/unlocked gallery responses and private studio data are not cached.

The background queue is persisted as database image status and can resume queued work. The current worker runs inside the API process with two concurrent image jobs; a dedicated durable worker/queue is recommended before running multiple API replicas or processing very high image volumes.

## Local image-system test

1. Copy `.env.example` to `.env`, use real local-development Supabase/R2 values, and keep all server-only keys in the API environment.
2. Set `SUPABASE_DB_URL` so the API startup applies the image-variant migration; set `FRONTEND_ORIGIN` to the Vite origin.
3. Start `npm run dev:server` and `npm run dev` in separate terminals.
4. Sign in, create a gallery, and upload a photo. The upload queue should complete after the original is stored; the gallery shows a “Preparing preview” tile until variant processing finishes.
5. Inspect R2 for the untouched uploaded object plus `.preview.webp`, `.medium.webp`, and `.large.webp` objects. Confirm the Supabase image row is `ready` with variant paths and dimensions.
6. In browser Network tools, confirm gallery tiles request WebP variants directly from R2 and that opening a photo requests the large variant—not the original. Download an unlocked photo and verify the downloaded filename, format, and byte size match the original upload.
7. For quota and tenant-isolation checks, use separate test tenants and verify that another tenant cannot get an upload URL or photo metadata for the first tenant.

`npm test`, `npm run build`, and `npm run build:server` are the local regression/build checks.

## Shared navigation

All 15 static screens load `shared-nav.js`, which injects the same desktop/mobile sidebar and explicit routes. Galleries opens `ingallery_photography_studio_platform/code.html`; dashboard, clients, orders, storage, performance, settings, team, and create-gallery routes are shared across every screen.

## Platform administration

The platform owner uses the same `/index.html` sign-in page. Migration `20261008_platform_admin.sql` adds the server-side `platform_admins` allowlist and seeds the owner email configured for this installation. The API verifies the Supabase-authenticated email against that table and redirects an enabled owner to `/platform_admin/code.html`; a browser role value alone never grants admin access. Do not store the owner's password in source code, SQL, or frontend configuration. The Supabase Auth account must already exist with a password set through a secure account-management path.

The admin console uses a vertical side menu, system-wide overview metrics, package revenue and payment history, photographer account editing, package reassignment, account activation controls, and password recovery emails. The original monthly packages are Starter (TZS 15,000), Professional (TZS 35,000), Studio (TZS 75,000), and Agency (TZS 120,000). The owner can edit prices, limits, watermark/support levels, and package feature switches; enabled features appear in the public package catalog. Platform package payment credentials are encrypted using `PAYMENT_CREDENTIALS_ENCRYPTION_KEY`; they are used only for photographer package purchases and remain separate from each photographer's gallery payment credentials. Configure and test the system-owned gateway in Platform Admin before photographers buy a paid package. Package payment status is verified with that gateway before a database transaction activates the selected subscription. Configure `PUBLIC_API_BASE_URL` and provider callback URLs for `/api/platform/payments/malipo/callback`, `/api/platform/payments/clickpesa/webhook`, and `/api/platform/payments/stakaba/webhook`. Migrations `20261008`–`20261011` add the allowlist, payment ledger, feature flags, restored package definitions, subscription assignment function, and request log schema. API startup applies registered migrations when `SUPABASE_DB_URL` is configured. Request logs omit request bodies and retain route-level traffic for 30 days. Add the deployed `/reset-password.html` URL (and local `http://localhost:5173/reset-password.html` for development) to Supabase Auth's allowed redirect URLs so photographer password recovery emails can return to this application.

## Deployment

The root `render.yaml` configures the frontend as a Render static site. Connect the GitHub repository in Render and set `VITE_API_BASE_URL` to the public URL of the separately hosted Express API. Vite embeds this value during the build. Set the API's `FRONTEND_ORIGIN` to the Render site origin. Keep Supabase service-role, database, payment-encryption, and R2 credentials on the API host only.

The static frontend includes a Vercel config. The API requires a Node host with Sharp, the server-only Supabase/R2 environment, and access to the Supabase Postgres migration connection. For very large workloads, move the persisted image queue to a dedicated worker process before scaling API replicas.
