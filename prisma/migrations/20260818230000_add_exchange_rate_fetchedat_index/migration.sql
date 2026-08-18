-- CreateIndex
CREATE INDEX "ExchangeRate_currencyCode_fetchedAt_idx" ON "ExchangeRate"("currencyCode", "fetchedAt");
