SET search_path TO atelier, public;

ALTER TABLE "users" ADD COLUMN "supabaseUserId" TEXT;
CREATE UNIQUE INDEX "users_supabaseUserId_key" ON "users"("supabaseUserId");
