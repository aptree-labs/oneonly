import { fileURLToPath } from "node:url";
import { defineConfig, configDefaults } from "vitest/config";
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) },
  },
  test: {
    include: ["packages/**/*.test.ts", "apps/web/src/**/*.test.ts"],
    exclude: [
      ...configDefaults.exclude,
      ...(process.env.CREATOR_FEE_RUNTIME_TESTS === "true"
        ? []
        : [
            "packages/fee-escrow/tests/runtime.test.ts",
            "packages/fee-escrow/tests/meteora.test.ts",
            "packages/fee-escrow/tests/damm.test.ts",
          ]),
    ],
    testTimeout: 20000,
  },
});
