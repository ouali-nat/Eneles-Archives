-- The auto-complete switch was never read by the editor, which always
-- completed as you typed. It now is, so stored values start out matching
-- what everyone was already getting.
ALTER TABLE "editor_settings" ALTER COLUMN "autoComplete" SET DEFAULT true;
UPDATE "editor_settings" SET "autoComplete" = true;
