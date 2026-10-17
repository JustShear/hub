-- CreateIndex
CREATE INDEX "ArtworkOrderLineLink_orderLineId_idx" ON "ArtworkOrderLineLink"("orderLineId");

-- CreateIndex
CREATE INDEX "IntegrationFailure_relatedOrderId_idx" ON "IntegrationFailure"("relatedOrderId");

-- CreateIndex
CREATE INDEX "IntegrationFailure_relatedProofGroupId_idx" ON "IntegrationFailure"("relatedProofGroupId");

-- CreateIndex
CREATE INDEX "Notification_staffUserId_createdAt_idx" ON "Notification"("staffUserId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderNote_orderId_createdAt_idx" ON "OrderNote"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "ShopifyLineProperty_orderLineId_idx" ON "ShopifyLineProperty"("orderLineId");
