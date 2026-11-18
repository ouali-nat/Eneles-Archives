-- CreateEnum
CREATE TYPE "SubscriptionType" AS ENUM ('free', 'pro', 'team', 'enterprise');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('pending', 'processing', 'completed', 'error');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'canceled', 'past_due', 'incomplete', 'trialing');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'deleted');

-- CreateEnum
CREATE TYPE "ProjectAccess" AS ENUM ('private', 'view', 'edit');

-- CreateEnum
CREATE TYPE "CollaboratorRole" AS ENUM ('viewer', 'editor');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'declined');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "affiliation" TEXT,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'active',
    "location" TEXT,
    "avatarUrl" TEXT,
    "subscriptionType" "SubscriptionType" NOT NULL DEFAULT 'free',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorSecret" TEXT,
    "settings" JSONB NOT NULL DEFAULT '["system"]',
    "notificationSettings" JSONB NOT NULL DEFAULT '[true, true, true, false, true]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "browser" TEXT NOT NULL,
    "os" TEXT NOT NULL,
    "ipAddress" TEXT,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastActive" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "stripePriceId" TEXT,
    "stripeCurrentPeriodEnd" TIMESTAMP(3),
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "stripePaymentId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL,
    "description" TEXT,
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snips" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "latexContent" TEXT,
    "originalText" TEXT,
    "status" "Status" NOT NULL DEFAULT 'pending',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "snips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pdfs" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileSize" INTEGER,
    "pageCount" INTEGER,
    "latexContent" TEXT,
    "status" "Status" NOT NULL DEFAULT 'pending',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pdfs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otps" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "snipsUsed" INTEGER NOT NULL DEFAULT 0,
    "pdfPagesUsed" INTEGER NOT NULL DEFAULT 0,
    "conversionsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "uid" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'pending',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "color" TEXT,
    "access" "ProjectAccess" NOT NULL DEFAULT 'private',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "pendingAiDiff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_files" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT,
    "filePath" TEXT,
    "isMain" BOOLEAN NOT NULL DEFAULT false,
    "isFolder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_collaborators" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "CollaboratorRole" NOT NULL DEFAULT 'viewer',
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_collaborators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_invitations" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "role" "CollaboratorRole" NOT NULL DEFAULT 'viewer',
    "token" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "invitedBy" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "editor_settings" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "autoComplete" BOOLEAN NOT NULL DEFAULT false,
    "autoCloseBrackets" BOOLEAN NOT NULL DEFAULT true,
    "codeCheck" BOOLEAN NOT NULL DEFAULT true,
    "spellcheckLang" TEXT NOT NULL DEFAULT 'en',
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "editorTheme" TEXT NOT NULL DEFAULT 'vscode-dark',
    "pdfTheme" TEXT NOT NULL DEFAULT 'light',
    "fontSize" INTEGER NOT NULL DEFAULT 16,
    "fontFamily" TEXT NOT NULL DEFAULT 'Consolas',
    "lineHeight" TEXT NOT NULL DEFAULT 'normal',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "editor_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_settings" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "mainDocument" TEXT NOT NULL DEFAULT 'main.tex',
    "compiler" TEXT NOT NULL DEFAULT 'pdflatex',
    "texLiveVersion" TEXT NOT NULL DEFAULT '2024',
    "compileMode" TEXT NOT NULL DEFAULT 'normal',
    "stopOnFirstError" BOOLEAN NOT NULL DEFAULT false,
    "autoCompile" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_dictionaries" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "words" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_dictionaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_revisions" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "message" TEXT,
    "gitCommitSha" TEXT,
    "delta" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "undo_entries" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "beforeContent" TEXT NOT NULL,
    "afterContent" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "sequence" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "undo_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_token_idx" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_userId_isActive_idx" ON "sessions"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripePaymentId_key" ON "payments"("stripePaymentId");

-- CreateIndex
CREATE INDEX "payments_userId_idx" ON "payments"("userId");

-- CreateIndex
CREATE INDEX "snips_userId_idx" ON "snips"("userId");

-- CreateIndex
CREATE INDEX "pdfs_userId_idx" ON "pdfs"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_records_userId_month_year_key" ON "usage_records"("userId", "month", "year");

-- CreateIndex
CREATE INDEX "usage_records_userId_idx" ON "usage_records"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_keyHash_idx" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_userId_idx" ON "api_keys"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "projects_uid_key" ON "projects"("uid");

-- CreateIndex
CREATE INDEX "projects_userId_idx" ON "projects"("userId");

-- CreateIndex
CREATE INDEX "projects_uid_idx" ON "projects"("uid");

-- CreateIndex
CREATE UNIQUE INDEX "project_files_projectId_path_key" ON "project_files"("projectId", "path");

-- CreateIndex
CREATE INDEX "project_files_projectId_idx" ON "project_files"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_collaborators_projectId_userId_key" ON "project_collaborators"("projectId", "userId");

-- CreateIndex
CREATE INDEX "project_collaborators_userId_idx" ON "project_collaborators"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_invitations_token_key" ON "project_invitations"("token");

