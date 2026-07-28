-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('NEW', 'ARTWORK_REQUIRED', 'PROOFING_IN_PROGRESS', 'WAITING_CUSTOMER', 'PARTIALLY_APPROVED', 'READY_FOR_EXPORT', 'PARTIALLY_EXPORTED', 'EXPORTED_FOR_PRINT', 'IN_PRODUCTION', 'PARTIALLY_COMPLETE', 'READY_TO_PACK', 'PACKING', 'FULFILLED', 'ON_HOLD', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrderProofSummary" AS ENUM ('NO_PROOFS_REQUIRED', 'PROOFS_NOT_STARTED', 'PROOFS_IN_PROGRESS', 'WAITING_ON_CUSTOMER', 'CHANGES_REQUESTED', 'PARTIALLY_APPROVED', 'ALL_REQUIRED_PROOFS_APPROVED', 'PARTIALLY_EXPORTED', 'ALL_REQUIRED_PROOFS_EXPORTED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "PropertyDetectedType" AS ENUM ('TEXT', 'SELECTION', 'URL', 'FILE_UPLOAD', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ProofRequirementValue" AS ENUM ('REQUIRED', 'NOT_REQUIRED', 'PARTIALLY_REQUIRED', 'UNDETERMINED');

-- CreateEnum
CREATE TYPE "NoProofReason" AS ENUM ('UNPRINTED_PRODUCT', 'REPEAT_JOB_PREVIOUS_ARTWORK', 'APPROVED_STANDARD_LOGO', 'CUSTOMER_SUPPLIED_PRODUCTION_READY', 'INTERNAL_STAFF_ORDER', 'OTHER');

-- CreateEnum
CREATE TYPE "DecorationMethod" AS ENUM ('EMBROIDERY', 'DIGITAL_PRINT_DTF', 'SCREEN_PRINT', 'UNPRINTED', 'OTHER');

-- CreateEnum
CREATE TYPE "ProofGroupStatus" AS ENUM ('NOT_STARTED', 'DRAFT_IN_PROGRESS', 'READY_TO_SEND', 'SENT', 'VIEWED', 'CHANGES_REQUESTED', 'APPROVED', 'NO_PROOF_REQUIRED', 'READY_FOR_EXPORT', 'EXPORTED_FOR_PRINT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProofVersionStatus" AS ENUM ('DRAFT', 'READY_TO_SEND', 'SENT', 'VIEWED', 'APPROVED', 'CHANGES_REQUESTED', 'SUPERSEDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ResponseType" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "ChangeRequestCategory" AS ENUM ('SPELLING', 'ARTWORK', 'COLOUR', 'SIZE', 'PLACEMENT', 'PRODUCT_ASSIGNMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('OWNER', 'ARTWORK', 'PACKING', 'PRODUCTION', 'GENERAL');

-- CreateEnum
CREATE TYPE "DueDateType" AS ENUM ('INTERNAL', 'CUSTOMER_PROMISED', 'PRODUCTION', 'DISPATCH');

-- CreateEnum
CREATE TYPE "DueDateSource" AS ENUM ('AUTOMATIC', 'MANUAL_OVERRIDE', 'SHOPIFY');

-- CreateEnum
CREATE TYPE "OverrideType" AS ENUM ('SKIP_WORKFLOW_STEP', 'EXPORT_WITHOUT_APPROVAL', 'REOPEN_APPROVED_PROOF', 'INVALIDATE_APPROVAL', 'MARK_NO_PROOF_REQUIRED', 'SUPPRESS_REMINDER', 'CHANGE_DUE_DATE', 'OVERRIDE_FREIGHT_RECOMMENDATION', 'RESOLVE_IGNORE_INTEGRATION_FAILURE', 'BYPASS_BARCODE_VALIDATION');

-- CreateEnum
CREATE TYPE "NoteVisibility" AS ENUM ('INTERNAL', 'CUSTOMER_VISIBLE');

-- CreateEnum
CREATE TYPE "KlaviyoEventType" AS ENUM ('PROOF_SENT', 'PROOF_REVISION_SENT', 'EXPORTED_FOR_PRINT', 'PROOF_REMINDER');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('STAFF', 'CUSTOMER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('SHOPIFY_ORDER_IMPORT', 'SHOPIFY_TAG_UPDATE', 'WEBHOOK', 'EMAIL', 'FILE_STORAGE', 'OPTIS_PARSING', 'PROOF_LINK', 'STARSHIPIT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "IntegrationFailureStatus" AS ENUM ('NEW', 'RETRYING', 'NEEDS_ATTENTION', 'ASSIGNED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "ReprintReasonCategory" AS ENUM ('PLACEMENT', 'PRINT_QUALITY', 'EMBROIDERY', 'WRONG_GARMENT', 'WRONG_SIZE', 'WRONG_COLOUR', 'PRODUCTION_DAMAGE', 'PACKING_DAMAGE', 'ARTWORK_ERROR', 'MACHINE_FAILURE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReprintStatus" AS ENUM ('REPORTED', 'REVIEW_REQUIRED', 'APPROVED', 'WAITING_STOCK', 'READY_FOR_PRODUCTION', 'IN_PRODUCTION', 'QUALITY_CHECK', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BarcodeType" AS ENUM ('VARIANT', 'SKU', 'INTERNAL_PRODUCT', 'BIN', 'ORDER', 'PICK_LIST', 'PRODUCTION_BATCH', 'PACKING_STATION', 'PARCEL', 'REPRINT');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('MATCH', 'MISMATCH', 'OVERRIDDEN', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopifyDomain" TEXT NOT NULL,
    "shopifyShopGid" TEXT NOT NULL,
    "adminApiToken" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Australia/Adelaide',
    "locale" TEXT NOT NULL DEFAULT 'en-AU',
    "currency" TEXT NOT NULL DEFAULT 'AUD',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSystemRole" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "StaffRole" (
    "staffUserId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "StaffRole_pkey" PRIMARY KEY ("staffUserId","roleId")
);

-- CreateTable
CREATE TABLE "ShopifyOrder" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "shopifyOrderGid" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "shopifyCreatedAt" TIMESTAMP(3) NOT NULL,
    "customerShopifyGid" TEXT,
    "customerEmail" TEXT,
    "customerName" TEXT,
    "tags" TEXT[],
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "isPreorder" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB NOT NULL,
    "rawPayloadPurgeAt" TIMESTAMP(3),
    "workflowStatus" "OrderStatus" NOT NULL DEFAULT 'NEW',
    "proofSummary" "OrderProofSummary" NOT NULL DEFAULT 'PROOFS_NOT_STARTED',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopifyOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyOrderLine" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shopifyLineGid" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifyLineProperty" (
    "id" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "detectedType" "PropertyDetectedType" NOT NULL DEFAULT 'TEXT',
    "parsedAssetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopifyLineProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerArtworkAsset" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "originalFilename" TEXT,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedByCustomer" BOOLEAN NOT NULL DEFAULT true,
    "isReusableArtwork" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerArtworkAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtworkOrderLineLink" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "isManualReassignment" BOOLEAN NOT NULL DEFAULT false,
    "reassignmentReason" TEXT,
    "createdByStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtworkOrderLineLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofRequirement" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "proofGroupId" TEXT,
    "value" "ProofRequirementValue" NOT NULL,
    "noProofReason" "NoProofReason",
    "reasonNote" TEXT,
    "decidedByStaffId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofGroup" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "decorationMethod" "DecorationMethod" NOT NULL,
    "placement" TEXT NOT NULL,
    "artworkContextNote" TEXT,
    "approximateWidthMm" INTEGER,
    "approximateHeightMm" INTEGER,
    "status" "ProofGroupStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "noProofReason" "NoProofReason",
    "assignedStaffId" TEXT,
    "dueDate" TIMESTAMP(3),
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofGroupOrderLine" (
    "id" TEXT NOT NULL,
    "proofGroupId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ProofGroupOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofVersion" (
    "id" TEXT NOT NULL,
    "proofGroupId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "ProofVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "customerMessage" TEXT,
    "internalNote" TEXT,
    "createdByStaffId" TEXT NOT NULL,
    "secureTokenHash" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "tokenRevokedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofAsset" (
    "id" TEXT NOT NULL,
    "proofVersionId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProofResponse" (
    "id" TEXT NOT NULL,
    "proofVersionId" TEXT NOT NULL,
    "responseType" "ResponseType" NOT NULL,
    "customerNote" TEXT,
    "changeCategories" "ChangeRequestCategory"[],
    "respondedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp" TEXT,
    "requestUserAgent" TEXT,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "CustomerProofResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerResponseAsset" (
    "id" TEXT NOT NULL,
    "responseId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerResponseAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionExport" (
    "id" TEXT NOT NULL,
    "proofGroupId" TEXT NOT NULL,
    "proofVersionId" TEXT NOT NULL,
    "exportedByStaffId" TEXT NOT NULL,
    "destination" TEXT,
    "productionFileStorageKey" TEXT,
    "internalNote" TEXT,
    "isOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "exportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionExport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderAssignment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unassignedAt" TIMESTAMP(3),

    CONSTRAINT "OrderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderDueDate" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "DueDateType" NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "source" "DueDateSource" NOT NULL,
    "setByStaffId" TEXT,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderDueDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderPriorityHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "priority" "Priority" NOT NULL,
    "reason" TEXT,
    "setByStaffId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderPriorityHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualOverride" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "overrideType" "OverrideType" NOT NULL,
    "relatedEntityType" TEXT NOT NULL,
    "relatedEntityId" TEXT NOT NULL,
    "previousValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "requiresManagerApproval" BOOLEAN NOT NULL DEFAULT false,
    "approvedByStaffId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualOverrideAttachment" (
    "id" TEXT NOT NULL,
    "overrideId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,

    CONSTRAINT "ManualOverrideAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderNote" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorStaffId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "NoteVisibility" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofReminder" (
    "id" TEXT NOT NULL,
    "proofVersionId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressedReason" TEXT,
    "suppressedByStaffId" TEXT,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "klaviyoDispatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KlaviyoDispatch" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "eventType" "KlaviyoEventType" NOT NULL,
    "klaviyoMetricName" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "orderId" TEXT,
    "proofGroupId" TEXT,
    "eventProperties" JSONB NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'QUEUED',
    "klaviyoEventId" TEXT,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "KlaviyoDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "actorStaffId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "filters" JSONB NOT NULL,
    "sortOrder" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopifySyncJob" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "orderId" TEXT,
    "direction" "SyncDirection" NOT NULL,
    "jobType" TEXT NOT NULL,
    "payload" JSONB,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ShopifySyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationFailure" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "integration" "IntegrationType" NOT NULL,
    "action" TEXT NOT NULL,
    "relatedOrderId" TEXT,
    "relatedProofGroupId" TEXT,
    "relatedEmailMessageId" TEXT,
    "relatedJobId" TEXT,
    "summary" TEXT NOT NULL,
    "technicalDetail" TEXT,
    "severity" "Severity" NOT NULL,
    "status" "IntegrationFailureStatus" NOT NULL DEFAULT 'NEW',
    "assignedStaffId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "firstFailureAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latestFailureAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextRetryAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "resolvedByStaffId" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationAttempt" (
    "id" TEXT NOT NULL,
    "failureId" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded" BOOLEAN NOT NULL,
    "errorSummary" TEXT,

    CONSTRAINT "IntegrationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reprint" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderLineId" TEXT,
    "proofGroupId" TEXT,
    "approvedProofVersionId" TEXT,
    "quantity" INTEGER NOT NULL,
    "reasonCategory" "ReprintReasonCategory" NOT NULL,
    "explanation" TEXT NOT NULL,
    "responsibleStage" TEXT,
    "stockImpact" TEXT,
    "status" "ReprintStatus" NOT NULL DEFAULT 'REPORTED',
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "dueDate" TIMESTAMP(3),
    "ownerStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReprintAsset" (
    "id" TEXT NOT NULL,
    "reprintId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReprintAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Barcode" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "type" "BarcodeType" NOT NULL,
    "value" TEXT NOT NULL,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Barcode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanEvent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "scannedValue" TEXT NOT NULL,
    "barcodeType" "BarcodeType" NOT NULL,
    "expectedValue" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "staffUserId" TEXT,
    "station" TEXT,
    "result" "ScanResult" NOT NULL,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecorationTemplate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "method" "DecorationMethod" NOT NULL,
    "wording" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DecorationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyDomain_key" ON "Shop"("shopifyDomain");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyShopGid_key" ON "Shop"("shopifyShopGid");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_shopId_email_key" ON "StaffUser"("shopId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_shopId_name_key" ON "Role"("shopId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "ShopifyOrder_shopId_workflowStatus_idx" ON "ShopifyOrder"("shopId", "workflowStatus");

-- CreateIndex
CREATE INDEX "ShopifyOrder_shopId_priority_idx" ON "ShopifyOrder"("shopId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrder_shopId_shopifyOrderGid_key" ON "ShopifyOrder"("shopId", "shopifyOrderGid");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifyOrderLine_orderId_shopifyLineGid_key" ON "ShopifyOrderLine"("orderId", "shopifyLineGid");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkOrderLineLink_assetId_orderLineId_key" ON "ArtworkOrderLineLink"("assetId", "orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofRequirement_orderLineId_key" ON "ProofRequirement"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofRequirement_proofGroupId_key" ON "ProofRequirement"("proofGroupId");

-- CreateIndex
CREATE INDEX "ProofGroup_orderId_status_idx" ON "ProofGroup"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProofGroupOrderLine_proofGroupId_orderLineId_key" ON "ProofGroupOrderLine"("proofGroupId", "orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofVersion_secureTokenHash_key" ON "ProofVersion"("secureTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ProofVersion_proofGroupId_versionNumber_key" ON "ProofVersion"("proofGroupId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProofResponse_idempotencyKey_key" ON "CustomerProofResponse"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "OrderDueDate_orderId_type_key" ON "OrderDueDate"("orderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "KlaviyoDispatch_idempotencyKey_key" ON "KlaviyoDispatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ActivityEvent_orderId_createdAt_idx" ON "ActivityEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopifySyncJob_idempotencyKey_key" ON "ShopifySyncJob"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Barcode_shopId_type_value_key" ON "Barcode"("shopId", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_shopId_key_key" ON "AppSetting"("shopId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "DecorationTemplate_shopId_method_key" ON "DecorationTemplate"("shopId", "method");

-- AddForeignKey
ALTER TABLE "StaffUser" ADD CONSTRAINT "StaffUser_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRole" ADD CONSTRAINT "StaffRole_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffRole" ADD CONSTRAINT "StaffRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrder" ADD CONSTRAINT "ShopifyOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyOrderLine" ADD CONSTRAINT "ShopifyOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifyLineProperty" ADD CONSTRAINT "ShopifyLineProperty_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "ShopifyOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerArtworkAsset" ADD CONSTRAINT "CustomerArtworkAsset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkOrderLineLink" ADD CONSTRAINT "ArtworkOrderLineLink_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "CustomerArtworkAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkOrderLineLink" ADD CONSTRAINT "ArtworkOrderLineLink_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "ShopifyOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRequirement" ADD CONSTRAINT "ProofRequirement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRequirement" ADD CONSTRAINT "ProofRequirement_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "ShopifyOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofRequirement" ADD CONSTRAINT "ProofRequirement_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofGroup" ADD CONSTRAINT "ProofGroup_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofGroupOrderLine" ADD CONSTRAINT "ProofGroupOrderLine_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofGroupOrderLine" ADD CONSTRAINT "ProofGroupOrderLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "ShopifyOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersion" ADD CONSTRAINT "ProofVersion_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofAsset" ADD CONSTRAINT "ProofAsset_proofVersionId_fkey" FOREIGN KEY ("proofVersionId") REFERENCES "ProofVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProofResponse" ADD CONSTRAINT "CustomerProofResponse_proofVersionId_fkey" FOREIGN KEY ("proofVersionId") REFERENCES "ProofVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerResponseAsset" ADD CONSTRAINT "CustomerResponseAsset_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "CustomerProofResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionExport" ADD CONSTRAINT "ProductionExport_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionExport" ADD CONSTRAINT "ProductionExport_proofVersionId_fkey" FOREIGN KEY ("proofVersionId") REFERENCES "ProofVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAssignment" ADD CONSTRAINT "OrderAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderAssignment" ADD CONSTRAINT "OrderAssignment_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderDueDate" ADD CONSTRAINT "OrderDueDate_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderPriorityHistory" ADD CONSTRAINT "OrderPriorityHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualOverrideAttachment" ADD CONSTRAINT "ManualOverrideAttachment_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "ManualOverride"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofReminder" ADD CONSTRAINT "ProofReminder_proofVersionId_fkey" FOREIGN KEY ("proofVersionId") REFERENCES "ProofVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KlaviyoDispatch" ADD CONSTRAINT "KlaviyoDispatch_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopifySyncJob" ADD CONSTRAINT "ShopifySyncJob_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationFailure" ADD CONSTRAINT "IntegrationFailure_relatedOrderId_fkey" FOREIGN KEY ("relatedOrderId") REFERENCES "ShopifyOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationAttempt" ADD CONSTRAINT "IntegrationAttempt_failureId_fkey" FOREIGN KEY ("failureId") REFERENCES "IntegrationFailure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reprint" ADD CONSTRAINT "Reprint_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ShopifyOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reprint" ADD CONSTRAINT "Reprint_proofGroupId_fkey" FOREIGN KEY ("proofGroupId") REFERENCES "ProofGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReprintAsset" ADD CONSTRAINT "ReprintAsset_reprintId_fkey" FOREIGN KEY ("reprintId") REFERENCES "Reprint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Barcode" ADD CONSTRAINT "Barcode_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSetting" ADD CONSTRAINT "AppSetting_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecorationTemplate" ADD CONSTRAINT "DecorationTemplate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
