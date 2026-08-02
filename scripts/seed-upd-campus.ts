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
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  buildingsTable,
  collegesTable,
  dormsTable,
  eventLocationsTable,
  eventsTable,
  jeepneyRoutesTable,
  jeepneyStopsTable,
  organizationsTable,
  placesTable,
  roomsTable,
  updateTable,
} from "@drizzle/schema";
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
  // Pass-2 research 2026-08-02, each verified against live CRS venues:
  AH: "Abelardo Hall", // College of Music (AH GAMELAN, AH MINIHALL, AH 2xx)
  SE: "UP School of Economics", // Encarnacion Hall, Guerrero cor. Osmena
  BA: "Cesar E.A. Virata School of Business", // BA 104-311
  // Known ambiguity: Music sections also use "ANX" for the Music Annex, but
  // most ANX venues are Palma Hall Annex rooms; ANX stays on Silangang Palma
  // until rooms are split per enlisting unit.
  // AIT = Asian Institute of Tourism, Commonwealth Ave; no OSM footprint in
  // the campus export yet, so AIT rooms stay unlinked until one is added.
  SURP: "School of Urban and Regional Planning (SURP)",
  NCPAG: "National College of Public Administration and Governance",
  EDUC: "Benitez Hall",
  VH: "Vinzons Hall",
  // Cross-tab decodes 2026-08-02: venue prefix vs CRS enlisting unit over
  // both term exports (see room-tba-upd fork notes). Unit tells the college,
  // the college's known building gives the pin.
  SS: "School of Statistics", // Stat courses, 203 of 210 venues
  B1: "College of Architecture Building 1", // Arch courses only
  B2: "College of Architecture Building 2", // Arch courses only
  MCB: "Broadcast Media Center Building", // Broadcast Communication
  AVR: "Palma Hall", // PolSci audio-visual room
  SOCIO: "Palma Hall", // Sociology dept rooms
  UG: "Palma Hall", // Palma Hall lower-ground rooms
  ENRIQUEZ: "Plaridel Hall", // Journalism; pass-3 may move to Media Center
  CLASSROOM: "Albert Hall", // School of Archaeology "Classroom A/B"
  GUSALI: "Alonso Hall", // CHE depts (DFSN/HRIM/HEED); exact wing pending
  IDS: "Alonso Hall", // CTID interior-design studios
  FNL: "Alonso Hall", // DFSN food and nutrition labs
  CIDL: "Alonso Hall", // CTID
  RM: "Plaridel Hall", // "Rm ###" venues, Journalism
  CONFERENCE: "Palma Hall", // PolSci/Philo "Conference Room"
  SEMINAR: "Palma Hall", // Philo "Seminar Room"
  // Pass-3 verified 2026-08-02:
  TMC: "Advanced Science and Technology Institute", // TMC operates from DOST-ASTI
};

