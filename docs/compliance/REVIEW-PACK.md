# Review pack: Google OAuth verification and Marketplace review

One place for both submissions. Every answer a reviewer asks for is also on a public page, so customers read the same text: **app.vidrev.app/trust** (permissions, YouTube data rules, security, questions) and **app.vidrev.app/data-deletion** (how to delete, what is deleted). The page text lives in `src/app/trust/content.ts`; change it there and the answers below follow.

Legal data (company name, address, governing law) comes only from `docs/compliance/legal-entity.json`. Fields marked **company** wait for it; everything else can be typed in now.

## 1. Public URLs to give both reviews

| What | URL |
| --- | --- |
| Home page | https://vidrev.app |
| Privacy Policy | https://vidrev.app/privacy (legal kit, waits for the company) |
| Terms of Service | https://vidrev.app/terms (legal kit, waits for the company) |
| Trust, permissions, security, FAQ | https://app.vidrev.app/trust |
| Data deletion instructions | https://app.vidrev.app/data-deletion |
| Help (setup, every message explained) | https://app.vidrev.app/help |
| Support and security contact | me@vidrev.app |

## 2. Google Auth Platform (consent screen and verification)

| Field | Value |
| --- | --- |
| App name | vidrev |
| User support email | owner's Google account (Google offers only own account or a Google Group) |
| App logo | docs/brand, PNG 120 |
| App home page | https://vidrev.app |
| Privacy policy link | https://vidrev.app/privacy |
| Terms of service link | https://vidrev.app/terms |
| Authorized domains | vidrev.app |
| Developer contact | me@vidrev.app |
| Scopes | openid, email, profile, youtube.force-ssl |
| Scope justification | OAUTH-VERIFICATION.md section 3 (same reason as /trust#permissions) |
| Demo video | to record (OAUTH-VERIFICATION.md section 4) |
| Organization name | **company** |

Questions Google asks and where the answer is: Limited Use, retention, revocation, deletion, no AI training: /trust#youtube and /trust#faq. Deleting data: /data-deletion.

## 3. Marketplace listing

| Field | Value |
| --- | --- |
| App name | vidrev |
| Short and long description | MARKETPLACE-LISTING.md section 2 (no platform name, A-24) |
| Scopes and justification | /trust#permissions, list "CRM sub-account" (all 11 scopes of `DEFAULT_GHL_SCOPES`) |
| Support email | me@vidrev.app |
| Support / documentation URL | https://app.vidrev.app/help (setup and messages), https://app.vidrev.app/trust (data) |
| Privacy Policy, Terms | as in section 1 |
| Data usage summary | /trust#faq, "What goes into my CRM?" and "What happens when I uninstall" |
| Uninstall behaviour | /trust#faq, and MARKETPLACE-LISTING.md section 1 |
| Demo video | to record |
| Company name, address | **company** |

## 4. Answers to the usual reviewer questions

All on /trust#faq and /data-deletion, in the same words:

- Does the app post without the user? No, every reply is approved one by one.
- What data is read, kept, for how long? /trust#youtube (30 days for YouTube data).
- What reaches the CRM? Clean Mode: only people who opted in or bought. Beast Mode (opt-in by the creator): display name and comment, deleted on day 29.
- Uninstall? Tokens and waiting installs deleted at once, syncs stop, the customer's contacts stay in their CRM, results stay in reports until the account is deleted.
- Disconnect YouTube? Grant revoked, all YouTube data of the channel deleted at once.
- Account deletion? Self-service in Settings > Account, done within minutes, confirmation email.
- AI training, selling, ads? Never.
- Security? /trust#security.

## 5. Before pressing submit

1. Company data in legal-entity.json, legal kit rebuilt and pasted (Privacy, Terms live).
2. Re-run `npm run quota:report -- 30` (QUOTA-EXTENSION.md).
3. Demo videos recorded and uploaded unlisted.
4. Read /trust and /data-deletion once more against what the app does that day.
5. No Railway address left anywhere a reviewer or a customer sees (the app answers on both hosts, so nothing breaks, but only vidrev.app is the verified domain):
   - Google OAuth client, Authorized redirect URIs: keep `https://app.vidrev.app/api/oauth/google/callback`, remove `https://web-production-7b0e1f.up.railway.app/...` and `http://localhost:3000/...`. Connect a channel once afterwards to prove it still works.
   - Marketplace app: webhook `https://app.vidrev.app/api/hooks/crm` (changed by the owner 2026-10-11), redirect `https://app.vidrev.app/api/oauth/crm/callback`, workflow action `https://app.vidrev.app/api/hooks/crm/action`, custom page `https://app.vidrev.app/crm`, conversation provider `https://app.vidrev.app/api/hooks/crm/provider`.
   - Checkout workflow webhook that creates the account: `https://app.vidrev.app/api/provisioning/ghl`.
