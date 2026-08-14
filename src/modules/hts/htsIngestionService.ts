import { db } from "@/lib/db";
import { DomainError } from "@/lib/api/error";
import { RateParser } from "./rateParser";
import { Prisma } from "@prisma/client";
import crypto from "crypto";

export interface HtsRawItem {
  htsno?: string;
  htsno_display?: string;
  description?: string;
  superior?: string | boolean;
  units?: string[];
  general?: string;
  special?: string;
  other?: string;
  footnotes?: Array<{ columns?: string[]; remark?: string; value?: string }>;
}

export interface IngestReleaseInput {
  editionYear: number;
  revisionNumber: number;
  releaseName: string;
  sourceUrl: string;
  sourceFormat: "JSON" | "CSV" | "PDF";
  rawContent: string | Buffer;
  items: HtsRawItem[];
}

export class HtsIngestionService {
  /**
   * Calculates SHA-256 hash of raw content buffer or string.
   */
  static computeChecksum(content: string | Buffer): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * Stages a new HTS release candidate without publishing it.
   */
  static async stageRelease(input: IngestReleaseInput) {
    const sha256 = this.computeChecksum(input.rawContent);

    // Check for existing checksum
    const existing = await db.htsRelease.findFirst({
      where: { sha256 },
    });

    if (existing && existing.publicationStatus === "PUBLISHED") {
      throw new DomainError(
        `Release checksum '${sha256}' has already been published as release '${existing.id}'. Duplicate ingestion rejected.`,
        "DUPLICATE_RELEASE",
        409
      );
    }

    const effectiveFrom = new Date(Date.UTC(input.editionYear, 0, 1));
    const rawObjectKey = `raw_artifacts/hts_${input.editionYear}_rev${input.revisionNumber}_${sha256.slice(0, 12)}.json`;

    // Track hierarchical parent nodes by level (2, 4, 6, 8, 10) for parentId population
    const ancestorByLevel: Record<number, string> = {};

    // Build every row in memory first, with pre-generated IDs, so all of
    // it can go in via batched createMany() inside a single transaction.
    const nodeRows: Prisma.HtsNodeCreateManyInput[] = [];
    const dutyRateRows: Prisma.HtsDutyRateCreateManyInput[] = [];
    const unitRows: Prisma.HtsUnitCreateManyInput[] = [];

    const releaseId = crypto.randomUUID();
    let rowNumber = 1;

    for (const item of input.items) {
      const rawCode = (item.htsno || "").replace(/[^0-9]/g, "");
      const displayCode = item.htsno_display || item.htsno || "";
      const description = item.description || "";
      const isSuperior = Boolean(item.superior) || !rawCode;

      let codeLevel = 2;
      if (rawCode.length >= 10) codeLevel = 10;
      else if (rawCode.length >= 8) codeLevel = 8;
      else if (rawCode.length >= 6) codeLevel = 6;
      else if (rawCode.length >= 4) codeLevel = 4;
      else if (rawCode.length >= 2) codeLevel = 2;

      const chapter = rawCode.substring(0, 2) || "00";
      const heading = rawCode.substring(0, 4) || chapter;
      const subheading6 = rawCode.length >= 6 ? rawCode.substring(0, 6) : null;
      const tariffLine8 = rawCode.length >= 8 ? rawCode.substring(0, 8) : null;
      const statisticalSuffix10 = rawCode.length >= 10 ? rawCode.substring(8, 10) : null;

      // Determine parentId based on code level hierarchy
      let parentLevel = 0;
      if (codeLevel === 10) parentLevel = 8;
      else if (codeLevel === 8) parentLevel = 6;
      else if (codeLevel === 6) parentLevel = 4;
      else if (codeLevel === 4) parentLevel = 2;

      let parentId: string | null = null;
      if (parentLevel > 0) {
        for (let lvl = parentLevel; lvl >= 2; lvl -= 2) {
          if (ancestorByLevel[lvl]) {
            parentId = ancestorByLevel[lvl];
            break;
          }
        }
      }

      const nodeId = crypto.randomUUID();
      ancestorByLevel[codeLevel] = nodeId;
      for (let lvl = codeLevel + 2; lvl <= 10; lvl += 2) {
        delete ancestorByLevel[lvl];
      }

      nodeRows.push({
        id: nodeId,
        releaseId,
        sourceRowNumber: rowNumber++,
        parentId,
        indentLevel: isSuperior ? 0 : 1,
        htsNumberDisplay: displayCode,
        htsNumberNormalized: rawCode,
        codeLevel,
        description,
        fullDescription: description,
        isSuperiorHeading: isSuperior,
        isClassifiable: !isSuperior && rawCode.length >= 8,
        chapter,
        heading,
        subheading6,
        tariffLine8,
        statisticalSuffix10,
      });

      for (const [rateColumn, rawRate] of [
        ["General", item.general],
        ["Special", item.special],
        ["Column 2", item.other],
      ] as const) {
        if (!rawRate) continue;
        const p = RateParser.parse(rawRate, rateColumn);
        if (p.rateType === "Missing") continue;

        dutyRateRows.push({
          htsNodeId: nodeId,
          rateColumn,
          rawRateText: p.rawRateText,
          rateType: p.rateType,
          adValoremPercent: p.adValoremPercent,
          specificAmount: p.specificAmount,
          specificUnit: p.specificUnit,
          currency: p.currency,
          isFree: p.isFree,
          parseStatus: p.parseStatus,
        });
      }

      if (item.units && Array.isArray(item.units)) {
        let seq = 1;
        for (const u of item.units) {
          if (u) {
            unitRows.push({ htsNodeId: nodeId, sequence: seq++, unitCode: u });
          }
        }
      }
    }

    // Wrap release creation and batch insertions in a single atomic transaction
    const release = await db.$transaction(async (tx) => {
      const createdRelease = await tx.htsRelease.create({
        data: {
          id: releaseId,
          editionYear: input.editionYear,
          revisionNumber: input.revisionNumber,
          releaseName: input.releaseName,
          effectiveFrom,
          sourceUrl: input.sourceUrl,
          sourceFormat: input.sourceFormat,
          sha256,
          rawObjectKey,
          validationStatus: "VALIDATED",
          publicationStatus: "DRAFT",
        },
      });

      const BATCH_SIZE = 1000;
      for (let i = 0; i < nodeRows.length; i += BATCH_SIZE) {
        await tx.htsNode.createMany({ data: nodeRows.slice(i, i + BATCH_SIZE) });
      }
      for (let i = 0; i < dutyRateRows.length; i += BATCH_SIZE) {
        await tx.htsDutyRate.createMany({ data: dutyRateRows.slice(i, i + BATCH_SIZE) });
      }
      for (let i = 0; i < unitRows.length; i += BATCH_SIZE) {
        await tx.htsUnit.createMany({ data: unitRows.slice(i, i + BATCH_SIZE) });
      }

      return createdRelease;
    });

    // Auto-generate diff if a published release currently exists
    const currentPublished = await db.htsRelease.findFirst({
      where: { publicationStatus: "PUBLISHED" },
    });

    if (currentPublished) {
      await this.generateDiff(currentPublished.id, release.id).catch((err) =>
        console.error("[HtsIngestionService] Auto-diff on stageRelease failed:", err)
      );
    }

    return release;
  }

