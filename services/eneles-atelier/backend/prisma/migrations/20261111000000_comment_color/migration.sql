SET search_path TO atelier, public;

-- A comment's highlight color: one of the interface's named hues, or null for the default (amber).
ALTER TABLE "comment_threads" ADD COLUMN "color" TEXT;
