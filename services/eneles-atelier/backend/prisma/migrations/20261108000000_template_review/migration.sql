-- Shared templates are reviewed before other people can see them.
CREATE TYPE "TemplateReview" AS ENUM ('none', 'pending', 'approved', 'rejected');

ALTER TABLE "templates"
  ADD COLUMN "review" "TemplateReview" NOT NULL DEFAULT 'none',
  ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "reviewNote" TEXT,
  ADD COLUMN "reportedBy" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- Templates already shared were never reviewed: they wait in the queue.
UPDATE "templates" SET "review" = 'pending' WHERE "isPublic" = true;

CREATE INDEX "templates_isPublic_review_idx" ON "templates"("isPublic", "review");
