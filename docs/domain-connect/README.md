# Domain Connect template (D-38)

`vidrev.app.links.json` is our Domain Connect template: one CNAME from the creator's subdomain (the `host` parameter, e.g. `go`) to `customers.vidrev.app`. Once a DNS provider has onboarded it, the creator's `/app/domain` page shows **Connect automatically** for domains on that provider; everyone else gets the manual guide. The app finds support by itself (discovery during the first domain check), so no code change is needed when a provider goes live.

## Onboarding (owner, after Phase 5 is live on vidrev.app)

1. Signing key. Generate an RSA key pair (2048 bit) on your own machine:

   ```text
   openssl genrsa -out dc-private.pem 2048
   openssl rsa -in dc-private.pem -pubout -outform DER | openssl base64 -A
   ```

2. Publish the public key in the vidrev.app zone on Cloudflare: TXT record, name `_dck1`, value `p=1,a=RS256,d=<the base64 output>`. (Long keys may be split into several TXT records `p=1`, `p=2`; see the Domain Connect spec.)
3. Set `DOMAIN_CONNECT_PRIVATE_KEY` (the full PEM of `dc-private.pem`) and `DOMAIN_CONNECT_KEY_HOST=_dck1` on both Railway services. Keep the PEM file offline afterwards.
4. Open a pull request with `vidrev.app.links.json` to https://github.com/Domain-Connect/Templates (file name `vidrev.app.links.json`).
5. After the merge, ask each provider to onboard it. Cloudflare: email domain-connect@cloudflare.com with the template link. GoDaddy, IONOS and others read the Templates repository or have their own form; the repository README lists the contacts.

`logoUrl` must exist on vidrev.app before step 4. The product name "VidRev" in the template is an assumption from the domain (proposal P5-09); change it before the pull request if the name differs.
