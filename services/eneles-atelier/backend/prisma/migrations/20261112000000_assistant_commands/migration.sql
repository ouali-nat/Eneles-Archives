-- A person's own slash commands for the assistant ("/name" sends the stored prompt).
CREATE TABLE "assistant_commands" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "useSelection" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_commands_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "assistant_commands_userId_idx" ON "assistant_commands"("userId");
CREATE UNIQUE INDEX "assistant_commands_userId_name_key" ON "assistant_commands"("userId", "name");

ALTER TABLE "assistant_commands" ADD CONSTRAINT "assistant_commands_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
