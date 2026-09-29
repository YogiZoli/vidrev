# Launch checklist (Phase 12)

One ordered list. Code is done; what is left is owner action. Check the configuration at any time:

```powershell
railway run --service web npm run launch:check
```

It prints the names of missing settings, never values, and exits with 1 until everything is set.

## A. Before the LLC exists (can be done now)

1. Set the Phase 9 and Phase 10 variables (docs/SETUP-AUDIT.md, docs/SETUP-GHL.md) and run one audit of your own channel.
2. Move the app to `app.vidrev.app` (Railway custom domain, DNS only record), then `APP_BASE_URL`, the OAuth redirect URI in GCP (compliance pack section 1, item 4).
3. Resend sending domain on vidrev.app; a support mailbox (support@vidrev.app).
4. Verify vidrev.app in Google Search Console with the Google account that owns `c2c-app`.
5. Logo: a clean 120x120 PNG on a solid background (no baked-in checkerboard) and the 512 version for the Marketplace.
6. Platform Gemini key on a paid GCP project (`GEMINI_PLATFORM_API_KEY`).
7. Run the owner's channel end to end for a few days, so the quota report has real numbers.

## B. When the LLC exists

Strict order (owner, 2026-09-29, DECISIONS A-13): nothing goes to Google before step 3 is live.

1. The owner sends the LLC details; fill `[LEGAL ENTITY]`, `[ADDRESS]`, `[SUPPORT EMAIL]`, `[EFFECTIVE DATE]`, `[GOVERNING LAW]` in PRIVACY-POLICY.md and TERMS.md; legal review (B-09); remove the DRAFT line.
2. Build both pages as a GoHighLevel copy kit (one Custom Code block per section, like `design/landing/ghl-kit.html`), so the owner only pastes, saves and publishes.
3. The owner publishes them on vidrev.app at `/privacy` and `/terms`; check both live, with the home page linking the policy.
4. Only then: record the demo video (OAUTH-VERIFICATION.md section 4) and submit Google OAuth verification (section 5).
5. Run `railway run --service web npm run quota:report -- 14`, paste the numbers into QUOTA-EXTENSION.md and submit it.
6. Press "Start Public review" for the HighLevel app (docs/MARKETPLACE-LISTING.md).

## C. On launch day

1. `launch:check` says "launch ready".
2. OAuth consent screen is In production (not Testing), so tokens no longer expire weekly.
3. Founding checkout in GHL calls the provisioning webhook; buy once with a test card and confirm the magic link email arrives.
4. `/admin` shows the worker heartbeat, quota and no failed jobs.
