SET search_path TO atelier, public;

-- CreateTable
CREATE TABLE "email_messages" (
    "id" SERIAL NOT NULL,
    "resendId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipients" TEXT[],
    "sender" TEXT,
    "subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "bounceType" TEXT,
    "bounceMessage" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_events" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "webhookId" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_resendId_key" ON "email_messages"("resendId");

-- CreateIndex
CREATE INDEX "email_messages_createdAt_idx" ON "email_messages"("createdAt");

-- CreateIndex
CREATE INDEX "email_messages_status_createdAt_idx" ON "email_messages"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_events_webhookId_key" ON "email_events"("webhookId");

-- CreateIndex
CREATE INDEX "email_events_messageId_occurredAt_idx" ON "email_events"("messageId", "occurredAt");

-- AddForeignKey
ALTER TABLE "email_events" ADD CONSTRAINT "email_events_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "email_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
