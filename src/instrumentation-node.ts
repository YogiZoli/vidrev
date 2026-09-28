import { errorFields, log } from "@/lib/log";

// Web process (Node.js only): anything thrown outside a request would
// otherwise vanish.
process.on("unhandledRejection", (reason) => log("error", "unhandled promise rejection in web", errorFields(reason)));
