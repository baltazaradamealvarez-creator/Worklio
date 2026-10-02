import { execFileSync, execSync } from "node:child_process";

export const TEST_DATABASE_URL = "postgresql://worklio_app:worklio_app@localhost:5432/worklio_test";
export const TEST_DIRECT_URL = "postgresql://worklio_owner:worklio_owner@localhost:5432/worklio_test";

/** Recreate the test schema and apply every migration, so each run starts hermetic. */
export default function setup() {
  execFileSync("psql", [TEST_DIRECT_URL, "-q", "-v", "ON_ERROR_STOP=1", "-c", "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"], { stdio: "pipe" });
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL, DIRECT_URL: TEST_DIRECT_URL },
  });
}
