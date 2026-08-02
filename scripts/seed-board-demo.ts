// Development-only fixture generator for manually verifying the Kanban
// board (Milestone 06B). Creates realistic but entirely synthetic orders —
// no real customer data — covering every scenario in the milestone's
// manual-verification checklist. Safe to re-run: each order is upserted on
// a stable orderNumber, so running this twice updates rather than duplicates.
//
// Usage:
//   npm run db:seed:board-demo

import { randomUUID } from "node:crypto";
import {
  ActorType,
  ArtworkAssetSourceType,
  AssignmentRole,
  ChangeRequestCategory,
  DueDateSource,
  DueDateType,
  IntegrationFailureStatus,
  IntegrationType,
  NoteVisibility,
  OrderProofSummary,
  OrderStatus,
  Priority,
  PropertyDetectedType,
  Severity,
} from "@prisma/client";
import { db } from "../app/lib/db.server";
import { hashPassword } from "../app/auth/password.server";
import { createProofGroup } from "../app/domain/proofs/create-proof-group.server";
import { createProofVersion } from "../app/domain/proofs/create-proof-version.server";
import { markProofVersionReady } from "../app/domain/proofs/mark-proof-version-ready.server";
import { cancelProofVersion } from "../app/domain/proofs/cancel-proof-version.server";
import { cancelProofGroup } from "../app/domain/proofs/cancel-proof-group.server";
import { sendProofRequest } from "../app/domain/proofs/send-proof-request.server";
import { recordCustomerProofResponse } from "../app/domain/proofs/record-customer-proof-response.server";
import { revokeProofRequest } from "../app/domain/proofs/revoke-proof-request.server";
import { suppressProofReminder } from "../app/domain/proofs/suppress-proof-reminder.server";
import { dispatchDueProofReminders } from "../app/domain/proofs/dispatch-due-proof-reminders.server";
import { createProductionArtwork } from "../app/domain/production/create-production-artwork.server";
import { setProductionArtworkOrderLines } from "../app/domain/production/allocate-production-artwork-order-lines.server";
import { markProductionArtworkReady } from "../app/domain/production/mark-production-artwork-ready.server";
import { createExportBatch } from "../app/domain/production/create-export-batch.server";

const DAY_MS = 86_400_000;

// Smallest valid 1x1 transparent PNG (well-known fixture) — real bytes, real
// checksum, real dimensions via image-size, so the Milestone 08 upload
// pipeline is exercised for real rather than faked.
const DEMO_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
// Minimal buffer that satisfies the "%PDF" signature check — not a
// renderable PDF, but sufficient for the storage/checksum/metadata pipeline
// this demo data is meant to exercise.
const DEMO_PDF_BYTES = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "utf8");

