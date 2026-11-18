-- Optimistic-locking counter for project files.
-- Existing rows start at 0; clients that omit `expectedVersion` are unaffected.
ALTER TABLE "project_files" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- Server-authoritative Yjs document state, one row per project.
CREATE TABLE "yjs_documents" (
    "id" SERIAL NOT NULL,
    "projectUid" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "yjs_documents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "yjs_documents_projectUid_key" ON "yjs_documents"("projectUid");

CREATE INDEX "yjs_documents_updatedAt_idx" ON "yjs_documents"("updatedAt");

ALTER TABLE "yjs_documents"
    ADD CONSTRAINT "yjs_documents_projectUid_fkey"
    FOREIGN KEY ("projectUid") REFERENCES "projects"("uid")
    ON DELETE CASCADE ON UPDATE CASCADE;
