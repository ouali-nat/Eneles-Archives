-- GitHub sync for projects.
CREATE TABLE "project_github_links" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "repo" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "lastCommitSha" TEXT,
    "fileShas" JSONB NOT NULL DEFAULT '{}',
    "lastSyncedAt" TIMESTAMP(3),
    "linkedById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_github_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_github_links_projectId_key" ON "project_github_links"("projectId");

ALTER TABLE "project_github_links" ADD CONSTRAINT "project_github_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