async function main() {
  const shop = await db.shop.findFirstOrThrow();

  // A second staff member so "assigned to X" and "assigned to me" both have
  // something realistic to show — synthetic name, never a real person.
  const artworkRole = await db.role.findUniqueOrThrow({
    where: { shopId_name: { shopId: shop.id, name: "ARTWORK_STAFF" } },
  });
  const demoStaff = await db.staffUser.upsert({
    where: { shopId_email: { shopId: shop.id, email: "demo.artwork@justshear.example" } },
    update: {},
    create: {
      shopId: shop.id,
      email: "demo.artwork@justshear.example",
      name: "Priya Nair",
      passwordHash: await hashPassword(randomUUID()),
    },
  });
  await db.staffRole.upsert({
    where: { staffUserId_roleId: { staffUserId: demoStaff.id, roleId: artworkRole.id } },
    update: {},
    create: { staffUserId: demoStaff.id, roleId: artworkRole.id },
  });

  // A second artwork staff member so Milestone 08's "several artwork staff
  // assignments" scenario (different proof groups on the same order,
  // assigned to different people) has something real to show.
  const demoStaff2 = await db.staffUser.upsert({
    where: { shopId_email: { shopId: shop.id, email: "demo.artwork2@justshear.example" } },
    update: {},
    create: {
      shopId: shop.id,
      email: "demo.artwork2@justshear.example",
      name: "Jordan Lee",
      passwordHash: await hashPassword(randomUUID()),
    },
  });
  await db.staffRole.upsert({
    where: { staffUserId_roleId: { staffUserId: demoStaff2.id, roleId: artworkRole.id } },
    update: {},
    create: { staffUserId: demoStaff2.id, roleId: artworkRole.id },
  });

  const now = new Date();

  interface DemoLineProperty {
    name: string;
    value: string;
    detectedType?: PropertyDetectedType;
  }

  interface DemoUpload {
    lineIndex: number;
    propertyName: string;
    originalFilename: string;
    sourceUrl: string;
    mimeType: string;
    sizeBytes: number;
    parsingUncertain?: boolean;
  }

  interface DemoOrder {
    orderNumber: string;
    customerName: string;
    customerEmail: string | null;
    tags: string[];
    isPreorder?: boolean;
    workflowStatus: OrderStatus;
    proofSummary?: OrderProofSummary;
    priority?: Priority;
    cancelledAt?: Date;
    lines: {
      productTitle: string;
      variantTitle?: string;
      quantity: number;
      sku?: string;
      imageUrl?: string | null;
      properties?: DemoLineProperty[];
    }[];
    dueDates?: { type: DueDateType; dueDate: Date }[];
    assignTo?: string; // staffUserId
    integrationFailure?: {
      summary: string;
      severity: Severity;
      technicalDetail?: string;
      attempts?: number;
    };
    shopifyCreatedAt?: Date;
    uploads?: DemoUpload[];
    notes?: string[];
    /** Synthetic backdated ActivityEvent rows, oldest first, to exercise the Activity tab's "load more" pagination. */
    activityEventCount?: number;
  }

  const CAP_IMAGE = "https://cdn.shopify.com/s/files/1/0000/0001/products/cap-navy.png";
  const SHIRT_IMAGE = "https://cdn.shopify.com/s/files/1/0000/0001/products/polo-white.png";
  const HOODIE_IMAGE = "https://cdn.shopify.com/s/files/1/0000/0001/products/hoodie-black.png";

  const demoOrders: DemoOrder[] = [
    {
      orderNumber: "#9001",
      customerName: "Demo Customer One",
      customerEmail: "demo.customer1@justshear.example",
      tags: ["embroidery", "corporate"],
      workflowStatus: OrderStatus.NEW,
      lines: [
        { productTitle: "Embroidered Cap", quantity: 12, sku: "CAP-NVY", imageUrl: CAP_IMAGE },
      ],
      dueDates: [{ type: DueDateType.DISPATCH, dueDate: new Date(now.getTime() + 10 * DAY_MS) }],
    },
    {
      orderNumber: "#9002",
      customerName: "Demo Customer Two",
      customerEmail: "demo.customer2@justshear.example",
      tags: ["screen-print"],
      workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
      lines: [{ productTitle: "Team Polo", quantity: 24, sku: "POLO-WHT", imageUrl: SHIRT_IMAGE }],
      assignTo: demoStaff.id,
    },
    {
      orderNumber: "#9003",
      customerName: "Demo Customer Three",
      customerEmail: "demo.customer3@justshear.example",
      tags: ["dtf"],
      workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
      proofSummary: OrderProofSummary.WAITING_ON_CUSTOMER,
      lines: [{ productTitle: "Zip Hoodie", quantity: 8, sku: "HOOD-BLK", imageUrl: HOODIE_IMAGE }],
      dueDates: [
        { type: DueDateType.CUSTOMER_PROMISED, dueDate: new Date(now.getTime() + 2 * DAY_MS) },
      ],
    },
    {
      orderNumber: "#9004",
      customerName: "Demo Customer Four",
      customerEmail: "demo.customer4@justshear.example",
      tags: ["embroidery"],
      workflowStatus: OrderStatus.WAITING_CUSTOMER,
      lines: [
        { productTitle: "Embroidered Cap", quantity: 6, sku: "CAP-NVY", imageUrl: CAP_IMAGE },
      ],
    },
    {
      orderNumber: "#9005",
      customerName: "Demo Customer Five",
      customerEmail: "demo.customer5@justshear.example",
      tags: ["screen-print", "reorder"],
      workflowStatus: OrderStatus.READY_FOR_EXPORT,
      proofSummary: OrderProofSummary.ALL_REQUIRED_PROOFS_APPROVED,
      lines: [{ productTitle: "Team Polo", quantity: 30, sku: "POLO-WHT", imageUrl: SHIRT_IMAGE }],
      assignTo: demoStaff.id,
    },
    {
      orderNumber: "#9006",
      customerName: "Demo Customer Six",
      customerEmail: "demo.customer6@justshear.example",
      tags: ["dtf"],
      workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
      proofSummary: OrderProofSummary.CHANGES_REQUESTED,
      lines: [
        { productTitle: "Zip Hoodie", quantity: 10, sku: "HOOD-BLK", imageUrl: HOODIE_IMAGE },
      ],
    },
    {
      orderNumber: "#9007",
      customerName: "Demo Customer Seven",
      customerEmail: "demo.customer7@justshear.example",
      tags: ["embroidery", "corporate"],
      workflowStatus: OrderStatus.EXPORTED_FOR_PRINT,
      proofSummary: OrderProofSummary.ALL_REQUIRED_PROOFS_EXPORTED,
      lines: [
        { productTitle: "Embroidered Cap", quantity: 50, sku: "CAP-NVY", imageUrl: CAP_IMAGE },
      ],
    },
    {
      orderNumber: "#9008",
      customerName: "Demo Customer Eight",
      customerEmail: "demo.customer8@justshear.example",
      tags: ["blank"],
      workflowStatus: OrderStatus.NEW,
      proofSummary: OrderProofSummary.NO_PROOFS_REQUIRED,
      lines: [{ productTitle: "Unprinted Tee", quantity: 15, sku: "TEE-BLK" }],
    },
    {
      orderNumber: "#9009",
      customerName: "Demo Customer Nine",
      customerEmail: "demo.customer9@justshear.example",
      tags: ["preorder", "screen-print"],
      isPreorder: true,
      workflowStatus: OrderStatus.NEW,
      lines: [{ productTitle: "Team Polo", quantity: 40, sku: "POLO-WHT", imageUrl: SHIRT_IMAGE }],
      dueDates: [{ type: DueDateType.PRODUCTION, dueDate: new Date(now.getTime() + 30 * DAY_MS) }],
    },
    {
      orderNumber: "#9010",
      customerName: "Demo Customer Ten",
      customerEmail: "demo.customer10@justshear.example",
      tags: ["rush"],
      workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
      priority: Priority.URGENT,
      lines: [{ productTitle: "Zip Hoodie", quantity: 5, sku: "HOOD-BLK", imageUrl: HOODIE_IMAGE }],
      dueDates: [{ type: DueDateType.DISPATCH, dueDate: new Date(now.getTime() - 3 * DAY_MS) }],
      assignTo: demoStaff.id,
    },
    {
      orderNumber: "#9011",
      customerName: "Demo Customer Eleven",
      customerEmail: "demo.customer11@justshear.example",
      tags: [],
      workflowStatus: OrderStatus.NEW,
      lines: [
        { productTitle: "Embroidered Cap", quantity: 2, sku: "CAP-NVY", imageUrl: CAP_IMAGE },
      ],
    },
    {
      orderNumber: "#9012",
      customerName: "Demo Customer Twelve",
      customerEmail: "demo.customer12@justshear.example",
      tags: ["dtf"],
      workflowStatus: OrderStatus.NEW,
      lines: [{ productTitle: "Zip Hoodie", quantity: 3, sku: "HOOD-BLK", imageUrl: HOODIE_IMAGE }],
      integrationFailure: {
        summary: "Failed to update Shopify tags after import",
        severity: Severity.MEDIUM,
      },
    },
    {
      orderNumber: "#9013",
      customerName: "Demo Customer Thirteen",
      customerEmail: "demo.customer13@justshear.example",
      tags: ["cancelled-order"],
      workflowStatus: OrderStatus.CANCELLED,
      cancelledAt: now,
      lines: [{ productTitle: "Team Polo", quantity: 20, sku: "POLO-WHT", imageUrl: SHIRT_IMAGE }],
    },
    {
      orderNumber: "#9014",
      customerName: "Demo Customer Fourteen",
      customerEmail: "demo.customer14@justshear.example",
      tags: ["multi-product"],
      workflowStatus: OrderStatus.NEW,
      lines: [
        { productTitle: "Embroidered Cap", quantity: 10, sku: "CAP-NVY", imageUrl: CAP_IMAGE },
        { productTitle: "Team Polo", quantity: 10, sku: "POLO-WHT", imageUrl: SHIRT_IMAGE },
        { productTitle: "Zip Hoodie", quantity: 10, sku: "HOOD-BLK", imageUrl: HOODIE_IMAGE },
        { productTitle: "Unprinted Tee", quantity: 5, sku: "TEE-BLK" },
        { productTitle: "Beanie", quantity: 15, sku: "BEANIE-GRY" },
      ],
    },
    {
      orderNumber: "#9015",
      customerName: "Demo Customer Fifteen",
      customerEmail: "demo.customer15@justshear.example",
      tags: ["no-image"],
      workflowStatus: OrderStatus.NEW,
      lines: [
        { productTitle: "Custom Sample Item", quantity: 1, sku: "SAMPLE-001", imageUrl: null },
      ],
    },
    {
      orderNumber: "#9016",
      customerName: "Demo Customer Sixteen",
      customerEmail: "demo.customer16@justshear.example",
      tags: [
        "embroidery",
        "corporate",
        "rush",
        "reorder",
        "screen-print",
        "dtf",
        "preorder",
        "vip",
        "wholesale",
        "local-pickup",
        "gift",
      ],
      workflowStatus: OrderStatus.NEW,
      lines: [{ productTitle: "Team Polo", quantity: 18, sku: "POLO-WHT", imageUrl: SHIRT_IMAGE }],
    },
    {
      orderNumber: "#9017",
      customerName: "Demo Customer Seventeen",
      customerEmail: "demo.customer17@justshear.example",
      tags: ["on-hold"],
      workflowStatus: OrderStatus.ON_HOLD,
      lines: [
        { productTitle: "Embroidered Cap", quantity: 12, sku: "CAP-NVY", imageUrl: CAP_IMAGE },
      ],
    },
    {
      orderNumber: "#9018",
      customerName: "Demo Customer Eighteen",
      customerEmail: "demo.customer18@justshear.example",
      tags: ["archived"],
      workflowStatus: OrderStatus.ARCHIVED,
      lines: [{ productTitle: "Zip Hoodie", quantity: 4, sku: "HOOD-BLK", imageUrl: HOODIE_IMAGE }],
      shopifyCreatedAt: new Date(now.getTime() - 90 * DAY_MS),
    },
    {
      // Milestone 07 (Full Order Drawer) manual-verification fixture — every
      // drawer section gets something real to show: multiple lines each with
      // several properties, uploads on two different lines (including a
      // duplicate filename to prove line association isn't lost), no
      // customer email on file, all four due-date types, internal notes, a
      // long activity history to exercise "load more", and an integration
      // failure with technical detail/attempts for authorized staff.
      orderNumber: "#9019",
      customerName: "Demo Customer Nineteen",
      customerEmail: null,
      tags: ["embroidery", "rush", "multi-property"],
      workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
      proofSummary: OrderProofSummary.PROOFS_IN_PROGRESS,
      priority: Priority.HIGH,
      shopifyCreatedAt: new Date(now.getTime() - 14 * DAY_MS),
      lines: [
        {
          productTitle: "Embroidered Cap",
          variantTitle: "Navy / One Size",
          quantity: 25,
          sku: "CAP-NVY",
          imageUrl: CAP_IMAGE,
          properties: [
            { name: "Embroidery text", value: "Just Shear Co." },
            { name: "Thread colour", value: "Gold", detectedType: PropertyDetectedType.SELECTION },
            { name: "Placement", value: "Front centre" },
            {
              name: "Artwork proof",
              value: "https://cdn.justshear.example/uploads/cap-logo-final.png",
              detectedType: PropertyDetectedType.FILE_UPLOAD,
            },
          ],
        },
        {
          productTitle: "Team Polo",
          variantTitle: "White / Large",
          quantity: 18,
          sku: "POLO-WHT",
          imageUrl: SHIRT_IMAGE,
          properties: [
            { name: "Print method", value: "Screen print" },
            { name: "Logo placement", value: "Left chest" },
            {
              name: "Reference image",
              value: "https://cdn.justshear.example/uploads/polo-logo-final.png",
              detectedType: PropertyDetectedType.FILE_UPLOAD,
            },
            {
              name: "Special instructions",
              value:
                "Please match the exact Pantone from the last order (287 C) — client was very particular about this last time and rejected the first proof over a shade difference, so double-check before sending.",
            },
          ],
        },
        {
          productTitle: "Custom Sample Item",
          quantity: 1,
          sku: "SAMPLE-002",
          imageUrl: null,
          properties: [
            {
              name: "Reference image",
              value: "https://cdn.justshear.example/uploads/polo-logo-final.png",
              detectedType: PropertyDetectedType.FILE_UPLOAD,
            },
            {
              name: "Notes from customer",
              value: "Same artwork as the polo, just want a sample first.",
              detectedType: PropertyDetectedType.UNKNOWN,
            },
          ],
        },
      ],
      uploads: [
        {
          lineIndex: 0,
          propertyName: "Artwork proof",
          originalFilename: "cap-logo-final.png",
          sourceUrl: "https://cdn.justshear.example/uploads/cap-logo-final.png",
          mimeType: "image/png",
          sizeBytes: 482_000,
        },
        {
          lineIndex: 1,
          propertyName: "Reference image",
          originalFilename: "polo-logo-final.png",
          sourceUrl: "https://cdn.justshear.example/uploads/polo-logo-final.png",
          mimeType: "image/png",
          sizeBytes: 611_000,
        },
        // Same filename as the polo's upload, but a different line and a
        // different underlying asset — proves duplicate filenames from
        // different lines/properties stay visually distinct.
        {
          lineIndex: 2,
          propertyName: "Reference image",
          originalFilename: "polo-logo-final.png",
          sourceUrl: "https://cdn.justshear.example/uploads/polo-logo-final-sample.png",
          mimeType: "image/png",
          sizeBytes: 598_000,
          parsingUncertain: true,
        },
      ],
      dueDates: [
        { type: DueDateType.INTERNAL, dueDate: new Date(now.getTime() + 4 * DAY_MS) },
        { type: DueDateType.CUSTOMER_PROMISED, dueDate: new Date(now.getTime() + 9 * DAY_MS) },
        { type: DueDateType.PRODUCTION, dueDate: new Date(now.getTime() + 6 * DAY_MS) },
        { type: DueDateType.DISPATCH, dueDate: new Date(now.getTime() + 10 * DAY_MS) },
      ],
      assignTo: demoStaff.id,
      notes: [
        "Customer called to confirm thread colour — gold, not yellow gold. Updated the property but flagging here too.",
        "Sample line is just for the client to sign off on placement before we run the full polo batch.",
      ],
      activityEventCount: 35,
      integrationFailure: {
        summary: "Failed to update Shopify tags after import",
        severity: Severity.HIGH,
        technicalDetail:
          "Shopify Admin API returned 429 Too Many Requests after 3 retries (bulk tag mutation).",
        attempts: 3,
      },
    },
    {
      // Milestone 08 (Proof Groups and Proof Versions) manual-verification
      // fixture. This order's lines are the pool the post-loop proof-group
      // block below links against — see seedProofGroupsForOrder9020().
      orderNumber: "#9020",
      customerName: "Demo Customer Twenty",
      customerEmail: "demo.customer20@justshear.example",
      tags: ["embroidery", "screen-print", "multi-group"],
      workflowStatus: OrderStatus.PROOFING_IN_PROGRESS,
      proofSummary: OrderProofSummary.PROOFS_IN_PROGRESS,
      priority: Priority.NORMAL,
      lines: [
        {
          productTitle: "Team Polo",
          variantTitle: "White / Large",
          quantity: 20,
          sku: "POLO-WHT",
          imageUrl: SHIRT_IMAGE,
        },
        {
          productTitle: "Embroidered Cap",
          variantTitle: "Navy / One Size",
          quantity: 20,
          sku: "CAP-NVY",
          imageUrl: CAP_IMAGE,
        },
        {
          productTitle: "Zip Hoodie",
          variantTitle: "Black / Medium",
          quantity: 10,
          sku: "HOOD-BLK",
          imageUrl: HOODIE_IMAGE,
        },
        { productTitle: "Unprinted Tee", quantity: 5, sku: "TEE-BLK" },
      ],
    },
    {
      // Milestone 09 (Customer Proof Portal and Responses) manual-
      // verification fixture. This order's lines are the pool the
      // post-loop proof-request block below links against.
      orderNumber: "#9021",
      customerName: "Demo Customer Twenty-One",
      customerEmail: "demo.customer21@justshear.example",
      tags: ["customer-proofing"],
      workflowStatus: OrderStatus.WAITING_CUSTOMER,
      proofSummary: OrderProofSummary.WAITING_ON_CUSTOMER,
      priority: Priority.NORMAL,
      lines: [
        {
          productTitle: "Crew Jumper",
          variantTitle: "Grey / Large",
          quantity: 15,
          sku: "JUMP-GRY",
          imageUrl: SHIRT_IMAGE,
        },
        {
          productTitle: "Snapback Cap",
          variantTitle: "Black / One Size",
          quantity: 15,
          sku: "CAP-BLK",
          imageUrl: CAP_IMAGE,
        },
        {
          productTitle: "Bomber Jacket",
          variantTitle: "Navy / Medium",
          quantity: 8,
          sku: "BOMB-NVY",
          imageUrl: HOODIE_IMAGE,
        },
      ],
    },
    {
      // Milestone 10 (Export for Print and Production Artwork) manual-
      // verification fixture. This order's lines are the pool the post-loop
      // production-artwork block below links against.
      orderNumber: "#9022",
      customerName: "Demo Customer Twenty-Two",
      customerEmail: "demo.customer22@justshear.example",
      tags: ["export-for-print"],
      workflowStatus: OrderStatus.READY_FOR_EXPORT,
      proofSummary: OrderProofSummary.PARTIALLY_APPROVED,
      priority: Priority.NORMAL,
      lines: [
        {
          productTitle: "Varsity Jacket",
          variantTitle: "Maroon / Large",
          quantity: 12,
          sku: "VARS-MAR",
          imageUrl: HOODIE_IMAGE,
        },
        {
          productTitle: "Beanie",
          variantTitle: "Black / One Size",
          quantity: 12,
          sku: "BEAN-BLK",
          imageUrl: CAP_IMAGE,
        },
      ],
    },
  ];

  // Clean up any previously-seeded proof-domain rows for these two orders
  // BEFORE the main loop below deletes and recreates their lines —
  // ProofGroupOrderLine has a foreign key to ShopifyOrderLine, so this must
  // happen first, not after. Skipped entirely on a first-ever run, when
  // neither order exists yet. #9021 (Milestone 09's customer proof-request
  // scenarios) is cleaned up the same way as #9020 (Milestone 08's
  // internal-only proof groups) since both attach ProofGroup rows to lines
  // this loop is about to delete and recreate.
  for (const orderNumber of ["#9020", "#9021", "#9022"]) {
    const existingOrder = await db.shopifyOrder.findFirst({
      where: { shopId: shop.id, orderNumber },
      select: { id: true },
    });
    if (!existingOrder) continue;

    const existingGroupIds = (
      await db.proofGroup.findMany({
        where: { orderId: existingOrder.id },
        select: { id: true },
      })
    ).map((g) => g.id);
    if (existingGroupIds.length === 0) continue;

    const existingVersionIds = (
      await db.proofVersion.findMany({
        where: { proofGroupId: { in: existingGroupIds } },
        select: { id: true },
      })
    ).map((v) => v.id);

    // Milestone 09 rows — proof requests bundle groups/versions from this
    // order, so they must be cleared before the groups/versions themselves.
    const existingRequestIds = (
      await db.proofRequest.findMany({ where: { orderId: existingOrder.id }, select: { id: true } })
    ).map((r) => r.id);
    if (existingRequestIds.length > 0) {
      const existingResponseIds = (
        await db.customerProofResponse.findMany({
          where: { proofRequestId: { in: existingRequestIds } },
          select: { id: true },
        })
      ).map((r) => r.id);
      if (existingResponseIds.length > 0) {
        await db.customerResponseAsset.deleteMany({
          where: { responseId: { in: existingResponseIds } },
        });
        await db.customerProofResponse.deleteMany({ where: { id: { in: existingResponseIds } } });
      }
      await db.proofReminder.deleteMany({ where: { proofRequestId: { in: existingRequestIds } } });
      await db.klaviyoDispatch.deleteMany({
        where: { proofRequestId: { in: existingRequestIds } },
      });
      await db.proofRequestGroup.deleteMany({
        where: { proofRequestId: { in: existingRequestIds } },
      });
      await db.proofRequest.deleteMany({ where: { id: { in: existingRequestIds } } });
    }

    if (existingVersionIds.length > 0) {
      await db.proofVersionSourceAsset.deleteMany({
        where: { proofVersionId: { in: existingVersionIds } },
      });
      await db.proofAsset.deleteMany({ where: { proofVersionId: { in: existingVersionIds } } });
      await db.proofNote.deleteMany({ where: { proofVersionId: { in: existingVersionIds } } });
      // Clear the self-referential FK before deleting so neither
      // direction of the supersession link blocks the delete.
      await db.proofVersion.updateMany({
        where: { id: { in: existingVersionIds } },
        data: { supersededByVersionId: null },
      });
      await db.proofVersion.deleteMany({ where: { id: { in: existingVersionIds } } });
    }
    await db.proofGroupArtworkAsset.deleteMany({
      where: { proofGroupId: { in: existingGroupIds } },
    });
    await db.proofGroupOrderLine.deleteMany({
      where: { proofGroupId: { in: existingGroupIds } },
    });
    await db.proofNote.deleteMany({ where: { proofGroupId: { in: existingGroupIds } } });
    await db.proofRequirement.deleteMany({ where: { proofGroupId: { in: existingGroupIds } } });
    await db.integrationFailure.deleteMany({
      where: { relatedProofGroupId: { in: existingGroupIds } },
    });

    // Milestone 11 rows — production jobs/tasks are auto-created from a
    // successful export batch and reference its ExportBatchItem rows via a
    // hard FK, so the full cascade must clear before exportBatchItem itself
    // (same ordering bug/fix as tests/integration/domain/production/helpers.ts).
    const existingJobIds = (
      await db.productionJob.findMany({
        where: { orderId: existingOrder.id },
        select: { id: true },
      })
    ).map((j) => j.id);
    if (existingJobIds.length > 0) {
      const existingTaskIds = (
        await db.productionTask.findMany({
          where: { productionJobId: { in: existingJobIds } },
          select: { id: true },
        })
      ).map((t) => t.id);
      if (existingTaskIds.length > 0) {
        await db.productionQuantityUpdate.deleteMany({
          where: { productionTaskId: { in: existingTaskIds } },
        });
        const existingQualityCheckIds = (
          await db.productionQualityCheck.findMany({
            where: { productionTaskId: { in: existingTaskIds } },
            select: { id: true },
          })
        ).map((q) => q.id);
        if (existingQualityCheckIds.length > 0) {
          await db.productionQualityCheckAttachment.deleteMany({
            where: { qualityCheckId: { in: existingQualityCheckIds } },
          });
          await db.productionQualityCheck.deleteMany({
            where: { id: { in: existingQualityCheckIds } },
          });
        }
        await db.productionNote.deleteMany({
          where: { productionTaskId: { in: existingTaskIds } },
        });
      }
      const existingIssueIds = (
        await db.productionIssue.findMany({
          where: {
            OR: [
              { productionJobId: { in: existingJobIds } },
              { productionTaskId: { in: existingTaskIds } },
            ],
          },
          select: { id: true },
        })
      ).map((i) => i.id);
      if (existingIssueIds.length > 0) {
        await db.productionIssueAttachment.deleteMany({
          where: { issueId: { in: existingIssueIds } },
        });
        await db.productionIssue.deleteMany({ where: { id: { in: existingIssueIds } } });
      }
      await db.productionNote.deleteMany({ where: { productionJobId: { in: existingJobIds } } });
      if (existingTaskIds.length > 0) {
        await db.productionTask.updateMany({
          where: { id: { in: existingTaskIds } },
          data: { dependsOnTaskId: null },
        });
        await db.productionTask.deleteMany({ where: { id: { in: existingTaskIds } } });
      }
      await db.productionJob.deleteMany({ where: { id: { in: existingJobIds } } });
    }

    // Milestone 10 rows — export batches reference production artwork,
    // which references the proof group, so both must clear before the
    // groups themselves.
    const existingExportBatchIds = (
      await db.exportBatch.findMany({ where: { orderId: existingOrder.id }, select: { id: true } })
    ).map((b) => b.id);
    if (existingExportBatchIds.length > 0) {
      await db.exportBatchItem.deleteMany({
        where: { exportBatchId: { in: existingExportBatchIds } },
      });
      await db.exportBatch.updateMany({
        where: { id: { in: existingExportBatchIds } },
        data: { previousBatchId: null },
      });
      await db.exportBatch.deleteMany({ where: { id: { in: existingExportBatchIds } } });
    }
    const existingArtworkIds = (
      await db.productionArtwork.findMany({
        where: { proofGroupId: { in: existingGroupIds } },
        select: { id: true },
      })
    ).map((a) => a.id);
    if (existingArtworkIds.length > 0) {
      await db.productionArtworkOrderLine.deleteMany({
        where: { productionArtworkId: { in: existingArtworkIds } },
      });
      await db.productionArtwork.updateMany({
        where: { id: { in: existingArtworkIds } },
        data: { supersededByArtworkId: null },
      });
      await db.productionArtwork.deleteMany({ where: { id: { in: existingArtworkIds } } });
    }

    await db.proofGroup.deleteMany({ where: { id: { in: existingGroupIds } } });
  }

  for (const demo of demoOrders) {
    const shopifyCreatedAt = demo.shopifyCreatedAt ?? now;

    const order = await db.shopifyOrder.upsert({
      where: {
        shopId_shopifyOrderGid: {
          shopId: shop.id,
          shopifyOrderGid: `gid://shopify/Order/demo-${demo.orderNumber}`,
        },
      },
      update: {
        customerName: demo.customerName,
        customerEmail: demo.customerEmail,
        tags: demo.tags,
        isPreorder: demo.isPreorder ?? false,
        workflowStatus: demo.workflowStatus,
        workflowStatusChangedAt: now,
        proofSummary: demo.proofSummary ?? OrderProofSummary.PROOFS_NOT_STARTED,
        priority: demo.priority ?? Priority.NORMAL,
        cancelledAt: demo.cancelledAt ?? null,
      },
      create: {
        shopId: shop.id,
        shopifyOrderGid: `gid://shopify/Order/demo-${demo.orderNumber}`,
        orderNumber: demo.orderNumber,
        shopifyCreatedAt,
        customerName: demo.customerName,
        customerEmail: demo.customerEmail,
        tags: demo.tags,
        isPreorder: demo.isPreorder ?? false,
        workflowStatus: demo.workflowStatus,
        workflowStatusChangedAt: now,
        proofSummary: demo.proofSummary ?? OrderProofSummary.PROOFS_NOT_STARTED,
        priority: demo.priority ?? Priority.NORMAL,
        cancelledAt: demo.cancelledAt ?? null,
        rawPayload: { demo: true, orderNumber: demo.orderNumber },
      },
    });

    // Re-seed lines (and everything keyed off a line) fresh each run so
    // re-running this script doesn't accumulate duplicate rows. Line
    // properties/artwork links cascade-delete is not configured on these
    // relations, so child rows must be cleared explicitly before the lines
    // that own them.
    const existingLineIds = (
      await db.shopifyOrderLine.findMany({ where: { orderId: order.id }, select: { id: true } })
    ).map((l) => l.id);
    if (existingLineIds.length > 0) {
      await db.artworkOrderLineLink.deleteMany({ where: { orderLineId: { in: existingLineIds } } });
      await db.shopifyLineProperty.deleteMany({ where: { orderLineId: { in: existingLineIds } } });
    }
    await db.shopifyOrderLine.deleteMany({ where: { orderId: order.id } });

    for (const [lineIndex, line] of demo.lines.entries()) {
      const createdLine = await db.shopifyOrderLine.create({
        data: {
          orderId: order.id,
          shopifyLineGid: `gid://shopify/LineItem/demo-${demo.orderNumber}-${line.sku ?? randomUUID()}`,
          productTitle: line.productTitle,
          variantTitle: line.variantTitle,
          quantity: line.quantity,
          sku: line.sku,
          imageUrl: line.imageUrl,
        },
      });

      const createdProperties = new Map<string, string>();
      for (const [index, property] of (line.properties ?? []).entries()) {
        const createdProperty = await db.shopifyLineProperty.create({
          data: {
            orderLineId: createdLine.id,
            name: property.name,
            value: property.value,
            sortOrder: index,
            detectedType: property.detectedType ?? PropertyDetectedType.TEXT,
          },
        });
        createdProperties.set(property.name, createdProperty.id);
      }

      // Link any uploads that target this line, then point the matching
      // property at the asset it was parsed from (parsedAssetId) so the
      // Uploads tab can show "from property: X" per asset.
      const lineUploads = (demo.uploads ?? []).filter((u) => u.lineIndex === lineIndex);
      for (const upload of lineUploads) {
        const asset = await db.customerArtworkAsset.upsert({
          where: { shopId_sourceUrl: { shopId: shop.id, sourceUrl: upload.sourceUrl } },
          update: {
            originalFilename: upload.originalFilename,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            parsingUncertain: upload.parsingUncertain ?? false,
          },
          create: {
            shopId: shop.id,
            originalFilename: upload.originalFilename,
            sourceType: ArtworkAssetSourceType.EXTERNAL_REFERENCE,
            sourceUrl: upload.sourceUrl,
            mimeType: upload.mimeType,
            sizeBytes: upload.sizeBytes,
            parsingUncertain: upload.parsingUncertain ?? false,
          },
        });
        await db.artworkOrderLineLink.upsert({
          where: { assetId_orderLineId: { assetId: asset.id, orderLineId: createdLine.id } },
          update: {},
          create: { assetId: asset.id, orderLineId: createdLine.id },
        });
        const propertyId = createdProperties.get(upload.propertyName);
        if (propertyId) {
          await db.shopifyLineProperty.update({
            where: { id: propertyId },
            data: { parsedAssetId: asset.id },
          });
        }
      }
    }

    await db.orderDueDate.deleteMany({ where: { orderId: order.id } });
    for (const due of demo.dueDates ?? []) {
      await db.orderDueDate.create({
        data: {
          orderId: order.id,
          type: due.type,
          dueDate: due.dueDate,
          source: DueDateSource.MANUAL_OVERRIDE,
        },
      });
    }

    await db.orderAssignment.deleteMany({ where: { orderId: order.id } });
    if (demo.assignTo) {
      await db.orderAssignment.create({
        data: { orderId: order.id, staffUserId: demo.assignTo, role: AssignmentRole.ARTWORK },
      });
    }

    const existingFailureIds = (
      await db.integrationFailure.findMany({
        where: { relatedOrderId: order.id },
        select: { id: true },
      })
    ).map((f) => f.id);
    if (existingFailureIds.length > 0) {
      await db.integrationAttempt.deleteMany({ where: { failureId: { in: existingFailureIds } } });
    }
    await db.integrationFailure.deleteMany({ where: { relatedOrderId: order.id } });
    if (demo.integrationFailure) {
      const failure = await db.integrationFailure.create({
        data: {
          shopId: shop.id,
          integration: IntegrationType.SHOPIFY_TAG_UPDATE,
          action: "update_order_tags",
          relatedOrderId: order.id,
          summary: demo.integrationFailure.summary,
          technicalDetail: demo.integrationFailure.technicalDetail,
          severity: demo.integrationFailure.severity,
          status: IntegrationFailureStatus.NEW,
          attemptCount: demo.integrationFailure.attempts ?? 0,
        },
      });
      const attemptCount = demo.integrationFailure.attempts ?? 0;
      for (let i = 0; i < attemptCount; i++) {
        await db.integrationAttempt.create({
          data: {
            failureId: failure.id,
            attemptedAt: new Date(now.getTime() - (attemptCount - i) * 60 * 60 * 1000),
            succeeded: false,
            errorSummary: "429 Too Many Requests",
          },
        });
      }
    }

    // Notes: internal only, authored by the demo staff member.
    await db.orderNote.deleteMany({ where: { orderId: order.id } });
    const notes = demo.notes ?? [];
    for (const [index, body] of notes.entries()) {
      await db.orderNote.create({
        data: {
          orderId: order.id,
          authorStaffId: demoStaff.id,
          body,
          visibility: NoteVisibility.INTERNAL,
          createdAt: new Date(now.getTime() - (notes.length - index) * DAY_MS),
        },
      });
    }

    // A long, backdated activity history so the Activity tab's "load more"
    // pagination has something real to page through.
    await db.activityEvent.deleteMany({ where: { orderId: order.id } });
    const activityEventCount = demo.activityEventCount ?? 1;
    for (let i = 0; i < activityEventCount; i++) {
      const isFirst = i === 0;
      await db.activityEvent.create({
        data: {
          shopId: shop.id,
          orderId: order.id,
          entityType: "ShopifyOrder",
          entityId: order.id,
          eventType: isFirst ? "ORDER_IMPORTED" : "workflow_status_changed",
          summary: isFirst
            ? `Order ${demo.orderNumber} imported from Shopify`
            : `Order ${demo.orderNumber} touched by a routine sync check (demo activity #${i + 1})`,
          actorType: isFirst ? ActorType.SYSTEM : ActorType.STAFF,
          actorStaffId: isFirst ? null : demoStaff.id,
          createdAt: new Date(now.getTime() - (activityEventCount - i) * 3 * 60 * 60 * 1000),
        },
      });
    }
  }

  // ---------------------------------------------------------------------
  // Milestone 08 (Proof Groups and Proof Versions) — order #9020's proof
  // groups. Built by calling the real domain functions (not raw Prisma
  // inserts) so the upload/checksum/versioning/readiness pipeline is
  // exercised with genuine data, matching this milestone's own "no fake
  // proof records" rule.
  //
  // Re-fetch #9020 now that the main loop above has (re)created its lines.
  // The proof-group cleanup itself already ran earlier, before the main
  // loop touched #9020's lines — ProofGroupOrderLine has a foreign key to
  // ShopifyOrderLine, so it must be gone before the main loop's own
  // "delete and recreate this order's lines" step runs, not after.
  // ---------------------------------------------------------------------
  const order9020 = await db.shopifyOrder.findFirstOrThrow({
    where: { shopId: shop.id, orderNumber: "#9020" },
    include: { lines: { orderBy: { createdAt: "asc" } } },
  });
  const [poloLine, capLine, hoodieLine, unprintedLine] = order9020.lines;
  if (!poloLine || !capLine || !hoodieLine || !unprintedLine) {
    throw new Error("Expected #9020 to have 4 lines for the Milestone 08 proof-group fixtures.");
  }

  function demoAssetUrl(name: string): string {
    return `https://cdn.justshear.example/uploads/9020-${name}`;
  }
  async function upsertDemoAsset(params: {
    key: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    parsingUncertain?: boolean;
  }) {
    const sourceUrl = demoAssetUrl(params.key);
    return db.customerArtworkAsset.upsert({
      where: { shopId_sourceUrl: { shopId: shop.id, sourceUrl } },
      update: {},
      create: {
        shopId: shop.id,
        originalFilename: params.originalFilename,
        sourceUrl,
        mimeType: params.mimeType,
        sizeBytes: params.sizeBytes,
        parsingUncertain: params.parsingUncertain ?? false,
      },
    });
  }

  const repeatLogoAsset = await upsertDemoAsset({
    key: "repeat-logo.png",
    originalFilename: "repeat-logo-approved.png",
    mimeType: "image/png",
    sizeBytes: 210_000,
  });
  const productionReadyAsset = await upsertDemoAsset({
    key: "production-ready.pdf",
    originalFilename: "production-ready-artwork.pdf",
    mimeType: "application/pdf",
    sizeBytes: 890_000,
  });
  const backPrintAssetA = await upsertDemoAsset({
    key: "back-print-1.png",
    originalFilename: "back-print-draft-1.png",
    mimeType: "image/png",
    sizeBytes: 340_000,
  });
  const backPrintAssetB = await upsertDemoAsset({
    key: "back-print-2.svg",
    originalFilename: "back-print-vector.svg",
    mimeType: "image/svg+xml",
    sizeBytes: 45_000,
    parsingUncertain: true,
  });
  const leftChestAssetB = await upsertDemoAsset({
    key: "left-chest-reference.png",
    originalFilename: "left-chest-reference.png",
    mimeType: "image/png",
    sizeBytes: 128_000,
  });

  // 1. Left chest embroidery — linked to several garment lines, several
  //    customer uploads, version 1 (auto-superseded) and version 2
  //    (marked ready to send).
  const leftChest = await createProofGroup({
    shopId: shop.id,
    orderId: order9020.id,
    name: "Left chest embroidery",
    decorationMethod: "EMBROIDERY",
    placement: "Left chest",
    description: "Standard left chest placement across all garment lines on this order.",
    requirement: "REQUIRED",
    noProofReason: null,
    noProofReasonNote: null,
    orderLineIds: [poloLine.id, capLine.id, hoodieLine.id],
    assetIds: [backPrintAssetA.id, leftChestAssetB.id],
    assignedStaffId: demoStaff.id,
    dueDate: new Date(now.getTime() + 5 * DAY_MS),
    priority: Priority.NORMAL,
    staffUserId: demoStaff.id,
  });
  if (leftChest.outcome !== "created") {
    throw new Error(`Failed to seed "Left chest embroidery": ${JSON.stringify(leftChest)}`);
  }
  const leftChestV1 = await createProofVersion({
    shopId: shop.id,
    proofGroupId: leftChest.proofGroupId,
    fileBuffer: DEMO_PNG_BYTES,
    originalFilename: "left-chest-v1.png",
    internalNote: "First pass — logo may be slightly small.",
    sourceAssetIds: [backPrintAssetA.id],
    idempotencyKey: null,
    staffUserId: demoStaff.id,
  });
  if (leftChestV1.outcome !== "created") {
    throw new Error(`Failed to seed left-chest v1: ${JSON.stringify(leftChestV1)}`);
  }
  const leftChestV2 = await createProofVersion({
    shopId: shop.id,
    proofGroupId: leftChest.proofGroupId,
    fileBuffer: DEMO_PNG_BYTES,
    originalFilename: "left-chest-v2.png",
    internalNote: "Enlarged logo 15% per feedback.",
    sourceAssetIds: [backPrintAssetA.id, leftChestAssetB.id],
    idempotencyKey: null,
    staffUserId: demoStaff.id,
  });
  if (leftChestV2.outcome !== "created") {
    throw new Error(`Failed to seed left-chest v2: ${JSON.stringify(leftChestV2)}`);
  }
  const leftChestReady = await markProofVersionReady({
    shopId: shop.id,
    proofVersionId: leftChestV2.proofVersionId,
    staffUserId: demoStaff.id,
  });
  if (leftChestReady.outcome !== "ready") {
    console.warn(`Left-chest v2 could not be marked ready: ${JSON.stringify(leftChestReady)}`);
  }

  // 2. Full back print — the SAME polo line as the embroidery group above
  //    (one line, two proof groups), overdue due date, assigned to a
  //    different artwork staff member, blocked by a simulated storage
  //    failure.
  const fullBack = await createProofGroup({
    shopId: shop.id,
    orderId: order9020.id,
    name: "Full back print",
    decorationMethod: "SCREEN_PRINT",
    placement: "Full back",
    description: "Large back print, same polo run as the left chest embroidery above.",
    requirement: "REQUIRED",
    noProofReason: null,
    noProofReasonNote: null,
    orderLineIds: [poloLine.id],
    assetIds: [backPrintAssetB.id],
    assignedStaffId: demoStaff2.id,
    dueDate: new Date(now.getTime() - 3 * DAY_MS),
    priority: Priority.HIGH,
    staffUserId: demoStaff2.id,
  });
  if (fullBack.outcome !== "created") {
    throw new Error(`Failed to seed "Full back print": ${JSON.stringify(fullBack)}`);
  }
  const fullBackDraft = await createProofVersion({
    shopId: shop.id,
    proofGroupId: fullBack.proofGroupId,
    fileBuffer: DEMO_PDF_BYTES,
    originalFilename: "full-back-draft.pdf",
    internalNote: "Draft using the customer's vector file — awaiting print-shop sign-off.",
    sourceAssetIds: [backPrintAssetB.id],
    idempotencyKey: null,
    staffUserId: demoStaff2.id,
  });
  if (fullBackDraft.outcome !== "created") {
    throw new Error(`Failed to seed full-back draft: ${JSON.stringify(fullBackDraft)}`);
  }
  await db.integrationFailure.create({
    data: {
      shopId: shop.id,
      integration: IntegrationType.FILE_STORAGE,
      action: "store_proof_asset",
      relatedProofGroupId: fullBack.proofGroupId,
      summary: "Failed to verify checksum for an uploaded back-print file",
      technicalDetail:
        "Local-disk storage read a truncated file after an interrupted write; re-upload required.",
      severity: Severity.MEDIUM,
      status: IntegrationFailureStatus.NEW,
    },
  });

  // 3. Repeat approved logo — no proof required (repeat job), reusing
  //    previously-approved artwork.
  const repeatLogo = await createProofGroup({
    shopId: shop.id,
    orderId: order9020.id,
    name: "Repeat approved logo",
    decorationMethod: "EMBROIDERY",
    placement: "Left sleeve",
    description: "Same logo approved on a previous order — no new proof needed.",
    requirement: "NOT_REQUIRED",
    noProofReason: "REPEAT_JOB_PREVIOUS_ARTWORK",
    noProofReasonNote: null,
    orderLineIds: [capLine.id],
    assetIds: [repeatLogoAsset.id],
    assignedStaffId: null,
    dueDate: null,
    priority: Priority.NORMAL,
    staffUserId: demoStaff.id,
  });
  if (repeatLogo.outcome !== "created") {
    throw new Error(`Failed to seed "Repeat approved logo": ${JSON.stringify(repeatLogo)}`);
  }

  // 4. Unprinted garments — no proof required (unprinted product), no
  //    placement (a documented exception for this decoration method).
  const unprinted = await createProofGroup({
    shopId: shop.id,
    orderId: order9020.id,
    name: "Unprinted garments",
    decorationMethod: "UNPRINTED",
    placement: null,
    description: "Blank tees — no decoration on this line.",
    requirement: "NOT_REQUIRED",
    noProofReason: "UNPRINTED_PRODUCT",
    noProofReasonNote: null,
    orderLineIds: [unprintedLine.id],
    assetIds: [],
    assignedStaffId: null,
    dueDate: null,
    priority: Priority.LOW,
    staffUserId: demoStaff.id,
  });
  if (unprinted.outcome !== "created") {
    throw new Error(`Failed to seed "Unprinted garments": ${JSON.stringify(unprinted)}`);
  }

  // 5. Production-ready customer artwork — no proof required (customer
  //    supplied a print-ready file).
  const productionReady = await createProofGroup({
    shopId: shop.id,
    orderId: order9020.id,
    name: "Production-ready customer artwork",
    decorationMethod: "DIGITAL_PRINT_DTF",
    placement: "Full front",
    description: "Customer supplied a print-ready file directly — no internal proof needed.",
    requirement: "NOT_REQUIRED",
    noProofReason: "CUSTOMER_SUPPLIED_PRODUCTION_READY",
    noProofReasonNote: null,
    orderLineIds: [hoodieLine.id],
    assetIds: [productionReadyAsset.id],
    assignedStaffId: null,
    dueDate: null,
    priority: Priority.NORMAL,
    staffUserId: demoStaff.id,
  });
  if (productionReady.outcome !== "created") {
    throw new Error(
      `Failed to seed "Production-ready customer artwork": ${JSON.stringify(productionReady)}`,
    );
  }

  // 6. Sleeve logo — requirement left UNDETERMINED (the honest default),
  //    no customer uploads linked yet, no proof versions yet.
  const sleeveLogo = await createProofGroup({
    shopId: shop.id,
    orderId: order9020.id,
    name: "Sleeve logo",
    decorationMethod: "EMBROIDERY",
    placement: "Right sleeve",
    description: null,
    requirement: "UNDETERMINED",
    noProofReason: null,
    noProofReasonNote: null,
    orderLineIds: [capLine.id],
    assetIds: [],
    assignedStaffId: null,
    dueDate: null,
    priority: Priority.NORMAL,
    staffUserId: demoStaff.id,
  });
  if (sleeveLogo.outcome !== "created") {
    throw new Error(`Failed to seed "Sleeve logo": ${JSON.stringify(sleeveLogo)}`);
  }

  // 7. Staff names — a cancelled draft. Both the version and the group are
  //    cancelled with reasons, and both rows remain in the database
  //    (visible in history) rather than being deleted.
  const staffNames = await createProofGroup({
    shopId: shop.id,
    orderId: order9020.id,
    name: "Staff names",
    decorationMethod: "EMBROIDERY",
    placement: "Back neck",
    description:
      "Personalised staff-name embroidery — line item cancelled before artwork was finalised.",
    requirement: "REQUIRED",
    noProofReason: null,
    noProofReasonNote: null,
    orderLineIds: [hoodieLine.id],
    assetIds: [],
    assignedStaffId: demoStaff.id,
    dueDate: null,
    priority: Priority.NORMAL,
    staffUserId: demoStaff.id,
  });
  if (staffNames.outcome !== "created") {
    throw new Error(`Failed to seed "Staff names": ${JSON.stringify(staffNames)}`);
  }
  const staffNamesDraft = await createProofVersion({
    shopId: shop.id,
    proofGroupId: staffNames.proofGroupId,
    fileBuffer: DEMO_PNG_BYTES,
    originalFilename: "staff-names-draft.png",
    internalNote: "Waiting on the final staff list from the customer.",
    sourceAssetIds: [],
    idempotencyKey: null,
    staffUserId: demoStaff.id,
  });
  if (staffNamesDraft.outcome !== "created") {
    throw new Error(`Failed to seed staff-names draft: ${JSON.stringify(staffNamesDraft)}`);
  }
  await cancelProofVersion({
    shopId: shop.id,
    proofVersionId: staffNamesDraft.proofVersionId,
    reason: "Customer cancelled this line item before names were finalised.",
    staffUserId: demoStaff.id,
  });
  await cancelProofGroup({
    shopId: shop.id,
    proofGroupId: staffNames.proofGroupId,
    reason: "Line item removed from the order after cancellation.",
    staffUserId: demoStaff.id,
  });

  // ---------------------------------------------------------------------
  // Milestone 09 (Customer Proof Portal and Responses) — order #9021's
  // proof-request scenarios. Built via the real domain functions
  // (sendProofRequest, recordCustomerProofResponse, revokeProofRequest,
  // suppressProofReminder, dispatchDueProofReminders), never raw inserts,
  // so the token/idempotency/response pipeline is genuinely exercised —
  // matching this milestone's own "no fake customer actions" rule.
  //
  // Klaviyo delivery will fail in local dev (no real KLAVIYO_API_KEY) —
  // that's expected, and itself an honest demonstration of the "email
  // delivery failure" scenario rather than something faked separately.
  // ---------------------------------------------------------------------
  const order9021 = await db.shopifyOrder.findFirstOrThrow({
    where: { shopId: shop.id, orderNumber: "#9021" },
    include: { lines: { orderBy: { createdAt: "asc" } } },
  });
  const [jumperLine, cap21Line, jacketLine] = order9021.lines;
  if (!jumperLine || !cap21Line || !jacketLine) {
    throw new Error("Expected #9021 to have 3 lines for the Milestone 09 proof-request fixtures.");
  }

  async function seedReadyGroup(
    name: string,
    lineId: string,
    placement: string,
  ): Promise<{ proofGroupId: string; proofVersionId: string }> {
    const group = await createProofGroup({
      shopId: shop.id,
      orderId: order9021.id,
      name,
      decorationMethod: "EMBROIDERY",
      placement,
      description: null,
      requirement: "REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [lineId],
      assetIds: [],
      assignedStaffId: demoStaff.id,
      dueDate: null,
      priority: Priority.NORMAL,
      staffUserId: demoStaff.id,
    });
    if (group.outcome !== "created") {
      throw new Error(`Failed to seed "${name}": ${JSON.stringify(group)}`);
    }
    const version = await createProofVersion({
      shopId: shop.id,
      proofGroupId: group.proofGroupId,
      fileBuffer: DEMO_PNG_BYTES,
      originalFilename: `${name.toLowerCase().replace(/\s+/g, "-")}.png`,
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: demoStaff.id,
    });
    if (version.outcome !== "created") {
      throw new Error(`Failed to seed a version for "${name}": ${JSON.stringify(version)}`);
    }
    const ready = await markProofVersionReady({
      shopId: shop.id,
      proofVersionId: version.proofVersionId,
      staffUserId: demoStaff.id,
    });
    if (ready.outcome !== "ready") {
      throw new Error(`Failed to mark "${name}" ready: ${JSON.stringify(ready)}`);
    }
    return { proofGroupId: group.proofGroupId, proofVersionId: version.proofVersionId };
  }

  // Scenario A — one proof request bundling three groups: one the customer
  // approves, one they request changes on (with a marked-up file), and one
  // left awaiting response. Demonstrates multi-group bundling, partial
  // response, and independent per-group outcomes within a single request.
  const frontLogo = await seedReadyGroup("Front logo embroidery", jumperLine.id, "Left chest");
  const capBadge = await seedReadyGroup("Cap badge embroidery", cap21Line.id, "Front badge");
  const jacketPatch = await seedReadyGroup("Jacket back patch", jacketLine.id, "Full back");

  const multiGroupSend = await sendProofRequest({
    shopId: shop.id,
    orderId: order9021.id,
    proofGroupIds: [frontLogo.proofGroupId, capBadge.proofGroupId, jacketPatch.proofGroupId],
    staffMessage: "Here's the artwork for your recent order — please take a look when you can.",
    staffUserId: demoStaff.id,
  });
  if (multiGroupSend.outcome !== "sent") {
    throw new Error(
      `Failed to send the multi-group proof request: ${JSON.stringify(multiGroupSend)}`,
    );
  }

  const approveFrontLogo = await recordCustomerProofResponse({
    rawToken: multiGroupSend.rawToken,
    proofGroupId: frontLogo.proofGroupId,
    responseType: "APPROVED",
    customerNote: null,
    changeCategories: [],
    acknowledgedApproval: true,
    idempotencyKey: `seed-approve-${frontLogo.proofGroupId}`,
    requestIp: null,
    requestUserAgent: "seed-script (Milestone 09 fixtures)",
    files: [],
  });
  if (approveFrontLogo.outcome === "rejected") {
    throw new Error(`Failed to seed the front-logo approval: ${approveFrontLogo.reason}`);
  }

  const requestChangesCapBadge = await recordCustomerProofResponse({
    rawToken: multiGroupSend.rawToken,
    proofGroupId: capBadge.proofGroupId,
    responseType: "CHANGES_REQUESTED",
    customerNote: "Could the badge be centred a little higher on the cap, please?",
    changeCategories: [ChangeRequestCategory.PLACEMENT],
    acknowledgedApproval: false,
    idempotencyKey: `seed-changes-${capBadge.proofGroupId}`,
    requestIp: null,
    requestUserAgent: "seed-script (Milestone 09 fixtures)",
    files: [{ buffer: DEMO_PNG_BYTES, originalFilename: "cap-badge-markup.png" }],
  });
  if (requestChangesCapBadge.outcome === "rejected") {
    throw new Error(
      `Failed to seed the cap-badge change request: ${requestChangesCapBadge.reason}`,
    );
  }
  // jacketPatch is deliberately left unresolved — "awaiting customer response".

  // Scenario B — a single-group request the customer never got to act on
  // before staff revoked the link (e.g. sent to the wrong address).
  const hemFinish = await seedReadyGroup("Hem finish embroidery", jumperLine.id, "Hem");
  const hemSend = await sendProofRequest({
    shopId: shop.id,
    orderId: order9021.id,
    proofGroupIds: [hemFinish.proofGroupId],
    staffMessage: null,
    staffUserId: demoStaff.id,
  });
  if (hemSend.outcome !== "sent") {
    throw new Error(`Failed to send the hem-finish proof request: ${JSON.stringify(hemSend)}`);
  }
  const hemRevoke = await revokeProofRequest({
    shopId: shop.id,
    proofRequestId: hemSend.proofRequestId,
    reason: "Sent to an outdated email address on file — resending to the correct one separately.",
    staffUserId: demoStaff.id,
  });
  if (hemRevoke.outcome === "rejected") {
    throw new Error(`Failed to revoke the hem-finish proof request: ${hemRevoke.reason}`);
  }

  // Scenario C — an expired link. Real expiry is PROOF_TOKEN_EXPIRY_DAYS
  // (default 14) in the future; time can't genuinely pass in a seed
  // script, so the expiry is deliberately backdated here to simulate it —
  // an honest simulation of elapsed time, not a fabricated status.
  const zipperPull = await seedReadyGroup("Zipper pull embroidery", jacketLine.id, "Zipper pull");
  const zipperSend = await sendProofRequest({
    shopId: shop.id,
    orderId: order9021.id,
    proofGroupIds: [zipperPull.proofGroupId],
    staffMessage: null,
    staffUserId: demoStaff.id,
  });
  if (zipperSend.outcome !== "sent") {
    throw new Error(`Failed to send the zipper-pull proof request: ${JSON.stringify(zipperSend)}`);
  }
  await db.proofRequest.update({
    where: { id: zipperSend.proofRequestId },
    data: { tokenExpiresAt: new Date(now.getTime() - 1 * DAY_MS) },
  });

  // Scenario D — reminder suppressed by staff before it was ever due.
  const cuffEmbroidery = await seedReadyGroup("Cuff embroidery", jumperLine.id, "Cuff");
  const cuffSend = await sendProofRequest({
    shopId: shop.id,
    orderId: order9021.id,
    proofGroupIds: [cuffEmbroidery.proofGroupId],
    staffMessage: null,
    staffUserId: demoStaff.id,
  });
  if (cuffSend.outcome !== "sent") {
    throw new Error(
      `Failed to send the cuff-embroidery proof request: ${JSON.stringify(cuffSend)}`,
    );
  }
  const cuffSuppress = await suppressProofReminder({
    shopId: shop.id,
    proofRequestId: cuffSend.proofRequestId,
    reason: "Customer already confirmed by phone that this is fine — no reminder needed.",
    staffUserId: demoStaff.id,
  });
  if (cuffSuppress.outcome === "rejected") {
    throw new Error(`Failed to suppress the cuff-embroidery reminder: ${cuffSuppress.reason}`);
  }

  // Scenario E — the automatic reminder has actually fired. Its
  // scheduledFor is backdated (same honest "simulate elapsed time"
  // approach as Scenario C) and then genuinely dispatched through the same
  // poller function production uses, rather than hand-writing a "sent"
  // row directly.
  const collarLabel = await seedReadyGroup("Collar label print", cap21Line.id, "Inside collar");
  const collarSend = await sendProofRequest({
    shopId: shop.id,
    orderId: order9021.id,
    proofGroupIds: [collarLabel.proofGroupId],
    staffMessage: null,
    staffUserId: demoStaff.id,
  });
  if (collarSend.outcome !== "sent") {
    throw new Error(`Failed to send the collar-label proof request: ${JSON.stringify(collarSend)}`);
  }
  await db.proofReminder.updateMany({
    where: { proofRequestId: collarSend.proofRequestId },
    data: { scheduledFor: new Date(now.getTime() - 1 * 60 * 60 * 1000) },
  });
  await dispatchDueProofReminders();

  // Scenario F — staff created a new version after sending, superseding
  // the version the customer's link actually points to. The original
  // request becomes non-actionable for this group ("a newer proof is now
  // available") without anything being deleted.
  const pocketEmbroidery = await seedReadyGroup("Pocket embroidery", jacketLine.id, "Chest pocket");
  const pocketSend = await sendProofRequest({
    shopId: shop.id,
    orderId: order9021.id,
    proofGroupIds: [pocketEmbroidery.proofGroupId],
    staffMessage: null,
    staffUserId: demoStaff.id,
  });
  if (pocketSend.outcome !== "sent") {
    throw new Error(
      `Failed to send the pocket-embroidery proof request: ${JSON.stringify(pocketSend)}`,
    );
  }
  const pocketV2 = await createProofVersion({
    shopId: shop.id,
    proofGroupId: pocketEmbroidery.proofGroupId,
    fileBuffer: DEMO_PNG_BYTES,
    originalFilename: "pocket-embroidery-v2.png",
    internalNote:
      "Noticed a placement error right after sending — corrected before the customer replied.",
    sourceAssetIds: [],
    idempotencyKey: null,
    staffUserId: demoStaff.id,
  });
  if (pocketV2.outcome !== "created") {
    throw new Error(`Failed to seed pocket-embroidery v2: ${JSON.stringify(pocketV2)}`);
  }

  // ---------------------------------------------------------------------
  // Milestone 10 (Export for Print and Production Artwork) — order #9022's
  // production-artwork and export-batch scenarios. Built via the real
  // domain functions (createProofGroup/createProofVersion/
  // sendProofRequest/recordCustomerProofResponse/setProofRequirement/
  // createProductionArtwork/markProductionArtworkReady/createExportBatch),
  // never raw inserts, matching this milestone's own "no fake customer
  // actions" rule and the same precedent set by #9020/#9021 above.
  // ---------------------------------------------------------------------
  const order9022 = await db.shopifyOrder.findFirstOrThrow({
    where: { shopId: shop.id, orderNumber: "#9022" },
    include: { lines: { orderBy: { createdAt: "asc" } } },
  });
  const [varsityJacketLine, beanieLine] = order9022.lines;
  if (!varsityJacketLine || !beanieLine) {
    throw new Error(
      "Expected #9022 to have 2 lines for the Milestone 10 production-artwork fixtures.",
    );
  }

  async function seedApprovedGroup(
    name: string,
    lineId: string,
    placement: string,
  ): Promise<string> {
    const group = await createProofGroup({
      shopId: shop.id,
      orderId: order9022.id,
      name,
      decorationMethod: "EMBROIDERY",
      placement,
      description: null,
      requirement: "REQUIRED",
      noProofReason: null,
      noProofReasonNote: null,
      orderLineIds: [lineId],
      assetIds: [],
      assignedStaffId: demoStaff.id,
      dueDate: null,
      priority: Priority.NORMAL,
      staffUserId: demoStaff.id,
    });
    if (group.outcome !== "created") {
      throw new Error(`Failed to seed "${name}": ${JSON.stringify(group)}`);
    }
    const version = await createProofVersion({
      shopId: shop.id,
      proofGroupId: group.proofGroupId,
      fileBuffer: DEMO_PNG_BYTES,
      originalFilename: `${name.toLowerCase().replace(/\s+/g, "-")}.png`,
      internalNote: null,
      sourceAssetIds: [],
      idempotencyKey: null,
      staffUserId: demoStaff.id,
    });
    if (version.outcome !== "created") {
      throw new Error(`Failed to seed a version for "${name}": ${JSON.stringify(version)}`);
    }
    const ready = await markProofVersionReady({
      shopId: shop.id,
      proofVersionId: version.proofVersionId,
      staffUserId: demoStaff.id,
    });
    if (ready.outcome !== "ready") {
      throw new Error(`Failed to mark "${name}" ready: ${JSON.stringify(ready)}`);
    }
    const send = await sendProofRequest({
      shopId: shop.id,
      orderId: order9022.id,
      proofGroupIds: [group.proofGroupId],
      staffMessage: null,
      staffUserId: demoStaff.id,
    });
    if (send.outcome !== "sent") {
      throw new Error(`Failed to send proof request for "${name}": ${JSON.stringify(send)}`);
    }
    const approve = await recordCustomerProofResponse({
      rawToken: send.rawToken,
      proofGroupId: group.proofGroupId,
      responseType: "APPROVED",
      customerNote: null,
      changeCategories: [],
      acknowledgedApproval: true,
      idempotencyKey: `seed-approve-${group.proofGroupId}`,
      requestIp: null,
      requestUserAgent: "seed-script (Milestone 10 fixtures)",
      files: [],
    });
    if (approve.outcome === "rejected") {
      throw new Error(`Failed to seed the "${name}" approval: ${approve.reason}`);
    }
    return group.proofGroupId;
  }

  // Scenario A — approved, no production artwork prepared yet. Exercises
  // the Kanban board's "missing production artwork" indicator.
  await seedApprovedGroup("Front chest print", varsityJacketLine.id, "Left chest");

  // Scenario B — approved, a production artwork revision has been
  // uploaded but is still in draft (not yet marked ready for export).
  const sleeveGroupId = await seedApprovedGroup(
    "Sleeve embroidery",
    varsityJacketLine.id,
    "Left sleeve",
  );
  const sleeveArtwork = await createProductionArtwork({
    shopId: shop.id,
    proofGroupId: sleeveGroupId,
    fileBuffer: DEMO_PDF_BYTES,
    originalFilename: "sleeve-embroidery-production.pdf",
    decorationMethod: null,
    placement: "Left sleeve",
    productionMetadata: null,
    staffUserId: demoStaff.id,
    idempotencyKey: null,
  });
  if (sleeveArtwork.outcome !== "created") {
    throw new Error(
      `Failed to seed sleeve-embroidery production artwork: ${JSON.stringify(sleeveArtwork)}`,
    );
  }

  // Scenario C — legitimately no-proof-required (a standard approved logo,
  // repeated from a previous job), with production artwork prepared,
  // allocated to its order line, and marked ready for export — this is the
  // group the export-batch demo below actually exports.
  const capGroupResult = await createProofGroup({
    shopId: shop.id,
    orderId: order9022.id,
    name: "Cap embroidery",
    decorationMethod: "EMBROIDERY",
    placement: "Front badge",
    description: null,
    requirement: "NOT_REQUIRED",
    noProofReason: "APPROVED_STANDARD_LOGO",
    noProofReasonNote: "Standard approved club logo, run on every order this season.",
    orderLineIds: [beanieLine.id],
    assetIds: [],
    assignedStaffId: demoStaff.id,
    dueDate: null,
    priority: Priority.NORMAL,
    staffUserId: demoStaff.id,
  });
  if (capGroupResult.outcome !== "created") {
    throw new Error(`Failed to seed "Cap embroidery": ${JSON.stringify(capGroupResult)}`);
  }
  const capArtwork = await createProductionArtwork({
    shopId: shop.id,
    proofGroupId: capGroupResult.proofGroupId,
    fileBuffer: DEMO_PDF_BYTES,
    originalFilename: "cap-embroidery-production.pdf",
    decorationMethod: null,
    placement: "Front badge",
    productionMetadata: null,
    staffUserId: demoStaff.id,
    idempotencyKey: null,
  });
  if (capArtwork.outcome !== "created") {
    throw new Error(
      `Failed to seed cap-embroidery production artwork: ${JSON.stringify(capArtwork)}`,
    );
  }
  const capAllocation = await setProductionArtworkOrderLines({
    shopId: shop.id,
    productionArtworkId: capArtwork.productionArtworkId,
    allocations: [{ orderLineId: beanieLine.id, quantity: beanieLine.quantity }],
    staffUserId: demoStaff.id,
  });
  if (capAllocation.outcome !== "set") {
    throw new Error(
      `Failed to allocate cap-embroidery order lines: ${JSON.stringify(capAllocation)}`,
    );
  }
  const capReady = await markProductionArtworkReady({
    shopId: shop.id,
    productionArtworkId: capArtwork.productionArtworkId,
    staffUserId: demoStaff.id,
  });
  if (capReady.outcome !== "ready") {
    throw new Error(`Failed to mark cap-embroidery artwork ready: ${JSON.stringify(capReady)}`);
  }

  // Scenario D — approved, exported once, then corrected and marked ready
  // again — exercises the Kanban board's "re-export required" indicator
  // and the drawer's re-export workflow.
  const jacketLogoGroupId = await seedApprovedGroup(
    "Jacket back logo",
    varsityJacketLine.id,
    "Full back",
  );
  const jacketArtworkV1 = await createProductionArtwork({
    shopId: shop.id,
    proofGroupId: jacketLogoGroupId,
    fileBuffer: DEMO_PDF_BYTES,
    originalFilename: "jacket-back-logo-production-v1.pdf",
    decorationMethod: null,
    placement: "Full back",
    productionMetadata: null,
    staffUserId: demoStaff.id,
    idempotencyKey: null,
  });
  if (jacketArtworkV1.outcome !== "created") {
    throw new Error(
      `Failed to seed jacket-back-logo production artwork: ${JSON.stringify(jacketArtworkV1)}`,
    );
  }
  const jacketAllocationV1 = await setProductionArtworkOrderLines({
    shopId: shop.id,
    productionArtworkId: jacketArtworkV1.productionArtworkId,
    allocations: [{ orderLineId: varsityJacketLine.id, quantity: varsityJacketLine.quantity }],
    staffUserId: demoStaff.id,
  });
  if (jacketAllocationV1.outcome !== "set") {
    throw new Error(
      `Failed to allocate jacket-back-logo order lines: ${JSON.stringify(jacketAllocationV1)}`,
    );
  }
  const jacketReadyV1 = await markProductionArtworkReady({
    shopId: shop.id,
    productionArtworkId: jacketArtworkV1.productionArtworkId,
    staffUserId: demoStaff.id,
  });
  if (jacketReadyV1.outcome !== "ready") {
    throw new Error(
      `Failed to mark jacket-back-logo artwork v1 ready: ${JSON.stringify(jacketReadyV1)}`,
    );
  }
  const jacketExport = await createExportBatch({
    shopId: shop.id,
    orderId: order9022.id,
    proofGroupIds: [jacketLogoGroupId],
    destination: "Embroidery vendor — via email",
    staffUserId: demoStaff.id,
    idempotencyKey: `seed-export-${jacketLogoGroupId}`,
  });
  if (jacketExport.outcome !== "exported") {
    throw new Error(`Failed to export jacket-back-logo: ${JSON.stringify(jacketExport)}`);
  }
  // A correction is prepared after the export above — this new revision
  // supersedes nothing (the exported v1 stays immutable) but re-promotes
  // the group back to READY_FOR_EXPORT once marked ready.
  const jacketArtworkV2 = await createProductionArtwork({
    shopId: shop.id,
    proofGroupId: jacketLogoGroupId,
    fileBuffer: DEMO_PDF_BYTES,
    originalFilename: "jacket-back-logo-production-v2-corrected.pdf",
    decorationMethod: null,
    placement: "Full back",
    productionMetadata: null,
    staffUserId: demoStaff.id,
    idempotencyKey: null,
  });
  if (jacketArtworkV2.outcome !== "created") {
    throw new Error(
      `Failed to seed jacket-back-logo production artwork v2: ${JSON.stringify(jacketArtworkV2)}`,
    );
  }
  const jacketAllocationV2 = await setProductionArtworkOrderLines({
    shopId: shop.id,
    productionArtworkId: jacketArtworkV2.productionArtworkId,
    allocations: [{ orderLineId: varsityJacketLine.id, quantity: varsityJacketLine.quantity }],
    staffUserId: demoStaff.id,
  });
  if (jacketAllocationV2.outcome !== "set") {
    throw new Error(
      `Failed to allocate jacket-back-logo v2 order lines: ${JSON.stringify(jacketAllocationV2)}`,
    );
  }
  const jacketReadyV2 = await markProductionArtworkReady({
    shopId: shop.id,
    productionArtworkId: jacketArtworkV2.productionArtworkId,
    staffUserId: demoStaff.id,
  });
  if (jacketReadyV2.outcome !== "ready") {
    throw new Error(
      `Failed to mark jacket-back-logo artwork v2 ready: ${JSON.stringify(jacketReadyV2)}`,
    );
  }

  console.log(
    `Seeded ${demoOrders.length} demo orders (#9001–#9022) for Kanban board and order drawer manual verification, ` +
      `including 7 proof groups on #9020, 8 proof groups across 6 proof-request scenarios on #9021, ` +
      `and 4 production-artwork/export scenarios on #9022.`,
  );
  console.log('Delete them with: DELETE FROM "ShopifyOrder" WHERE "orderNumber" LIKE \'#90%\';');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
