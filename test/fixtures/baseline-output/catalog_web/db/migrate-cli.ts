// Auto-generated.  Do not edit by hand.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { migrate } from "./migrate";

// Standalone migration (npm run db:migrate).  The server boot path calls the
// same migrate() from index.ts.
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "./db/migrations" });
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
