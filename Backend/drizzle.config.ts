import { defineConfig } from 'drizzle-kit';

// Used only by `npm run db:generate` to create migration SQL from src/db/schema.ts.
// Migrations are applied explicitly with `npm run db:migrate` (scripts/migrate.ts).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
