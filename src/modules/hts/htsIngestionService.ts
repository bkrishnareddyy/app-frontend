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

    const release = await db.htsRelease.create({
      data: {
        editionYear: input.editionYear,
        revisionNumber: input.revisionNumber,
        releaseName: input.releaseName,
        effectiveFrom,
        sourceUrl: input.sourceUrl,
        sourceFormat: input.sourceFormat,
        sha256,
        validationStatus: "VALIDATED",
        publicationStatus: "DRAFT",
      },
    });

    // Build every row in memory first, with pre-generated IDs, so all of
    // it can go in via batched createMany() instead of one row at a time.
    // The original one-create-per-row loop took 60+ seconds for a single
    // 2-chapter (382 item) test batch -- the full ~20k+ item US schedule
    // would have taken well over an hour, making this unusable for a
    // scheduled job with any realistic timeout.
    const nodeRows: Prisma.HtsNodeCreateManyInput[] = [];
    const dutyRateRows: Prisma.HtsDutyRateCreateManyInput[] = [];
    const unitRows: Prisma.HtsUnitCreateManyInput[] = [];

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

      const nodeId = crypto.randomUUID();
      nodeRows.push({
        id: nodeId,
        releaseId: release.id,
        sourceRowNumber: rowNumber++,
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

      // A column the source left blank gets no row at all, so readers see
      // "no rate recorded" rather than a fabricated Free rate.
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

    const BATCH_SIZE = 1000;
    for (let i = 0; i < nodeRows.length; i += BATCH_SIZE) {
      await db.htsNode.createMany({ data: nodeRows.slice(i, i + BATCH_SIZE) });
    }
    for (let i = 0; i < dutyRateRows.length; i += BATCH_SIZE) {
      await db.htsDutyRate.createMany({ data: dutyRateRows.slice(i, i + BATCH_SIZE) });
    }
    for (let i = 0; i < unitRows.length; i += BATCH_SIZE) {
      await db.htsUnit.createMany({ data: unitRows.slice(i, i + BATCH_SIZE) });
    }

    return release;
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
