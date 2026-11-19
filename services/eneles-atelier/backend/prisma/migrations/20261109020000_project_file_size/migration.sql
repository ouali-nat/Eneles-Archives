SET search_path TO atelier, public;

-- Images and other binary files in projects are stored, and counted.
ALTER TABLE "project_files" ADD COLUMN "size" INTEGER;
