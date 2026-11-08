# Supabase setup

The app uses Supabase Auth for shop-owner accounts and the `platform-api` Edge Function for access requests, developer administration, and tenant-scoped offline sync.

## Local app configuration

Copy `.env.example` to `.env.local` and set the project URL and publishable key. Never put a Supabase `service_role` key in the Next.js app or a `NEXT_PUBLIC_` variable.

## Developer access

1. Create the first developer user in Supabase Auth, or create an account from the app's sign-in page.
2. In Supabase Dashboard → Edge Functions → Secrets, set `DEVELOPER_ADMIN_EMAILS` to the exact developer email address. Multiple addresses can be comma-separated.
3. Sign in at `/developer`. The Edge Function checks this allowlist on every developer-only request; client-side role metadata is not trusted.

## Shop-owner onboarding

- Owners can create an account at `/`, confirm their email if prompted, sign in, and submit a shop-access request.
- A developer approves or declines requests in `/developer`. Approving a request generates a four-digit store PIN for the owner's local admin tools.
- If an owner cannot sign up, a developer can provision an account there. The app generates a strong one-time email password, shows it only once, and requires the owner to replace it on first sign-in. It also generates a separate four-digit numeric store PIN for the local owner tools.
- The store PIN is not an account password. Owners should change it after signing in using the owner PIN settings.
- Stores created before PIN provisioning was added continue to use the legacy first-run PIN `0427` until it is changed in owner settings.
- After checkout, owners can download a PDF receipt or use the device share sheet to send it through a supported messaging app. The WhatsApp shortcut opens the selected customer's chat with a ready-to-send note; attach the downloaded PDF if the browser cannot share files directly.
- The owner inventory view supports low/out-of-stock and category filters, sorting by stock or price, a filtered inventory CSV, and a separate restock-list CSV.
- The owner **Shop operations** view supports counted-stock adjustments with reasons, supplier purchase receiving (including stock and latest cost updates), cash/UPI expense records, item-level sale returns, Khata collections, cash-drawer closing/variance, filtered history, and CSV export. Entries are saved locally first and sync when online.
- Return processing restores stock and updates the recorded Khata balance when applicable. It does not move cash or initiate a UPI refund; the owner must send any external refund separately. Cash-close estimates use the recorded opening float, cash sales, cash returns, and cash-paid expenses.
- The developer console supports store search by phone, area/status/feature filters, configurable sorting, bulk pause/restore for selected visible stores, and CSV export of the filtered results.
- Developers can add private support notes to a store, change feature access for selected stores in bulk, and review the recent platform audit log. Support notes and audit entries are visible to developer accounts only.
- A developer can suspend or restore a store and grant or revoke each platform feature. Stores remain isolated by their server-assigned store ID.
- After the owner signs in, each active team member signs in at the counter with their name and 4–8 digit PIN. Sign-in starts a shift; **End shift** records clock-out. Owners can manage team access, set hourly rates, review attendance, and export a CSV from **Team & hours**.
- Shift records and hourly rates are stored locally first and sync to the store's Supabase data when online. The wage report is an estimated gross-pay calculation from completed shift time and the rate captured at clock-in; it does not calculate breaks, overtime, deductions, tax, or payroll payments.

## Database and Edge Function

The SQL migrations in `supabase/migrations/` define tenant-scoped POS tables with row-level security enabled. Apply the migration that adds `operations_events`, `developer_store_notes`, and `platform_audit_log` before using the operations sync and developer support/audit tools. The `platform-api` function uses the Supabase service role only on the server, verifies the caller's Auth session, checks developer allowlisting or store membership, and derives the store ID from that membership.

Deploy the function from `supabase/functions/platform-api/index.ts` after changing its source. Keep `verify_jwt` enabled. Supabase's Edge Function runtime supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; the app must never receive the latter.