  /**
   * Performs release-to-release diffing between two releases and persists real HtsChange rows.
   */
  static async generateDiff(fromReleaseId: string, toReleaseId: string) {
    const fromNodes = await db.htsNode.findMany({
      where: { releaseId: fromReleaseId },
      include: { dutyRates: true },
    });
    const toNodes = await db.htsNode.findMany({
      where: { releaseId: toReleaseId },
      include: { dutyRates: true },
    });

    const fromMap = new Map(fromNodes.map((n) => [n.htsNumberNormalized, n]));
    const changeRows: Prisma.HtsChangeCreateManyInput[] = [];

    for (const toNode of toNodes) {
      if (!toNode.htsNumberNormalized) continue;
      const fromNode = fromMap.get(toNode.htsNumberNormalized);

      if (!fromNode) {
        changeRows.push({
          fromReleaseId,
          toReleaseId,
          newHtsNodeId: toNode.id,
          changeType: "ADDED",
          changedFields: {
            htsNumber: toNode.htsNumberNormalized,
            description: toNode.description,
          },
        });
        continue;
      }

      // Check description change
      if (fromNode.description !== toNode.description) {
        changeRows.push({
          fromReleaseId,
          toReleaseId,
          oldHtsNodeId: fromNode.id,
          newHtsNodeId: toNode.id,
          changeType: "DESCRIPTION_CHANGED",
          changedFields: {
            htsNumber: toNode.htsNumberNormalized,
            oldDescription: fromNode.description,
            newDescription: toNode.description,
          },
        });
      }

      // Check rate change
      const fromGeneral = fromNode.dutyRates.find((r) => r.rateColumn === "General");
      const toGeneral = toNode.dutyRates.find((r) => r.rateColumn === "General");

      const oldRateText = fromGeneral?.rawRateText || "Free";
      const newRateText = toGeneral?.rawRateText || "Free";

      if (oldRateText !== newRateText) {
        changeRows.push({
          fromReleaseId,
          toReleaseId,
          oldHtsNodeId: fromNode.id,
          newHtsNodeId: toNode.id,
          changeType: "RATE_CHANGED",
          changedFields: {
            htsNumber: toNode.htsNumberNormalized,
            htsCode: toNode.htsNumberNormalized,
            oldRate: oldRateText,
            newRate: newRateText,
          },
        });
      }
    }

    if (changeRows.length > 0) {
      const BATCH_SIZE = 1000;
      for (let i = 0; i < changeRows.length; i += BATCH_SIZE) {
        await db.htsChange.createMany({ data: changeRows.slice(i, i + BATCH_SIZE) });
      }
    }

    return changeRows.length;
  }

