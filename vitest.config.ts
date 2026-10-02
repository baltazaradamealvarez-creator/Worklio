import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://worklio_app:worklio_app@localhost:5432/worklio_test",
      DIRECT_URL: "postgresql://worklio_owner:worklio_owner@localhost:5432/worklio_test",
      APP_SECRET: "test-secret-test-secret-test-secret",
      APP_URL: "http://localhost:3000",
      EMAIL_PROVIDER: "console",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: "./storage/test",
    },
  },
});
