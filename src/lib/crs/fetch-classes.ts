/**
 * Fetch the full class list for a term from the public CRS UPD schedule
 * browser. CRS has no bulk endpoint; the search is a prefix match on the
 * course number, so a-z plus 0-9 covers the whole catalog (verified: no
 * result cap, "c" alone returns 1000+ rows).
 */

import { parseCrsSchedulePage, type CrsRawClass } from "./parse-schedule-page";

const CRS_SCHEDULE_BASE = "https://crs.upd.edu.ph/schedule";
const QUERY_PREFIXES = [..."abcdefghijklmnopqrstuvwxyz0123456789"];

export type CrsFetchOptions = {
  termId: number;
  /** Delay between requests in ms (default 1500; be polite, 36 requests). */
  delayMs?: number;
  onProgress?: (prefix: string, totalSoFar: number) => void;
};

export async function fetchCrsClasses(
  options: CrsFetchOptions,
): Promise<CrsRawClass[]> {
  const delayMs = options.delayMs ?? 1500;
  const byCode = new Map<string, CrsRawClass>();

  for (const prefix of QUERY_PREFIXES) {
    const url = `${CRS_SCHEDULE_BASE}/${options.termId}/${prefix}`;
    const response = await fetch(url, {
      headers: { "user-agent": "room-tba-upd class importer" },
    });
    if (!response.ok) {
      throw new Error(`CRS returned ${response.status} for ${url}`);
    }
    for (const row of parseCrsSchedulePage(await response.text())) {
      byCode.set(row.classCode, row);
    }
    options.onProgress?.(prefix, byCode.size);
    if (prefix !== QUERY_PREFIXES[QUERY_PREFIXES.length - 1]) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return [...byCode.values()];
}