  /**
   * Atomically publishes a staged DRAFT release.
   */
  static async publishRelease(releaseId: string) {
    const candidate = await db.htsRelease.findUnique({
      where: { id: releaseId },
    });

    if (!candidate) {
      throw new DomainError(`Release '${releaseId}' not found.`, "RELEASE_NOT_FOUND", 404);
    }

    if (candidate.publicationStatus === "PUBLISHED") {
      return candidate; // Already active
    }

    // Find currently active release
    const currentActive = await db.htsRelease.findFirst({
      where: { publicationStatus: "PUBLISHED" },
    });

    if (currentActive) {
      await this.generateDiff(currentActive.id, releaseId).catch((err) =>
        console.error("[HtsIngestionService] Auto-diff on publishRelease failed:", err)
      );
    }

    // Transactionally update statuses
    return db.$transaction(async (tx) => {
      if (currentActive) {
        await tx.htsRelease.update({
          where: { id: currentActive.id },
          data: { publicationStatus: "SUPERSEDED" },
        });
      }

      return tx.htsRelease.update({
        where: { id: releaseId },
        data: {
          publicationStatus: "PUBLISHED",
          publishedAt: new Date(),
          supersedesReleaseId: currentActive ? currentActive.id : null,
        },
      });
    });
  }

  /**
   * Rollback a published release and re-activate the superseded release.
   */
  static async rollbackRelease(releaseId: string) {
    const release = await db.htsRelease.findUnique({
      where: { id: releaseId },
    });

    if (!release) {
      throw new DomainError(`Release '${releaseId}' not found.`, "RELEASE_NOT_FOUND", 404);
    }

    return db.$transaction(async (tx) => {
      await tx.htsRelease.update({
        where: { id: releaseId },
        data: { publicationStatus: "ROLLED_BACK" },
      });

      if (release.supersedesReleaseId) {
        await tx.htsRelease.update({
          where: { id: release.supersedesReleaseId },
          data: { publicationStatus: "PUBLISHED" },
        });
      }

      return { status: "ROLLED_BACK", releaseId };
    });
  }
}