-- CreateIndex
CREATE INDEX "project_invitations_token_idx" ON "project_invitations"("token");

-- CreateIndex
CREATE INDEX "project_invitations_email_idx" ON "project_invitations"("email");

-- CreateIndex
CREATE INDEX "project_invitations_email_status_idx" ON "project_invitations"("email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_invitations_projectId_email_key" ON "project_invitations"("projectId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "editor_settings_userId_key" ON "editor_settings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_settings_projectId_key" ON "project_settings"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "user_dictionaries_userId_key" ON "user_dictionaries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_revisions_projectId_sequence_key" ON "project_revisions"("projectId", "sequence");

-- CreateIndex
CREATE INDEX "project_revisions_projectId_idx" ON "project_revisions"("projectId");

-- CreateIndex
CREATE INDEX "project_revisions_projectId_createdAt_idx" ON "project_revisions"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "undo_entries_projectId_idx" ON "undo_entries"("projectId");

-- CreateIndex
CREATE INDEX "undo_entries_projectId_sequence_idx" ON "undo_entries"("projectId", "sequence");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snips" ADD CONSTRAINT "snips_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pdfs" ADD CONSTRAINT "pdfs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otps" ADD CONSTRAINT "otps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_files" ADD CONSTRAINT "project_files_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_invitations" ADD CONSTRAINT "project_invitations_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "editor_settings" ADD CONSTRAINT "editor_settings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_dictionaries" ADD CONSTRAINT "user_dictionaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_revisions" ADD CONSTRAINT "project_revisions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "undo_entries" ADD CONSTRAINT "undo_entries_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "user_macros" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "expansion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_macros_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_macros_userId_idx" ON "user_macros"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_macros_userId_name_key" ON "user_macros"("userId", "name");

-- AddForeignKey
ALTER TABLE "user_macros" ADD CONSTRAINT "user_macros_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable (file history: per-file version snapshots, 30-day retention)
CREATE TABLE "file_history" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "label" TEXT,
    "userId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_history_projectId_filePath_version_key" ON "file_history"("projectId", "filePath", "version");

-- CreateIndex
CREATE INDEX "file_history_projectId_filePath_idx" ON "file_history"("projectId", "filePath");

-- CreateIndex
CREATE INDEX "file_history_projectId_filePath_createdAt_idx" ON "file_history"("projectId", "filePath", "createdAt");

-- CreateIndex
CREATE INDEX "file_history_expiresAt_idx" ON "file_history"("expiresAt");

-- AddForeignKey
ALTER TABLE "file_history" ADD CONSTRAINT "file_history_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

ALTER TABLE snips ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE otps ENABLE ROW LEVEL SECURITY;

CREATE POLICY snips_select_policy ON snips FOR SELECT USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY snips_insert_policy ON snips FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY snips_update_policy ON snips FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY snips_delete_policy ON snips FOR DELETE USING ("userId" = current_setting('app.current_user_id', true)::integer);

CREATE POLICY pdfs_select_policy ON pdfs FOR SELECT USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY pdfs_insert_policy ON pdfs FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY pdfs_update_policy ON pdfs FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY pdfs_delete_policy ON pdfs FOR DELETE USING ("userId" = current_setting('app.current_user_id', true)::integer);

CREATE POLICY sessions_select_policy ON sessions FOR SELECT USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY sessions_insert_policy ON sessions FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY sessions_update_policy ON sessions FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY sessions_delete_policy ON sessions FOR DELETE USING ("userId" = current_setting('app.current_user_id', true)::integer);

CREATE POLICY usage_records_select_policy ON usage_records FOR SELECT USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY usage_records_insert_policy ON usage_records FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY usage_records_update_policy ON usage_records FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY usage_records_delete_policy ON usage_records FOR DELETE USING ("userId" = current_setting('app.current_user_id', true)::integer);

CREATE POLICY api_keys_select_policy ON api_keys FOR SELECT USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY api_keys_insert_policy ON api_keys FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY api_keys_update_policy ON api_keys FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY api_keys_delete_policy ON api_keys FOR DELETE USING ("userId" = current_setting('app.current_user_id', true)::integer);

CREATE POLICY subscriptions_select_policy ON subscriptions FOR SELECT USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY subscriptions_insert_policy ON subscriptions FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY subscriptions_update_policy ON subscriptions FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY subscriptions_delete_policy ON subscriptions FOR DELETE USING ("userId" = current_setting('app.current_user_id', true)::integer);

CREATE POLICY payments_select_policy ON payments FOR SELECT USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY payments_insert_policy ON payments FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY payments_update_policy ON payments FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY payments_delete_policy ON payments FOR DELETE USING ("userId" = current_setting('app.current_user_id', true)::integer);

CREATE POLICY otps_select_policy ON otps FOR SELECT USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY otps_insert_policy ON otps FOR INSERT WITH CHECK ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY otps_update_policy ON otps FOR UPDATE USING ("userId" = current_setting('app.current_user_id', true)::integer);
CREATE POLICY otps_delete_policy ON otps FOR DELETE USING ("userId" = current_setting('app.current_user_id', true)::integer);
