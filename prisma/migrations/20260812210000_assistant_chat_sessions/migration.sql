-- CreateTable: AssistantChatSession — saved "Ask Qubere" chat threads per user/account
CREATE TABLE "AssistantChatSession" (
    "id"        TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "messages"  JSONB NOT NULL,
    "history"   JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssistantChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantChatSession_accountId_userId_updatedAt_idx"
  ON "AssistantChatSession"("accountId", "userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "AssistantChatSession"
  ADD CONSTRAINT "AssistantChatSession_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
