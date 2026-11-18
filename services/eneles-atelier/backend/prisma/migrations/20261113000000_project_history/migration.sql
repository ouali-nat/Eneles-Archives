-- Project-wide history: who changed each snapshot (several people when they edited together), the saver's name, the lines added and removed against the previous version, the time of the last write to a snapshot, the version a restore came from, and the record of renames that tells a renamed file from a deleted one. Rows from before this have no authors and are shown as "Unknown"; their line counts are filled in when they are first listed.
-- AlterTable
ALTER TABLE "file_history" ADD COLUMN     "linesAdded" INTEGER,
ADD COLUMN     "linesRemoved" INTEGER,
ADD COLUMN     "restoredFromId" INTEGER,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "userName" TEXT;

-- CreateTable
CREATE TABLE "file_history_authors" (
    "historyId" INTEGER NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "edits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "file_history_authors_pkey" PRIMARY KEY ("historyId","userId")
);

-- CreateTable
CREATE TABLE "file_path_moves" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_path_moves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_history_authors_projectId_userId_idx" ON "file_history_authors"("projectId", "userId");

-- CreateIndex
CREATE INDEX "file_path_moves_projectId_fromPath_idx" ON "file_path_moves"("projectId", "fromPath");

-- CreateIndex
CREATE INDEX "file_history_projectId_id_idx" ON "file_history"("projectId", "id");

-- AddForeignKey
ALTER TABLE "file_history_authors" ADD CONSTRAINT "file_history_authors_historyId_fkey" FOREIGN KEY ("historyId") REFERENCES "file_history"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_path_moves" ADD CONSTRAINT "file_path_moves_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A snapshot's last write is its creation until it is written again.
UPDATE "file_history" SET "updatedAt" = "createdAt";
