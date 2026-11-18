-- Thry, the editor theme in the interface's own colors, is the default. The stored theme was never read by the site before this (the choice lived only in the browser), so every row still holds the old column default and none of them is a person's choice: all of them move to Thry.
ALTER TABLE "editor_settings" ALTER COLUMN "editorTheme" SET DEFAULT 'thry';
UPDATE "editor_settings" SET "editorTheme" = 'thry';
