/**
 * Normalize parsed CRS rows into the shape the class importer consumes
 * (NormalizedAmisClass, kept from upstream so src/lib/amis/import-classes.ts
 * works unchanged: room matching, natural-key diff, import report).
 *
 * One CRS row can hold several meetings ("F 1-4PM lab A301; T 3-5PM lec A301").
 * Meetings are grouped by type; each type becomes its own class row, matching
 * the upstream model where LEC and LAB are separate rows sharing a section.
 */

import type { NormalizedAmisClass } from "@lib/amis/types";
import type { CrsRawClass } from "./parse-schedule-page";

/** Meeting-type tokens seen in CRS schedule lines (lowercased). */
const KNOWN_TYPE_TOKENS = new Set([
  "lec",
  "lab",
  "disc",
  "pe",
  "studio",
  "seminar",
  "thesis",
  "prac",
  "res",
  "field",
  "work",
  "diss",
  "class",
  "proj",
  "sem",
  "colloquium",
]);

type CrsMeeting = {
  days: string;
  /** Canonical "7:15AM-8:15AM", or null for TBA. */
  time: string | null;
  type: string | null;
  venue: string | null;
};

const TIME_RANGE_RE =
  /^(\d{1,2})(?::(\d{2}))?(AM|PM)?-(\d{1,2})(?::(\d{2}))?(AM|PM)$/;

function toMinutes(hour: number, minute: number, meridiem: string) {
  const h = hour % 12;
  return (meridiem === "PM" ? h + 12 : h) * 60 + minute;
}

/**
 * CRS elides the first meridiem and minutes: "10AM-1PM", "2:30-5:30PM",
 * "11-1PM". Canonicalize to "H:MMAM-H:MMPM", the only shape
 * parseScheduleTime() accepts. A start with no meridiem takes the end's,
 * flipped when that would make the meeting end before it starts.
 */
export function canonicalizeTimeRange(range: string): string | null {
  const m = range.match(TIME_RANGE_RE);
  if (!m) return null;
  const [, h1, min1, mer1raw, h2, min2, mer2] = m;
  const endMinutes = toMinutes(Number(h2), Number(min2 ?? 0), mer2);
  let mer1 = mer1raw;
  if (!mer1) {
    mer1 = mer2;
    if (toMinutes(Number(h1), Number(min1 ?? 0), mer1) >= endMinutes) {
      mer1 = mer2 === "PM" ? "AM" : "PM";
    }
  }
  return `${h1}:${min1 ?? "00"}${mer1}-${h2}:${min2 ?? "00"}${mer2}`;
}

const MEETING_RE =
  /^(TBA|(?:Th|Su|M|T|W|F|S)+)(?:\s+(\d{1,2}(?::\d{2})?(?:AM|PM)?-\d{1,2}(?::\d{2})?(?:AM|PM)))?(?:\s+(.*))?$/;

/** Parse "TWThF 7:15-8:15AM lec TBA" into a structured meeting, or null. */
export function parseCrsMeeting(text: string): CrsMeeting | null {
  const m = text.trim().match(MEETING_RE);
  if (!m) return null;
  const [, days, rawTime, rest] = m;
  let type: string | null = null;
  let venue: string | null = null;
  if (rest) {
    const [first, ...restTokens] = rest.split(/\s+/);
    if (KNOWN_TYPE_TOKENS.has(first.toLowerCase().split("/")[0])) {
      // Combos like "lec/work" collapse to the first segment.
      type = first.split("/")[0].toUpperCase();
      venue = restTokens.join(" ") || null;
    } else {
      venue = rest;
    }
  }
  if (venue && venue.toUpperCase() === "TBA") venue = null;
  return {
    days,
    time: rawTime ? canonicalizeTimeRange(rawTime) : null,
    type,
    venue,
  };
}

/** Course + section split: the last whitespace token is the section. */
export function splitClassName(className: string): {
  courseCode: string;
  section: string;
} {
  const idx = className.lastIndexOf(" ");
  if (idx === -1) return { courseCode: className, section: "" };
  return {
    courseCode: className.slice(0, idx).trim(),
    section: className.slice(idx + 1).trim(),
  };
}

function slotString(meeting: CrsMeeting): string {
  if (meeting.days === "TBA" || !meeting.time) return "TBA";
  return `${meeting.days} ${meeting.time}`;
}

export function normalizeCrsClass(
  raw: CrsRawClass,
  termId: number,
): NormalizedAmisClass[] {
  const { courseCode, section } = splitClassName(raw.className);
  if (!courseCode) return [];

  const meetings: CrsMeeting[] = [];
  for (const line of raw.scheduleLines) {
    for (const part of line.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const meeting = parseCrsMeeting(trimmed);
      if (meeting) meetings.push(meeting);
    }
  }
  // A bare "TBA" with no type or venue is an instructor placeholder when the
  // row already has real meetings; keep it only when it is all the row has.
  const substantive = meetings.filter(
    (m) => !(m.days === "TBA" && !m.type && !m.venue),
  );
  const kept = substantive.length > 0 ? substantive : meetings.slice(0, 1);

  const byType = new Map<string, CrsMeeting[]>();
  for (const meeting of kept) {
    // Typeless meetings import as CLASS instead of being dropped by the
    // room-scheduled-type filter.
    const key = meeting.type ?? "CLASS";
    const group = byType.get(key);
    if (group) group.push(meeting);
    else byType.set(key, [meeting]);
  }

  const rows: NormalizedAmisClass[] = [];
  for (const [type, group] of byType) {
    const slots = [...new Set(group.map(slotString))];
    rows.push({
      courseCode,
      section,
      type,
      courseTitle: raw.courseTitle,
      schedule: slots.length === 1 && slots[0] === "TBA" ? [] : slots,
      termId,
      facilityCode: group.find((m) => m.venue)?.venue ?? null,
    });
  }
  return rows;
}
