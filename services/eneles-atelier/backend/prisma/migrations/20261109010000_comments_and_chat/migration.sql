SET search_path TO atelier, public;

-- Comments on project files, and the project chat.
CREATE TABLE "comment_threads" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "anchorStart" TEXT,
    "anchorEnd" TEXT,
    "quote" TEXT NOT NULL,
    "offset" INTEGER NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" INTEGER,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "comment_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "comment_messages" (
    "id" SERIAL NOT NULL,
    "threadId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    CONSTRAINT "comment_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_chat_messages" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "comment_threads_projectId_path_idx" ON "comment_threads"("projectId", "path");
CREATE INDEX "comment_messages_threadId_idx" ON "comment_messages"("threadId");
CREATE INDEX "project_chat_messages_projectId_createdAt_idx" ON "project_chat_messages"("projectId", "createdAt");

ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_threads" ADD CONSTRAINT "comment_threads_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "comment_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comment_messages" ADD CONSTRAINT "comment_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_chat_messages" ADD CONSTRAINT "project_chat_messages_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_chat_messages" ADD CONSTRAINT "project_chat_messages_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
