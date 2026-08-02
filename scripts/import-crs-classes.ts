/**
 * Import UP Diliman class schedules from the public CRS schedule browser.
 *
 * Workflow (fetch once, reuse the local cache):
 *   bun run import:crs-classes -- --term-id 120261 --fetch
 *   DATABASE_URL=… bun run import:crs-classes -- --term-id 120261
 *
 * Flags:
 *   --term-id id       CRS term id, e.g. 120261 = 1st sem AY 2026-2027
 *   --fetch            Fetch from crs.upd.edu.ph, save JSON, then import
 *   --from-json path   Import from saved JSON only (no CRS call)
 *   --dry-run          Parse + map only; no DB writes
 *   --replace-term     Remove term rows not present in the new export
 *
 * CRS term ids are 12<year><sem>: 120261 = AY 2026-2027 first semester,
 * 120252 = AY 2025-2026 second semester, 120254 = Midyear 2026.
 * The terms row is created on first import. Instructor names never enter
 * the export: the page parser drops them.
 */

import { config } from "dotenv";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  aliasesTable,
  classesTable,
  roomsTable,
  termsTable,
  updateTable,
} from "@drizzle/schema";
import {
  buildRoomLookup,
  classNaturalKey,
  formatImportReport,
  resolveImportRows,
  summarizeImportChanges,
} from "@lib/amis/import-classes";
import { fetchCrsClasses } from "@lib/crs/fetch-classes";
import { normalizeCrsClass } from "@lib/crs/normalize-class";
import type { CrsRawClass } from "@lib/crs/parse-schedule-page";

config({ path: ".env" });

type CliOptions = {
  termId: number;
  dryRun: boolean;
  replaceTerm: boolean;
  fetch: boolean;
  fromJson: string | null;
};

function parseArgs(argv: string[]): CliOptions {
  let termId = 0;
  let dryRun = false;
  let replaceTerm = false;
  let fetch = false;
  let fromJson: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--term-id") termId = Number(argv[++i]);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--replace-term") replaceTerm = true;
    else if (arg === "--fetch") fetch = true;
    else if (arg === "--from-json") fromJson = argv[++i] ?? null;
  }

  if (!Number.isFinite(termId) || termId <= 0) {
    throw new Error("--term-id is required (e.g. --term-id 120261)");
  }
  return { termId, dryRun, replaceTerm, fetch, fromJson };
}

/**
 * "120261" is 12 + a 3-digit year offset from 2000 + a semester digit:
 * 120261 = AY 2026-2027, first semester. Semester 4 is the midyear term.
 */
export function describeCrsTerm(termId: number) {
  const digits = String(termId);
  const year = 2000 + Number(digits.slice(2, 5));
  const sem = digits.slice(5);
  const ay = `${year}-${year + 1}`;
  if (sem === "1") {
    return {
      label: `First Semester AY ${ay}`,
      schoolYear: ay,
      semester: "1",
    };
  }
  if (sem === "2") {
    return {
      label: `Second Semester AY ${ay}`,
      schoolYear: ay,
      semester: "2",
    };
  }
  return {
    label: `Midyear Term ${year + 1}`,
    schoolYear: ay,
    semester: "midyear",
  };
}

function exportPath(termId: number) {
  return `data/crs-classes-${termId}.json`;
}

