import { render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, test } from "vitest";
import AcademicCalendarScreen from "@ui/calendar/AcademicCalendarScreen.svelte";
import { termStore } from "@lib/store.svelte";
import type { TermWithCount } from "@lib/types";

// Windows are placed around the real clock so the screen's "today" snapshot
// lands inside term B without mocking Date.
const DAY_MS = 86_400_000;
const manilaKey = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY_MS).toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
  });

const term = (
  id: number,
  overrides: Partial<TermWithCount> = {},
): TermWithCount => ({
  id,
  label: `Term ${id}`,
  schoolYear: "2098-2099",
  semester: null,
  startsOn: null,
  endsOn: null,
  isDefault: false,
  isActive: true,
  sortOrder: id,
  classesImportedAt: null,
  version: 1,
  updatedAt: "2026-01-01",
  classCount: 0,
  ...overrides,
});

describe("AcademicCalendarScreen", () => {
  beforeEach(() => {
    termStore.terms = [
      term(9001, {
        startsOn: manilaKey(-120),
        endsOn: manilaKey(-60),
        semester: "1",
        classCount: 1200,
      }),
      term(9002, {
        startsOn: manilaKey(-10),
        endsOn: manilaKey(50),
        semester: "2",
        classCount: 3400,
      }),
      term(9003, { semester: "midyear" }),
    ];
    termStore.loaded = true;
  });

  test("renders a dialog with the year strip, today marker, and in-session highlight", () => {
    render(AcademicCalendarScreen);
    expect(
      screen.getByRole("dialog", { name: "Academic Calendar" }),
    ).toBeTruthy();

    const segments = document.querySelectorAll(".acal-seg");
    expect(segments).toHaveLength(2); // 9003 has no dates anywhere
    expect(document.querySelector(".acal-seg--past")?.textContent).toContain(
      "1st sem",
    );
    expect(
      document.querySelector(".acal-seg--in-session")?.textContent,
    ).toContain("2nd sem");
    expect(document.querySelector(".acal-today")).toBeTruthy();
  });

  test("lists every active term with CRS id, date range, class count, and status", () => {
    render(AcademicCalendarScreen);
    const cards = [...document.querySelectorAll(".acal-card")];
    expect(cards).toHaveLength(3);

    const inSession = cards.find((card) =>
      card.textContent?.includes("CRS 9002"),
    );
    expect(inSession?.textContent).toContain("In session");
    expect(inSession?.textContent).toContain("3400 classes campus-wide");
    expect(inSession?.classList.contains("acal-card--current")).toBe(true);

    const undated = cards.find((card) =>
      card.textContent?.includes("CRS 9003"),
    );
    expect(undated?.textContent).toContain("Dates TBA");
  });

  test("shows the community-data disclaimer", () => {
    render(AcademicCalendarScreen);
    expect(screen.getByRole("note").textContent).toContain(
      "official UP Diliman academic calendar",
    );
  });
});
