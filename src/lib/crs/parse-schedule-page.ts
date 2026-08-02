/**
 * Parser for the public CRS UP Diliman schedule browser
 * (https://crs.upd.edu.ph/schedule/{termId}/{query}).
 *
 * The page is a static HTML table. Instructor lines are dropped at parse
 * time, same policy as the AMIS importer: never store instructor names.
 */

export type CrsRawClass = {
  /** CRS class code, unique per term (e.g. "39163"). */
  classCode: string;
  /** Course + section in one string (e.g. "Math 21 TWHFQ-3"). */
  className: string;
  /** Topic/title lines under the class name (mostly topics courses). */
  courseTitle: string;
  credits: string;
  /**
   * Schedule cell lines that describe meetings
   * (e.g. "TWThF 7:15-8:15AM lec TBA"). Instructor and note lines removed.
   */
  scheduleLines: string[];
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  nbsp: " ",
  ntilde: "ñ",
  Ntilde: "Ñ",
};

function decodeEntities(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function stripTags(html: string) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

/** A meeting line starts with a day token or TBA: "TTh 10-11:30AM lec PH 400". */
const MEETING_LINE_RE = /^(?:TBA\b|(?:M|T|W|Th|F|Su|S)+\s+\d)/;

// ponytail: regex over a fixed server-rendered table, no HTML parser dep.
// Upgrade to a real parser only if CRS changes its markup.
export function parseCrsSchedulePage(html: string): CrsRawClass[] {
  const rows: CrsRawClass[] = [];
  for (const row of html.match(/<tr>[\s\S]*?<\/tr>/g) ?? []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(
      (m) => m[1],
    );
    if (cells.length < 9) continue;
    const classCode = stripTags(cells[0]);
    // The class cell is "Course Section" on the first line; topics courses
    // append title lines after a <br>.
    const classLines = cells[1]
      .split(/<br\s*\/?>/g)
      .map((line) => stripTags(line))
      .filter(Boolean);
    const className = classLines[0] ?? "";
    if (!classCode || !className) continue;

    // Notes live in <em>; instructor names are bare lines after each meeting.
    const scheduleCell = cells[3].replace(/<em[\s\S]*?<\/em>/g, "");
    const scheduleLines = scheduleCell
      .split(/<br\s*\/?>/g)
      .map((line) => stripTags(line))
      .filter((line) => MEETING_LINE_RE.test(line));

    rows.push({
      classCode,
      className,
      courseTitle: classLines.slice(1).join("; "),
      credits: stripTags(cells[2]),
      scheduleLines,
    });
  }
  return rows;
}
