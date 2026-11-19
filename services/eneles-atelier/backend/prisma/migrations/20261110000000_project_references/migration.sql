SET search_path TO atelier, public;

-- A project can be a reference paper attached to another project.
ALTER TABLE "projects" ADD COLUMN "referenceOfId" INTEGER;
ALTER TABLE "projects" ADD COLUMN "arxivId" TEXT;

CREATE INDEX "projects_referenceOfId_idx" ON "projects"("referenceOfId");

ALTER TABLE "projects" ADD CONSTRAINT "projects_referenceOfId_fkey" FOREIGN KEY ("referenceOfId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
