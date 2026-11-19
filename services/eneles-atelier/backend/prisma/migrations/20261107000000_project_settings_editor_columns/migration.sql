SET search_path TO atelier, public;

-- Editor preferences that schema.prisma declares but no earlier migration created.
-- IF NOT EXISTS: databases synced with `db push` already have them.
ALTER TABLE "project_settings" ADD COLUMN IF NOT EXISTS "macrosEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "project_settings" ADD COLUMN IF NOT EXISTS "snippetsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "project_settings" ADD COLUMN IF NOT EXISTS "tabSize" INTEGER NOT NULL DEFAULT 4;
