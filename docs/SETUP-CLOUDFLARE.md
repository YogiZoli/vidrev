# Setup: tracked links on vidrev.app (Cloudflare for SaaS)

Owner steps to switch on Phase 5 in production. The vidrev.app zone is already on Cloudflare (nameservers `keaton` and `stephane.ns.cloudflare.com`). About 20 minutes. Nothing here costs money: 100 custom hostnames are included, then 0.10 USD per hostname per month.

Railway web service domain used below: `web-production-7b0e1f.up.railway.app`.

## 1. DNS records

Cloudflare dashboard > vidrev.app > DNS > Records > Add record. Three records, all **Proxied** (orange cloud):

| Type | Name | Target | Proxy |
| --- | --- | --- | --- |
| CNAME | `proxy-fallback` | `web-production-7b0e1f.up.railway.app` | Proxied |
| CNAME | `customers` | `proxy-fallback.vidrev.app` | Proxied |
| CNAME | `go` | `web-production-7b0e1f.up.railway.app` | Proxied |

`customers.vidrev.app` is the target every creator points their CNAME at. Never change it after the first creator has set it up. `go.vidrev.app` is the fallback link host for creators without a domain.

## 2. SSL mode

SSL/TLS > Overview > set encryption mode to **Full (strict)**. Railway serves a valid certificate for its own domain, and the Host override in step 4 also sets the SNI to it.

## 3. Cloudflare for SaaS

SSL/TLS > Custom Hostnames > **Enable Cloudflare for SaaS** (Cloudflare may ask for a payment method; the first 100 hostnames are free). Then set **Fallback Origin** to `proxy-fallback.vidrev.app` and wait until it shows Active.

## 4. Origin rule (Host header to Railway)

Rules > Overview > Create rule > **Origin Rule**.

- Name: `Link hosts to Railway`
- If incoming requests match: Custom filter expression, click **Edit expression** and paste:

  ```text
  (http.host ne "app.vidrev.app" and http.host ne "vidrev.app" and http.host ne "www.vidrev.app")
  ```

- Host Header: **Rewrite to** `web-production-7b0e1f.up.railway.app`
- Deploy.

## 5. Transform rule (keep the original host)

Rules > Overview > Create rule > **Request Header Transform Rule**.

- Name: `X-Original-Host`
- Same expression as step 4.
- Modify request header: **Set dynamic**, header name `X-Original-Host`, value `http.host`
- Deploy.

## 6. API token and zone id

1. Zone id: vidrev.app > Overview, right column "API", copy **Zone ID**.
2. Token: https://dash.cloudflare.com/profile/api-tokens > Create Token > Create Custom Token.
   - Name: `c2c-saas custom hostnames`
   - Permissions: Zone > **SSL and Certificates** > **Edit**
   - Zone Resources: Include > Specific zone > `vidrev.app`
   - Continue to summary > Create Token, copy it (shown once).

## 7. Railway variables

From the repo root in PowerShell:

```powershell
cd C:/Users/gdp/repos/c2c-saas
powershell -ExecutionPolicy Bypass -File scripts/set-secrets.ps1 -BrandDomain vidrev.app
```

It sets `BRAND_BASE_URL`, `LINK_FALLBACK_BASE_URL=https://go.vidrev.app`, `CUSTOM_HOSTNAME_CNAME_TARGET=customers.vidrev.app` and asks for the token and zone id. Then redeploy both services (Railway dashboard > service > Deployments > Redeploy).

## 8. Test

1. `https://go.vidrev.app/abcdefg` shows "This link does not exist." (the route works; a 5xx or Railway page means steps 4 or 5 are off).
2. On `/app/campaigns` each keyword now shows a `https://go.vidrev.app/...` link. Open it: you land on your opt-in page with `c2c_tid=` and `utm_*` in the address.
3. Own domain: on `/app/domain` add a subdomain of any other domain you own (not vidrev.app), add the one CNAME it shows. Within minutes the page says **Live** and you get an email; new replies then use that domain.

## Later (not needed for Phase 5)

- App on `app.vidrev.app`: part of the compliance pack right after Phase 5 (OAuth redirect URIs and `APP_BASE_URL` change together).
- Domain Connect one-click: [domain-connect/README.md](domain-connect/README.md).
