# InGallery Product Requirements

## Product overview

InGallery is a multi-tenant photography studio application. It helps photographers organize client galleries, deliver previews and paid downloads, manage studio operations, and monitor storage and sales. The product currently combines working API-backed workflows with static screens and prototype flows; this document describes both the intended product and the implementation status visible in this repository.

## Users

- **Studio owner / photographer:** creates galleries, uploads and protects photos, configures payment providers, and manages clients, orders, team members, and studio settings.
- **Gallery visitor / buyer:** opens a shared gallery, views permitted previews, interacts with photos where enabled, and pays for access to original downloads.
- **Studio team member:** participates in studio events and assigned work according to their studio role.

## Product goals

1. Let photographers create and share polished, private galleries.
2. Protect original photos while providing fast, optimized previews.
3. Support paid gallery access using each studio's own merchant account.
4. Give studio owners a single place to manage clients, orders, team, storage, and performance.
5. Keep studio data, files, and payment configuration isolated between tenants.

## Requirements

### Platform owner console

- A platform owner signs in using the existing login screen; the server assigns platform-admin access only when the verified account email is enabled in the database allowlist.
- The platform owner can edit photographer account details, activation state, and package subscription, with a recovery email action instead of exposing or setting a photographer's password.
- Package records support owner-managed prices, billing period, usage limits, and feature flags; package cards expose only enabled features.
- Photographer package payments use the platform gateway independently of each photographer's gallery gateway configuration.
- The platform overview summarizes users, studios, galleries, subscriptions, package revenue, payment states, traffic, service health, and recent warnings/errors with suggested investigation steps.
- The studio performance report tracks 30-day anonymous gallery visits and the percentage of published galleries visited; it calculates all-time client retention from email-matched clients with multiple successful paid orders.
- The owner can view photographer accounts, studio names, registration and recent sign-in dates, package status, and account state.
- The owner can create and edit active packages (price, currency, storage, user and gallery limits) and deactivate obsolete packages.
- The owner can configure and test the platform's own package-payment provider without exposing or changing photographers' merchant credentials.
- Successful package payments are independently verified and then activate the selected tenant package for its monthly, yearly, or lifetime billing period. Platform package revenue is reported separately from gallery sales that settle to photographers.
- The owner can review recent API traffic and error responses. Logs omit request bodies and credentials and are retained for 30 days.

### Accounts and studio management

- Users can sign up, sign in, and manage their profile.
- Each studio's galleries, clients, orders, team, and settings are scoped to its owner/tenant.
- Owners can manage team members, roles, events, and assignments.
- Owners can review storage use, sales, orders, and studio activity.

### Galleries and media

- Owners can create, update, publish, and delete galleries with a title, status, price, and currency.
- Owners can upload photos and manage gallery covers and supported cover videos.
- Owners can choose a Classic, Editorial, Cinematic, or Minimal cover design per gallery; the selected design is saved and shown to clients.
- Uploads are stored privately. The original is retained, with optimized preview, medium, and large variants generated asynchronously.
- Public gallery pages expose only configured previews while locked. Full-size downloads require verified paid access.
- Gallery metadata and images are paged; visitors can load additional images as needed.
- Visitors can use supported photo likes, comments, and paid download features.
- Each gallery has a scannable, downloadable QR code that encodes the same public client gallery link the owner can already share. Scanning it opens that gallery's client view on a phone or other QR-capable device. The gallery management list implements QR preview and PNG download in the browser.
- The QR code is a convenience for opening the public link. It does not contain login credentials, grant studio/account access, or give the visitor permission to edit the gallery or its link. Gallery visibility and paid-download rules continue to apply.
- Gallery owners can download the QR code for print or digital sharing and can copy/open the underlying link. Changing the gallery's public link must be reflected in a newly generated code; an old code must not silently grant access to a different gallery.

### Orders and payments

- A buyer can start a gallery-access checkout using the gallery owner's configured ClickPesa, Malipo, or Stakaba credentials.
- Payment callbacks and status checks must be verified before access is granted.
- Successful orders receive signed, order-specific access; order totals are attributed to the gallery owner.
- Merchant credentials are encrypted at rest and are never sent to the browser.
- Studio package checkout uses the platform payment configuration, creates a separate package-payment record, verifies provider status, and activates the tenant subscription only after a confirmed payment.

### Non-functional requirements

- Enforce authentication and ownership checks for studio API operations.
- Use Supabase row-level security and server-side authorization to protect tenant data.
- Keep private originals in R2 and issue temporary signed upload/download URLs.
- Apply rate limits to sensitive public endpoints and payment status/start operations.
- Make image processing bounded and resumable from persisted image state.
- Keep server secrets out of frontend builds and browser storage.

## Scope and known gaps

- Gallery access payments and studio package payments are separate flows. Package checkout requires the platform owner to configure a supported payment provider before paid purchases can complete.
- Per-gallery QR preview and PNG download are implemented in the gallery management UI. Validate the deployed public URL configuration and the scanner experience in the target production environment.
- Several static screens are navigational/product UI and may not yet have complete backend behavior. Verify a screen's linked frontend and API implementation before treating its visual controls as shipped functionality.
- A persistent, dedicated image worker is a future scaling improvement; the current queue runs inside the API process.

## Success measures

- Gallery creation and photo upload complete without losing originals.
- Locked public galleries expose only allowed previews; successful verified payments unlock only the correct order's downloads.
- Cross-tenant access attempts are denied.
- Owners can accurately view their storage and gross paid order totals.
- Payment provider failures do not grant access or expose merchant secrets.
