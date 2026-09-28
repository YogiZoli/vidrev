import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/**/*.int.test.ts"] },
      },
      {
        extends: true,
        // Each integration test file on its own fresh database (see the file for why).
        test: { name: "integration", include: ["src/**/*.int.test.ts"], setupFiles: ["src/test-setup/isolated-db.ts"] },
      },
    ],
  },
});
