-- DECISIONS A-21 (owner, 2026-10-07): Standard 25 USD a month; the yearly plan row comes from the seeds.
UPDATE "plans" SET "price_label" = '$25/month', "price_cents" = 2500, "price_currency" = 'USD' WHERE "code" = 'standard_monthly' AND "price_cents" IS NULL;
