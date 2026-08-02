import { describe, expect, test } from "bun:test";
import {
  canonicalizeTimeRange,
  normalizeCrsClass,
  parseCrsMeeting,
  splitClassName,
} from "./normalize-class";

describe("canonicalizeTimeRange", () => {
  test("adds missing minutes and start meridiem", () => {
    expect(canonicalizeTimeRange("10AM-1PM")).toBe("10:00AM-1:00PM");
    expect(canonicalizeTimeRange("2:30-5:30PM")).toBe("2:30PM-5:30PM");
    expect(canonicalizeTimeRange("7:15-8:15AM")).toBe("7:15AM-8:15AM");
  });

  test("flips the start meridiem across noon", () => {
    expect(canonicalizeTimeRange("11-1PM")).toBe("11:00AM-1:00PM");
    expect(canonicalizeTimeRange("12-1PM")).toBe("12:00PM-1:00PM");
  });
});

describe("parseCrsMeeting", () => {
  test("full meeting line", () => {
    expect(parseCrsMeeting("TWThF 7:15-8:15AM lec TBA")).toEqual({
      days: "TWThF",
      time: "7:15AM-8:15AM",
      type: "LEC",
      venue: null,
    });
  });

  test("venue and combo types", () => {
    expect(parseCrsMeeting("W 10AM-1PM lab AECH-TL2")).toEqual({
      days: "W",
      time: "10:00AM-1:00PM",
      type: "LAB",
      venue: "AECH-TL2",
    });
    expect(parseCrsMeeting("M 4-7PM lec/work FA Studio")?.type).toBe("LEC");
  });

  test("TBA schedule with type", () => {
    expect(parseCrsMeeting("TBA lec TBA")).toEqual({
      days: "TBA",
      time: null,
      type: "LEC",
      venue: null,
    });
  });
});

describe("splitClassName", () => {
  test("last token is the section", () => {
    expect(splitClassName("Math 21 TWHFQ-3")).toEqual({
      courseCode: "Math 21",
      section: "TWHFQ-3",
    });
    expect(splitClassName("Malikhaing Pagsulat 100 XYZ")).toEqual({
      courseCode: "Malikhaing Pagsulat 100",
      section: "XYZ",
    });
  });
});

describe("normalizeCrsClass", () => {
  const base = { classCode: "39163", credits: "4.0", courseTitle: "" };

  test("groups meetings by type into separate class rows", () => {
    const rows = normalizeCrsClass(
      {
        ...base,
        className: "CS 32 ABC",
        scheduleLines: ["TTh 10-11:30AM lec AECH 105; F 1-4PM lab AECH-TL2"],
      },
      120261,
    );
    expect(rows).toHaveLength(2);
    const lec = rows.find((r) => r.type === "LEC");
    const lab = rows.find((r) => r.type === "LAB");
    expect(lec?.schedule).toEqual(["TTh 10:00AM-11:30AM"]);
    expect(lec?.facilityCode).toBe("AECH 105");
    expect(lab?.schedule).toEqual(["F 1:00PM-4:00PM"]);
  });

  test("drops instructor-TBA placeholder lines but keeps all-TBA rows", () => {
    const rows = normalizeCrsClass(
      {
        ...base,
        className: "Eng 1 THU",
        scheduleLines: ["TTh 1-2:30PM lec PH 400", "TBA"],
      },
      120261,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].schedule).toEqual(["TTh 1:00PM-2:30PM"]);

    const tbaOnly = normalizeCrsClass(
      { ...base, className: "CS 300 A", scheduleLines: ["TBA"] },
      120261,
    );
    expect(tbaOnly).toHaveLength(1);
    expect(tbaOnly[0].schedule).toEqual([]);
    expect(tbaOnly[0].type).toBe("CLASS");
  });
});
