import { describe, expect, it } from "bun:test";
import {
  classTypeDisplayLabel,
  CLASS_BROWSE_SCOPE_NOTE,
  isNonRoomClassType,
  isRoomScheduledClassType,
  ROOM_SCHEDULE_SCOPE_NOTE,
} from "./room-scheduled-types";

describe("room-scheduled-types", () => {
  it("treats CRS meeting types as room-scheduled", () => {
    expect(isRoomScheduledClassType("LEC")).toBe(true);
    expect(isRoomScheduledClassType("lab")).toBe(true);
    expect(isRoomScheduledClassType("DISC")).toBe(true);
    expect(isRoomScheduledClassType("pe")).toBe(true);
    expect(isRoomScheduledClassType("STUDIO")).toBe(true);
    expect(isRoomScheduledClassType("CLASS")).toBe(true);
  });

  it("recognizes roomless import types", () => {
    expect(isNonRoomClassType("THESIS")).toBe(true);
    expect(isNonRoomClassType("DISS")).toBe(true);
    expect(isNonRoomClassType("RES")).toBe(true);
    expect(isNonRoomClassType("PRAC")).toBe(true);
    expect(isNonRoomClassType("PROJ")).toBe(true);
    expect(isNonRoomClassType("LEC")).toBe(false);
    expect(isNonRoomClassType("THS")).toBe(false);
  });

  it("maps roomless types to display labels", () => {
    expect(classTypeDisplayLabel("THESIS")).toBe("Thesis");
    expect(classTypeDisplayLabel("res")).toBe("Research");
    expect(classTypeDisplayLabel("LEC")).toBe("LEC");
  });

  it("documents scope for room schedules vs class browse", () => {
    expect(ROOM_SCHEDULE_SCOPE_NOTE).toContain("do not appear here");
    expect(CLASS_BROWSE_SCOPE_NOTE).toContain("thesis");
    expect(CLASS_BROWSE_SCOPE_NOTE).toContain("unassigned");
  });
});
