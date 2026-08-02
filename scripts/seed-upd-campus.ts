/**
 * Seed UP Diliman campus data into an empty database:
 *
 *   1. buildings: named buildings from OSM (data/upd-buildings-osm.json,
 *      an Overpass `out center tags` export for the UPD campus area)
 *   2. rooms: distinct venue strings from the CRS class exports
 *      (data/crs-classes-*.json), linked to buildings by venue prefix
 *   3. update: one sync-key row per content table (migrations seed these
 *      upstream; `drizzle-kit push` does not)
 *
 * Idempotent: existing building names and room codes are skipped.
 *
 *   DATABASE_URL=… bun run scripts/seed-upd-campus.ts
 */

import { config } from "dotenv";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { buildingsTable, roomsTable, updateTable } from "@drizzle/schema";
import { normalizeCrsClass } from "@lib/crs/normalize-class";
import type { CrsRawClass } from "@lib/crs/parse-schedule-page";

config({ path: ".env" });

/** Venue prefix (first token, upper-cased) to OSM building name. */
// ponytail: hand map for the highest-traffic prefixes only; everything else
// imports unlinked and gets fixed through the in-app editor or aliases.
const PREFIX_TO_BUILDING: Record<string, string> = {
  PH: "Palma Hall",
  PAV1: "Palma Hall Pavilion 1",
  PAV2: "Palma Hall Pavilion 2",
  PAV3: "Palma Hall Pavilion 3",
  PAV4: "Palma Hall Pavilion 4",
  ANX: "Silangang Palma", // Palma Hall Annex
  NIP: "National Institute of Physics",
  EEEI: "Electrical and Electronics Engineering Institute",
  CAL: "College of Arts and Letters",
  ICE: "Institute of Civil Engineering",
  IC: "Institute of Chemistry Teaching Building",
  LAW: "Malcolm Hall",
  MH: "University of the Philippines Diliman - College of Engineering (Melchor Hall)",
  IE: "Industrial Engineering and Operations Research - Mechanical Engineering Building",
  IB: "Institute of Biology",
  AECH: "UP Alumni Engineers Centennial Hall",
  MB: "Institute of Mathematics",
  MBAN: "Math Building Annex",
  NIGS: "National Institute of Geological Sciences",
  LH: "Alfredo Lagmay Hall",
  ALON: "Alonso Hall",
  CHE: "Alonso Hall",
  NIMBB: "National Institute of Molecular Biology and Biotechnology",
  MMM: "Department of Mining, Metallurgical, and Materials Engineering",
  MSI: "Marine Science Institute",
  STAT: "School of Statistics",
  // Deep-research verified 2026-08-02: SOLAIR is in Bonifacio Hall (its own
  // site + the official campus map legend); Bocobo Hall is the UP Law Center.
  SOLAIR: "Bonifacio Hall",
  CDC: "UP Child Development Center", // Child Development Center, CHE
  CHK: "UP Gymnasium (CHK Building)", // Ylanan Hall
  // AIT = Asian Institute of Tourism, Commonwealth Ave; no OSM footprint in
  // the campus export yet, so AIT rooms stay unlinked until one is added.
  SURP: "School of Urban and Regional Planning (SURP)",
  NCPAG: "National College of Public Administration and Governance",
  EDUC: "Benitez Hall",
  VH: "Vinzons Hall",
};

type OverpassExport = {
  elements: Array<{
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
  }>;
};

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool);

  try {
    // 1. Buildings from OSM.
    const osm = JSON.parse(
      readFileSync("data/upd-buildings-osm.json", "utf8"),
    ) as OverpassExport;
    const byName = new Map<string, { lat: number; lon: number }>();
    for (const el of osm.elements) {
      const name = el.tags?.name?.trim();
      if (!name || !el.center || byName.has(name)) continue;
      byName.set(name, el.center);
    }

    const existing = new Set(
      (
        await db
          .select({ name: buildingsTable.buildingName })
          .from(buildingsTable)
      ).map((b) => b.name),
    );
    const buildingInserts = [...byName.entries()]
      .filter(([name]) => !existing.has(name.slice(0, 100)))
      .map(([name, center]) => ({
        buildingName: name.slice(0, 100),
        lat: center.lat,
        lon: center.lon,
        directions: "",
      }));
    for (let i = 0; i < buildingInserts.length; i += 500) {
      await db.insert(buildingsTable).values(buildingInserts.slice(i, i + 500));
    }
    console.log(
      `Buildings: +${buildingInserts.length} (${existing.size} already present)`,
    );

    const buildingIdByName = new Map(
      (
        await db
          .select({
            id: buildingsTable.id,
            name: buildingsTable.buildingName,
          })
          .from(buildingsTable)
      ).map((b) => [b.name, b.id]),
    );

    // 2. Rooms from CRS venue strings.
    const venues = new Set<string>();
    for (const file of readdirSync("data")) {
      const match = file.match(/^crs-classes-(\d+)\.json$/);
      if (!match) continue;
      const payload = JSON.parse(readFileSync(`data/${file}`, "utf8")) as {
        classes: CrsRawClass[];
      };
      for (const raw of payload.classes) {
        for (const row of normalizeCrsClass(raw, Number(match[1]))) {
          if (row.facilityCode) venues.add(row.facilityCode.trim());
        }
      }
    }

    const existingRooms = new Set(
      (await db.select({ code: roomsTable.roomCode }).from(roomsTable)).map(
        (r) => r.code,
      ),
    );
    let linked = 0;
    const roomInserts = [...venues]
      .filter((venue) => !existingRooms.has(venue))
      .map((venue) => {
        const prefix = venue.split(/[\s-]/)[0].toUpperCase();
        const buildingName = PREFIX_TO_BUILDING[prefix];
        const buildingId = buildingName
          ? (buildingIdByName.get(buildingName) ?? null)
          : null;
        if (buildingId != null) linked += 1;
        return { roomCode: venue, buildingId };
      });
    for (let i = 0; i < roomInserts.length; i += 500) {
      await db.insert(roomsTable).values(roomInserts.slice(i, i + 500));
    }
    console.log(
      `Rooms: +${roomInserts.length} (${linked} linked to a building, ` +
        `${existingRooms.size} already present)`,
    );

    // 3. Sync-key rows.
    const syncTables = [
      "classes",
      "rooms",
      "buildings",
      "terms",
      "aliases",
      "colleges",
      "divisions",
      "dorms",
      "organizations",
      "places",
      "events",
      "jeepney_routes",
      "jeepney_stops",
      "final_exams",
      "announcements",
    ];
    await db
      .insert(updateTable)
      .values(syncTables.map((tableName) => ({ tableName })))
      .onConflictDoNothing();
    console.log(`Sync keys ensured for ${syncTables.length} tables.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
