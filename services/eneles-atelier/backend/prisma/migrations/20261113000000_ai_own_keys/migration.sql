-- People's own model keys (sealed), their assistant preferences, platform-wide settings, and whose key paid for each AI call.
CREATE TABLE "ai_provider_keys" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "sealedKey" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "baseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ai_provider_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_provider_keys_userId_provider_key" ON "ai_provider_keys"("userId", "provider");

ALTER TABLE "ai_provider_keys" ADD CONSTRAINT "ai_provider_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ai_preferences" (
    "userId" INTEGER NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "temperature" DOUBLE PRECISION,
    "maxOutputTokens" INTEGER,
    "systemNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_preferences_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "ai_preferences" ADD CONSTRAINT "ai_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "platform_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" INTEGER,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "ai_usage" ADD COLUMN "keySource" TEXT;