/** Resolve a CRS venue string to a building id via its prefix. */
function resolveVenueBuildingId(
  venue: string,
  buildingIdByName: Map<string, number>,
): number | null {
  // "Pav 2 ..." and "PAV2 ..." both mean Palma Hall Pavilion 2.
  const pav = venue.match(/^PAV\s*(\d)/i);
  // "A101"-"A403" (no space) are Section A of the DChE Building
  // (dche.coe.upd.edu.ph; Collegian 2025-06-01 describes sections A-D).
  if (!pav && /^A\d{3}/.test(venue)) {
    return (
      buildingIdByName.get("Department of Chemical Engineering Building") ??
      null
    );
  }
  const prefix = pav ? `PAV${pav[1]}` : venue.split(/[\s-]/)[0].toUpperCase();
  const buildingName = PREFIX_TO_BUILDING[prefix];
  if (!buildingName) return null;
  return buildingIdByName.get(buildingName) ?? null;
}

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
    // Residence halls become dorm pins (section 1b), not building pins;
    // UP Bliss housing blocks are map noise and are skipped entirely.
    const DORMISH = /Residence Hall|Dormitor/i;
    const SKIP_BUILDING = /Bliss/i;
    const byName = new Map<string, { lat: number; lon: number }>();
    const dormByName = new Map<string, { lat: number; lon: number }>();
    for (const el of osm.elements) {
      const name = el.tags?.name?.trim();
      if (!name || !el.center) continue;
      if (SKIP_BUILDING.test(name)) continue;
      if (DORMISH.test(name)) {
        // "Acacia Residence Hall Building 2" collapses into one Acacia pin.
        const base = name.split(/ Admin Building| Building \d/)[0].trim();
        if (!dormByName.has(base)) dormByName.set(base, el.center);
        continue;
      }
      if (!byName.has(name)) byName.set(name, el.center);
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

    // 1b. Dorms from the residence-hall footprints, plus cleanup of dorm and
    // Bliss rows that earlier seed versions inserted as buildings.
    await db.execute(sql`
      DELETE FROM buildings b
      WHERE (b.building_name ~* 'Residence Hall|Dormitor|Bliss')
        AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.building_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.building_id = b.id)
        AND NOT EXISTS (SELECT 1 FROM event_locations el WHERE el.building_id = b.id)
    `);
    const existingDorms = new Set(
      (await db.select({ name: dormsTable.dormName }).from(dormsTable)).map(
        (d) => d.name,
      ),
    );
    const dormInserts = [...dormByName.entries()]
      .filter(([name]) => !existingDorms.has(name))
      .map(([name, center]) => ({
        dormName: name,
        lat: center.lat,
        lon: center.lon,
        gender: "unspecified",
        isUpManaged: true,
      }));
    if (dormInserts.length > 0) {
      await db.insert(dormsTable).values(dormInserts);
    }
    console.log(`Dorms: +${dormInserts.length}`);

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
        const buildingId = resolveVenueBuildingId(venue, buildingIdByName);
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

    // 2b. Self-heal: as the gazetteer grows, link rooms that imported
    // before their prefix was decoded.
    const unlinkedRooms = await db
      .select({ id: roomsTable.id, code: roomsTable.roomCode })
      .from(roomsTable)
      .where(isNull(roomsTable.buildingId));
    let relinked = 0;
    for (const room of unlinkedRooms) {
      const buildingId = resolveVenueBuildingId(room.code, buildingIdByName);
      if (buildingId == null) continue;
      await db
        .update(roomsTable)
        .set({ buildingId })
        .where(eq(roomsTable.id, room.id));
      relinked += 1;
    }
    console.log(`Rooms relinked after gazetteer growth: +${relinked}`);

    // 3. Colleges (UPD degree-granting units; roster cross-checked against
    // upd.edu.ph and unit sites, 2026-08). Websites only where verified.
    const COLLEGES: Array<[name: string, website: string | null]> = [
      ["Asian Center", null],
      ["Asian Institute of Tourism", "https://ait.upd.edu.ph"],
      ["Cesar E.A. Virata School of Business", null],
      ["College of Architecture", null],
      ["College of Arts and Letters", null],
      ["College of Education", null],
      ["College of Engineering", null],
      ["College of Fine Arts", null],
      ["College of Home Economics", "https://che.upd.edu.ph"],
      ["College of Human Kinetics", null],
      ["College of Law", "https://law.upd.edu.ph"],
      ["College of Media and Communication", null],
      ["College of Music", null],
      ["College of Science", null],
      ["College of Social Sciences and Philosophy", null],
      ["College of Social Work and Community Development", null],
      ["National College of Public Administration and Governance", null],
      ["School of Archaeology", null],
      ["School of Economics", null],
      ["School of Labor and Industrial Relations", "https://solair.upd.edu.ph"],
      ["School of Library and Information Studies", null],
      ["School of Statistics", null],
      ["School of Urban and Regional Planning", null],
      ["Institute of Islamic Studies", null],
      ["Technology Management Center", null],
    ];
    const existingColleges = new Set(
      (
        await db.select({ name: collegesTable.collegeName }).from(collegesTable)
      ).map((c) => c.name),
    );
    const collegeInserts = COLLEGES.filter(
      ([name]) => !existingColleges.has(name),
    ).map(([name, website]) => ({ collegeName: name, websiteLink: website }));
    if (collegeInserts.length > 0) {
      await db.insert(collegesTable).values(collegeInserts);
    }
    const collegeIdByName = new Map(
      (
        await db
          .select({ id: collegesTable.id, name: collegesTable.collegeName })
          .from(collegesTable)
      ).map((c) => [c.name, c.id]),
    );
    console.log(`Colleges: +${collegeInserts.length}`);

    // 4. Link rooms to colleges through their building's occupant.
    const BUILDING_TO_COLLEGE: Record<string, string> = {
      "Palma Hall": "College of Social Sciences and Philosophy",
      "Silangang Palma": "College of Social Sciences and Philosophy",
      "Alfredo Lagmay Hall": "College of Social Sciences and Philosophy",
      "University of the Philippines Diliman - College of Engineering (Melchor Hall)":
        "College of Engineering",
      "UP Alumni Engineers Centennial Hall": "College of Engineering",
      "Electrical and Electronics Engineering Institute":
        "College of Engineering",
      "Electrical and Electronics Engineering Institute Building 2":
        "College of Engineering",
      "Institute of Civil Engineering": "College of Engineering",
      "Department of Mining, Metallurgical, and Materials Engineering":
        "College of Engineering",
      "Industrial Engineering and Operations Research - Mechanical Engineering Building":
        "College of Engineering",
      "Department of Chemical Engineering Building": "College of Engineering",
      "Energy and Environmental Engineering Building": "College of Engineering",
      "National Institute of Physics": "College of Science",
      "Institute of Biology": "College of Science",
      "Institute of Chemistry Teaching Building": "College of Science",
      "Institute of Chemistry Research Wing": "College of Science",
      "Institute of Mathematics": "College of Science",
      "Math Building Annex": "College of Science",
      "National Institute of Geological Sciences": "College of Science",
      "National Institute of Molecular Biology and Biotechnology":
        "College of Science",
      "Marine Science Institute": "College of Science",
      "Institute of Environmental Science and Meteorology":
        "College of Science",
      "College of Arts and Letters": "College of Arts and Letters",
      "Malcolm Hall": "College of Law",
      "Bocobo Hall": "College of Law",
      "Espiritu Hall": "College of Law",
      "Bonifacio Hall": "School of Labor and Industrial Relations",
      "Benitez Hall": "College of Education",
      "Alonso Hall": "College of Home Economics",
      "Alonso Hall Annex": "College of Home Economics",
      "UP Child Development Center": "College of Home Economics",
      "Plaridel Hall": "College of Media and Communication",
      "Abelardo Hall": "College of Music",
      "Abelardo Hall Annex": "College of Music",
      "College of Fine Arts": "College of Fine Arts",
      "College of Architecture Building 1": "College of Architecture",
      "College of Architecture Building 2": "College of Architecture",
      "School of Statistics": "School of Statistics",
      "School of Urban and Regional Planning (SURP)":
        "School of Urban and Regional Planning",
      "National College of Public Administration and Governance":
        "National College of Public Administration and Governance",
      "College of Social Work and Community Development":
        "College of Social Work and Community Development",
      "GT-Toyota Asian Center": "Asian Center",
      "UP Gymnasium (CHK Building)": "College of Human Kinetics",
      "UP New CHK Gymnasium": "College of Human Kinetics",
      "Abelardo Hall": "College of Music",
      "UP School of Economics": "School of Economics",
      "Cesar E.A. Virata School of Business":
        "Cesar E.A. Virata School of Business",
    };
    let roomsLinkedToCollege = 0;
    for (const [buildingName, collegeName] of Object.entries(
      BUILDING_TO_COLLEGE,
    )) {
      const buildingId = buildingIdByName.get(buildingName);
      const collegeId = collegeIdByName.get(collegeName);
      if (buildingId == null || collegeId == null) continue;
      const updated = await db
        .update(roomsTable)
        .set({ collegeId })
        .where(
          and(
            eq(roomsTable.buildingId, buildingId),
            isNull(roomsTable.collegeId),
          ),
        )
        .returning({ id: roomsTable.id });
      roomsLinkedToCollege += updated.length;
    }
    console.log(`Rooms linked to a college: +${roomsLinkedToCollege}`);

    // 5. Administrative buildings.
    for (const name of ["Quezon Hall", "Gonzalez Hall", "Vinzons Hall"]) {
      const id = buildingIdByName.get(name);
      if (id != null) {
        await db
          .update(buildingsTable)
          .set({ buildingType: "admin" })
          .where(eq(buildingsTable.id, id));
      }
    }

    // 6. Places (food, services, landmarks) from the OSM amenity export.
    const CATEGORY_BY_TAG: Record<string, string> = {
      restaurant: "food",
      cafe: "food",
      fast_food: "food",
      food_court: "food",
      ice_cream: "food",
      bar: "food",
      bank: "service",
      atm: "service",
      post_office: "service",
      pharmacy: "service",
      clinic: "service",
      hospital: "service",
      police: "service",
      marketplace: "service",
      place_of_worship: "landmark",
      memorial: "landmark",
      monument: "landmark",
      park: "landmark",
      garden: "landmark",
      sports_centre: "landmark",
      swimming_pool: "landmark",
      artwork: "tourist-spot",
      attraction: "tourist-spot",
      museum: "tourist-spot",
      viewpoint: "tourist-spot",
    };
    const amenities = JSON.parse(
      readFileSync("data/upd-amenities-osm.json", "utf8"),
    ) as OverpassExport;
    const existingPlaces = new Set(
      (
        await db
          .select({ name: placesTable.name, lat: placesTable.lat })
          .from(placesTable)
      ).map((p) => `${p.name}|${p.lat?.toFixed(3)}`),
    );
    const seenPlaces = new Set<string>();
    const placeInserts = [];
    for (const el of amenities.elements) {
      const tags = el.tags ?? {};
      const name = tags.name?.trim();
      const center =
        el.center ??
        ((el as { lat?: number; lon?: number }).lat != null
          ? {
              lat: (el as { lat: number }).lat,
              lon: (el as { lon: number }).lon,
            }
          : undefined);
      if (!name || !center) continue;
      const tag =
        tags.amenity ?? tags.tourism ?? tags.historic ?? tags.leisure ?? "";
      const category = CATEGORY_BY_TAG[tag];
      if (!category) continue;
      const key = `${name}|${center.lat.toFixed(3)}`;
      if (seenPlaces.has(key) || existingPlaces.has(key)) continue;
      seenPlaces.add(key);
      placeInserts.push({
        name,
        category,
        lat: center.lat,
        lon: center.lon,
        hours: tags.opening_hours ?? null,
      });
    }
    for (let i = 0; i < placeInserts.length; i += 500) {
      await db.insert(placesTable).values(placeInserts.slice(i, i + 500));
    }
    console.log(`Places: +${placeInserts.length} from OSM amenities`);

    // 6b. Curated notes on OSM places (pass-2 research, 2026-08-02).
    const PLACE_NOTES: Record<string, string> = {
      "Mang Larry's":
        "Closed February 2026: the E. Jacinto St stall was vacated on a court-ordered eviction. The isawan reopened off-campus at 28 Road 20, Project 8, QC; Magiting St branch still open.",
      "Church of the Holy Sacrifice":
        "Officially the Parish of the Holy Sacrifice (Diocese of Cubao); the round chapel is a National Historical Landmark.",
    };
    for (const [name, description] of Object.entries(PLACE_NOTES)) {
      await db
        .update(placesTable)
        .set({ description })
        .where(eq(placesTable.name, name));
    }

    // 7. Verified recurring events (dates from the OUR AY 2026-2027 calendar;
    // times are typical windows, not official).
    const EVENTS = [
      {
        slug: "lantern-parade-2026",
        title: "UP Lantern Parade 2026",
        description:
          "Year-end parade of lanterns around the Academic Oval. Date from the official academic calendar; the program schedule is announced closer to the day.",
        category: "tradition" as const,
        startsAt: "2026-12-18 15:00:00",
        endsAt: "2026-12-18 21:00:00",
        recurrence: "annual" as const,
        sourceUrl:
          "https://our.upd.edu.ph/files/calendar/regular/ACAD%20CAL%202026-2027.pdf",
        location: {
          label: "Academic Oval",
          lat: 14.6549,
          lon: 121.0672,
        },
      },
      {
        slug: "upcat-2026",
        title: "UPCAT 2026",
        description:
          "UP College Admission Test weekend. Expect road closures, rerouted jeepneys, and heavy foot traffic from test takers and parents.",
        category: "other" as const,
        startsAt: "2026-08-01 06:00:00",
        endsAt: "2026-08-02 18:00:00",
        recurrence: "annual" as const,
        sourceUrl: "https://upd.edu.ph/academics/academic-calendar-2/",
        location: {
          label: "Campus-wide testing centers",
          lat: 14.6538,
          lon: 121.06534,
        },
      },
      {
        slug: "commencement-2027",
        title: "University Commencement Exercises 2027",
        description:
          "General commencement for AY 2026-2027 graduates, per the official academic calendar.",
        category: "ceremony" as const,
        startsAt: "2027-07-04 07:00:00",
        endsAt: "2027-07-04 12:00:00",
        recurrence: "annual" as const,
        sourceUrl:
          "https://our.upd.edu.ph/files/calendar/regular/ACAD%20CAL%202026-2027.pdf",
        location: {
          label: "University Amphitheater, behind Quezon Hall",
          lat: 14.6555,
          lon: 121.0648,
        },
      },
    ];
    const existingEventSlugs = new Set(
      (await db.select({ slug: eventsTable.slug }).from(eventsTable)).map(
        (e) => e.slug,
      ),
    );
    let eventsInserted = 0;
    for (const event of EVENTS) {
      if (existingEventSlugs.has(event.slug)) continue;
      const [row] = await db
        .insert(eventsTable)
        .values({
          slug: event.slug,
          title: event.title,
          description: event.description,
          category: event.category,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          recurrence: event.recurrence,
          sourceUrl: event.sourceUrl,
        })
        .returning({ id: eventsTable.id });
      await db.insert(eventLocationsTable).values({
        eventId: row.id,
        anchorType: "custom",
        label: event.location.label,
        lat: event.location.lat,
        lon: event.location.lon,
        isPrimary: true,
      });
      eventsInserted += 1;
    }
    console.log(`Events: +${eventsInserted}`);

    // 7b. Units and offices as organization pins (pass-3 research,
    // 2026-08-02; each placement cited from the unit's own page).
    const OFFICES: Array<{
      name: string;
      category: string;
      building: string;
      description: string;
      websiteLink: string | null;
    }> = [
      {
        name: "Office of the University Registrar",
        category: "office",
        building: "Office of the University Registrar",
        description:
          "Standalone OUR Building, T.M. Kalaw St. corner Quirino Ave. Student ID Room on the 2nd floor, CRS helpdesk (AIS Section) on the 3rd.",
        websiteLink: "https://our.upd.edu.ph",
      },
      {
        name: "UP ID Room",
        category: "service",
        building: "Office of the University Registrar",
        description: "2nd floor, OUR Building. Student RFID ID processing.",
        websiteLink: "https://our.upd.edu.ph",
      },
      {
        name: "CRS Helpdesk (AIS Section)",
        category: "service",
        building: "Office of the University Registrar",
        description:
          "3rd floor, OUR Building. Computerized Registration System support, support@crs.upd.edu.ph.",
        websiteLink: "https://crs.upd.edu.ph",
      },
      {
        name: "Interactive Learning Center Diliman",
        category: "unit",
        building: "Diliman Interactive Learning Center",
        description:
          "Formerly DILC. Room 201, DILC Building, Apacible St. corner Magsaysay Ave.",
        websiteLink: "https://ilc.upd.edu.ph",
      },
      {
        name: "Office of Scholarships and Grants",
        category: "office",
        building: "Vinzons Hall",
        description:
          "Room 301, 3rd floor, Vinzons Hall. Renamed from the Office of Scholarships and Student Services in 2018.",
        websiteLink: "https://ovcsa.upd.edu.ph/student-services/osg/",
      },
      {
        name: "University Food Service",
        category: "service",
        building: "Student Union Building",
        description:
          "Cafeteria on the 2nd floor of the Student Union Building, admin on the 3rd; bakeshop at Kalayaan Residence Hall.",
        websiteLink: "https://ovcsa.upd.edu.ph/student-services/ufs/",
      },
      {
        name: "UP Health Service",
        category: "service",
        building: "UP Health Service",
        description: "University infirmary and student health services.",
        websiteLink: null,
      },
      {
        name: "UP Diliman Police",
        category: "service",
        building: "University Police And Fire Department",
        description: "Campus police and fire department.",
        websiteLink: null,
      },
      {
        name: "Technology Management Center",
        category: "academic",
        building: "Advanced Science and Technology Institute",
        description:
          "TMC classes and offices operate from the DOST-ASTI Complex on C.P. Garcia Ave. while its own building is under way.",
        websiteLink: "https://tmc.upd.edu.ph",
      },
    ];
    const existingOrgs = new Set(
      (
        await db
          .select({ name: organizationsTable.name })
          .from(organizationsTable)
      ).map((o) => o.name),
    );
    const orgInserts = OFFICES.filter((o) => !existingOrgs.has(o.name)).map(
      (o) => ({
        name: o.name,
        category: o.category,
        buildingId: buildingIdByName.get(o.building) ?? null,
        description: o.description,
        websiteLink: o.websiteLink,
      }),
    );
    if (orgInserts.length > 0) {
      await db.insert(organizationsTable).values(orgInserts);
    }
    console.log(`Offices/units: +${orgInserts.length}`);

    // 8. Ikot and Toki from OSM bus stops. Direction verified against the
    // official UPD page (pages.upd.edu.ph/ikotokipara): Ikot counterclockwise,
    // Toki clockwise (relaunched Feb 2024). Stops are the named OSM bus_stop
    // nodes inside campus, ordered by bearing around the campus center.
    // ponytail: bearing sort approximates loop order; hand-fix via editor if
    // a stop lands out of sequence. Fares confirmed by the maintainer, 2026-08.
    const stopsExport = JSON.parse(
      readFileSync("data/upd-stops-osm.json", "utf8"),
    ) as OverpassExport;
    const stopByName = new Map<string, { lat: number; lon: number }>();
    for (const el of stopsExport.elements) {
      const name = el.tags?.name?.trim();
      const lat = (el as { lat?: number }).lat ?? el.center?.lat;
      const lon = (el as { lon?: number }).lon ?? el.center?.lon;
      // Named stops inside the campus polygon that the Ikot/Toki loop does
      // not serve (Commonwealth/C.P. Garcia arteries).
      const OFF_LOOP = new Set(["UP Ayala Techno Hub", "Tandang Sora Avenue"]);
      if (
        !name ||
        name === "Jeepney stop" ||
        OFF_LOOP.has(name) ||
        lat == null ||
        lon == null
      )
        continue;
      if (!stopByName.has(name)) stopByName.set(name, { lat, lon });
    }
    const CENTER = { lat: 14.6551, lon: 121.0685 };
    const ccwStops = [...stopByName.entries()]
      .map(([name, c]) => ({
        name,
        ...c,
        angle: Math.atan2(c.lat - CENTER.lat, c.lon - CENTER.lon),
      }))
      .sort((a, b) => b.angle - a.angle); // decreasing angle = counterclockwise from east
    const existingRoutes = new Set(
      (
        await db.select({ id: jeepneyRoutesTable.id }).from(jeepneyRoutesTable)
      ).map((r) => r.id),
    );
    const ROUTES = [
      {
        id: "ikot",
        name: "Ikot",
        description:
          "Campus loop jeepney serving the Academic Oval and the dorm side. Stops listed are the named waiting sheds from OpenStreetMap; jeeps also stop on request along the loop.",
        directionNote: "Counterclockwise around campus",
        color: "#7b1113",
        stops: ccwStops,
      },
      {
        id: "toki",
        name: "Toki",
        description:
          "Reverse of the Ikot loop (toki is ikot spelled backwards). Service has been intermittent: suspended during the pandemic, relaunched February 2024, reintroduced as a trial run October 2025 (UPD Memo JFA-25-27).",
        directionNote: "Clockwise around campus",
        color: "#0e7490",
        stops: [...ccwStops].reverse(),
      },
    ];
    let routesInserted = 0;
    for (const route of ROUTES) {
      if (existingRoutes.has(route.id)) continue;
      await db.insert(jeepneyRoutesTable).values({
        id: route.id,
        name: route.name,
        description: route.description,
        directionNote: route.directionNote,
        color: route.color,
        fareRegular: 13,
        fareDiscounted: 11,
      });
      await db.insert(jeepneyStopsTable).values(
        route.stops.map((stop, index) => ({
          routeId: route.id,
          name: stop.name,
          description: "Named waiting shed from OpenStreetMap.",
          lat: stop.lat,
          lon: stop.lon,
          sortOrder: index,
        })),
      );
      routesInserted += 1;
    }
    console.log(
      `Jeepney routes: +${routesInserted} (${stopByName.size} named stops)`,
    );

    // 9. Sync-key rows.
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
