import type { DbOrTx } from "../accounts";
import { enqueue } from "@/jobs/enqueue";
import { type EmitInput, emitEventSafely, kickWith } from "./events";

// For code that runs in the web service (clicks, inbound hooks, manual
// "mark as posted"): the outbox row is written, then the worker is woken.
export function emitFromWeb(db: DbOrTx, input: EmitInput): Promise<void> {
  return emitEventSafely(db, input, kickWith(enqueue));
}
