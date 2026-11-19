import { defineConfig, env } from 'prisma/config';
import { config } from 'dotenv';

// Load the same env file the app loads (see ConfigModule in app.module.ts), so `npx prisma migrate …` targets the database the running backend uses. Variables already set in the environment (e.g. on Railway) always win.
config({ path: `.env.${process.env.NODE_ENV || 'development'}`, quiet: true });
config({ path: '.env', quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
