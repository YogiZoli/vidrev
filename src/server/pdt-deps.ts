import { getDb } from "@/db/client";
import { enqueue } from "@/jobs/enqueue";
import { QUEUES } from "@/jobs/queues";
import { appBaseUrl, env } from "@/lib/env";
import { fallbackHost } from "@/lib/link-host";
import type { PdtApiDeps } from "./pdt-api";

// The live wiring of the PDT API for the route handlers.
export function pdtDeps(): PdtApiDeps {
  return {
    db: getDb(),
    fallbackHost: fallbackHost(),
    enqueueEmail: (job) => enqueue(QUEUES.sendEmail, job),
    appBaseUrl: appBaseUrl(),
    productName: env().PRODUCT_NAME,
  };
}
