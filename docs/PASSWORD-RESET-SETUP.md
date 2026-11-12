# Password reset: switching it on in production

Password reset is built but stays **OFF in production** until all three settings below are in Vercel **and** migration 020 is applied.
While it is off, the "Forgot password?" page says *"Password reset is not available yet."* It never falls back to Resend's shared
test sender (`onboarding@resend.dev`).

| Vercel variable | Example | Why |
|---|---|---|
| `RESEND_API_KEY` | `re_…` (secret) | sends the reset and "your password was changed" emails |
| `RESEND_FROM_EMAIL` | `RoboValley <no-reply@mail.techytree.in>` | must be an address on a domain verified in Resend; `@resend.dev` is refused |
| `APP_URL` | `https://app.techytree.in` | the app's own address. Reset links are built from this, never from the request, so a forged `Host` header cannot send people to another site |

`RESEND_FROM_EMAIL` is also used by the sign-up code emails when `OTP_PROVIDER=resend`, so setting it improves those too.

## 1. Verify a sending domain in Resend

Use a sub-domain that only sends mail, for example `mail.techytree.in`, so the website's own email (if any) is not affected.

1. Sign in at resend.com → **Domains** → **Add Domain** → enter `mail.techytree.in` → choose the region nearest your users → **Add**.
2. Resend now shows the DNS records for that domain. **Copy the exact values from that screen**; the table below only shows their usual shape.

| Type | Name (host) shown by Resend | Value (shape) | Priority |
|---|---|---|---|
| MX | `send.mail` | `feedback-smtp.<region>.amazonses.com` | 10 |
| TXT (SPF) | `send.mail` | `v=spf1 include:amazonses.com ~all` | – |
| TXT (DKIM) | `resend._domainkey.mail` | a long `p=MIGfMA0G…` key | – |
| TXT (DMARC, recommended) | `_dmarc` | `v=DMARC1; p=none;` | – |

## 2. Add the records at Hostinger

1. Sign in to Hostinger **hPanel** → **Domains** → `techytree.in` → **DNS / Nameservers** → **DNS records**.
   - If that page says the domain uses **other nameservers** (for example Cloudflare), add the records there instead; Hostinger's table is then ignored.
2. For each record: **Add record** → choose the **Type** → in **Name** type only the host part Resend shows (Hostinger adds `.techytree.in` itself,
   so type `send.mail`, not `send.mail.techytree.in`) → paste the **Value** exactly → for MX set **Priority 10** → TTL can stay at the default → **Add record**.
3. If a `_dmarc` TXT record already exists, do not add a second one; keep the existing one.
4. Back in Resend → the domain → **Verify DNS records**. It is often verified within minutes; DNS can take up to 48 hours.
   All records must show **Verified** before any mail is sent.

## 3. Create the API key

Resend → **API Keys** → **Create API Key** → name `robovalley-production` → permission **Sending access** → domain **mail.techytree.in** → **Add**.
Copy the key once (Resend does not show it again). Do not paste it into chat, email or a file in the repository.

## 4. Set the variables in Vercel

1. Vercel → the RoboValley app project → **Settings** → **Environment Variables**.
2. Add, for the **Production** environment only:
   - `RESEND_API_KEY` = the key from step 3 (mark it **Sensitive**)
   - `RESEND_FROM_EMAIL` = `RoboValley <no-reply@mail.techytree.in>`
   - `APP_URL` = `https://app.techytree.in` (no trailing slash; it must be `https`)
3. Environment variables only take effect on a **new deployment**: **Deployments** → the latest Production deployment → **⋯** → **Redeploy**.

## 5. Apply migration 020 (after taking a backup)

```
node --env-file=<file with the production DATABASE_URL> scripts/migrate.mjs --expect-db <database name> --status          # read-only: what is applied
node --env-file=<file with the production DATABASE_URL> scripts/migrate.mjs --expect-db <database name> --only 020          # dry run
node --env-file=<file with the production DATABASE_URL> scripts/migrate.mjs --expect-db <database name> --only 020 --apply  # apply
```
Migration 020 does not depend on 019 and 019 does not depend on 020. Undo: `db/rollback/020_down.sql` (it refuses once a password has
been changed through a reset, because that would make signed-out sessions valid again).

## 6. Check it

1. Open `https://app.techytree.in/forgot-password`: the form shows (not "not available yet").
2. Ask for a link for your own account; the email arrives from `no-reply@mail.techytree.in` within a minute (check spam the first time).
3. Open the link on a phone, choose a new password: you see "Your password was changed", you get a second email
   ("Your RoboValley password was changed"), and any other device where you were signed in is signed out.
4. Ask for a link for an address that has no account: you see the **same** message, and no email is sent.
