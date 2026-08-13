-- DropIndex
DROP INDEX "subscriptions_userId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