async function resolveRawRows(options: CliOptions): Promise<CrsRawClass[]> {
  const path = options.fromJson ?? exportPath(options.termId);

  if (options.fetch) {
    console.log(`Fetching CRS classes for term_id=${options.termId}…`);
    const rows = await fetchCrsClasses({
      termId: options.termId,
      onProgress: (prefix, total) =>
        console.log(`  prefix "${prefix}": ${total} classes so far`),
    });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ term_id: options.termId, classes: rows }, null, 2),
    );
    console.log(`Saved ${rows.length} classes to ${path}.`);
    return rows;
  }

  if (!existsSync(path)) {
    throw new Error(
      `No local export at ${path}. Run once with --fetch to download from CRS.`,
    );
  }
  const payload = JSON.parse(readFileSync(path, "utf8")) as {
    term_id?: number;
    classes?: CrsRawClass[];
  };
  if (payload.term_id != null && payload.term_id !== options.termId) {
    throw new Error(
      `Export ${path} is for term_id=${payload.term_id}, not ${options.termId}.`,
    );
  }
  const rows = payload.classes ?? [];
  if (rows.length === 0) throw new Error(`${path} has no class rows.`);
  console.log(`Loaded ${rows.length} classes from ${path}.`);
  return rows;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.fetch && process.env.CI === "true") {
    console.error("Refusing CRS --fetch in CI. Use cached JSON.");
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString && !options.dryRun) {
    console.error("DATABASE_URL is required unless --dry-run");
    process.exit(1);
  }

  const rawRows = await resolveRawRows(options);
  const normalized = rawRows.flatMap((row) =>
    normalizeCrsClass(row, options.termId),
  );
  if (normalized.length === 0) {
    console.error("No rows could be normalized, inspect the export.");
    process.exit(1);
  }

  if (options.dryRun) {
    console.log(`Dry run: ${normalized.length} normalized rows.`);
    console.log("Sample:", normalized[0]);
    return;
  }

  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool);

  try {
    const term = describeCrsTerm(options.termId);
    await db
      .insert(termsTable)
      .values({
        id: options.termId,
        label: term.label,
        schoolYear: term.schoolYear,
        semester: term.semester,
        sortOrder: options.termId,
      })
      .onConflictDoNothing();

    const [rooms, roomAliases, existingClasses] = await Promise.all([
      db
        .select({ id: roomsTable.id, code: roomsTable.roomCode })
        .from(roomsTable),
      db
        .select({ alias: aliasesTable.alias, targetId: aliasesTable.targetId })
        .from(aliasesTable)
        .where(eq(aliasesTable.targetType, "room")),
      db
        .select({
          id: classesTable.id,
          courseCode: classesTable.courseCode,
          section: classesTable.section,
          type: classesTable.type,
          courseTitle: classesTable.courseTitle,
          schedule: classesTable.schedule,
          roomId: classesTable.roomId,
          termId: classesTable.termId,
        })
        .from(classesTable)
        .where(eq(classesTable.termId, options.termId)),
    ]);

    const roomLookup = buildRoomLookup(rooms, roomAliases);
    const {
      rows: incomingRows,
      stats,
      unmatched,
    } = resolveImportRows(normalized, roomLookup);

    const existingByKey = new Map<string, (typeof existingClasses)[number]>();
    for (const row of existingClasses) {
      if (row.termId == null) continue;
      existingByKey.set(
        classNaturalKey({
          termId: row.termId,
          courseCode: row.courseCode ?? "",
          section: row.section,
          type: row.type,
        }),
        row,
      );
    }

    const { summary, inserts, updates, removeIds } = summarizeImportChanges({
      replaceTerm: options.replaceTerm,
      existingKeys: new Set(existingByKey.keys()),
      existingByKey,
      incomingRows,
    });

    await db.transaction(async (tx) => {
      for (const id of removeIds) {
        await tx.delete(classesTable).where(eq(classesTable.id, id));
      }
      for (const { id, row } of updates) {
        await tx.update(classesTable).set(row).where(eq(classesTable.id, id));
      }
      const batchSize = 500;
      for (let i = 0; i < inserts.length; i += batchSize) {
        await tx.insert(classesTable).values(inserts.slice(i, i + batchSize));
      }
      await tx
        .update(updateTable)
        .set({ syncKey: randomUUID() })
        .where(eq(updateTable.tableName, "classes"));
      await tx
        .update(termsTable)
        .set({ classesImportedAt: new Date().toISOString() })
        .where(eq(termsTable.id, options.termId));
    });

    console.log(
      formatImportReport({
        termId: options.termId,
        rawCount: rawRows.length,
        normalizedCount: normalized.length,
        stats,
        summary,
        unmatched,
      }),
    );
  } finally {
    await pool.end();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
