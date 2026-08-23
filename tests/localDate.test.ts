import { describe, it, expect } from "vitest";
import { LocalDate } from "../src/LocalDate.js";

describe("LocalDate Value Object - V2 Architecture", () => {
  it("creates valid instance from ISO string and serializes back", () => {
    const ld = LocalDate.fromIso("2026-08-19");
    expect(ld.year).toBe(2026);
    expect(ld.month).toBe(8);
    expect(ld.day).toBe(19);
    expect(ld.toIso()).toBe("2026-08-19");
    expect(ld.toSql()).toBe("2026-08-19");
    expect(ld.toString()).toBe("2026-08-19");
  });

  it("handles ISO strings with time parts safely", () => {
    const ld = LocalDate.fromIso("2026-08-19T23:45:00.000Z");
    expect(ld.toIso()).toBe("2026-08-19");
  });

  it("performs safe day arithmetic without timezone drift", () => {
    const today = LocalDate.fromIso("2026-08-19");
    const tomorrow = today.addDays(1);
    const inAWeek = today.addDays(7);
    const yesterday = today.addDays(-1);

    expect(tomorrow.toIso()).toBe("2026-08-20");
    expect(inAWeek.toIso()).toBe("2026-08-26");
    expect(yesterday.toIso()).toBe("2026-08-18");
  });

  it("computes days of week correctly", () => {
    // 2026-08-16 is a Sunday, 2026-08-17 is Monday
    const sunday = LocalDate.fromIso("2026-08-16");
    const monday = LocalDate.fromIso("2026-08-17");
    const saturday = LocalDate.fromIso("2026-08-22");

    expect(sunday.getDayOfWeek()).toBe(0);
    expect(sunday.isSunday()).toBe(true);
    expect(sunday.isWeekend()).toBe(true);

    expect(monday.getDayOfWeek()).toBe(1);
    expect(monday.isSunday()).toBe(false);
    expect(monday.isWeekend()).toBe(false);

    expect(saturday.getDayOfWeek()).toBe(6);
    expect(saturday.isWeekend()).toBe(true);
  });

  it("compares dates chronologically", () => {
    const d1 = LocalDate.fromIso("2026-08-19");
    const d2 = LocalDate.fromIso("2026-08-20");
    const d3 = LocalDate.fromIso("2026-08-19");

    expect(d1.isBefore(d2)).toBe(true);
    expect(d2.isAfter(d1)).toBe(true);
    expect(d1.equals(d3)).toBe(true);
    expect(d1.equals("2026-08-19")).toBe(true);
    expect(d2.diffInDays(d1)).toBe(1);
    expect(d1.diffInDays(d2)).toBe(-1);
  });

  it("formats dates in Spanish cleanly", () => {
    // 2026-08-19 is Wednesday (Mié)
    const d = LocalDate.fromIso("2026-08-19");
    expect(d.formatShortEs()).toBe("Mié 19/08");
    expect(d.formatLongEs()).toContain("Miércoles, 19 de Agosto de 2026");
  });

  it("generates safe UTC noon Date objects", () => {
    const d = LocalDate.fromIso("2026-08-19");
    const dateObj = d.toUtcNoonDate();
    expect(dateObj.getUTCFullYear()).toBe(2026);
    expect(dateObj.getUTCMonth()).toBe(7); // 0-indexed (8-1)
    expect(dateObj.getUTCDate()).toBe(19);
    expect(dateObj.getUTCHours()).toBe(12);
  });

  it("throws clear error on malformed strings", () => {
    expect(() => LocalDate.fromIso("invalid-date")).toThrow();
    expect(() => LocalDate.fromIso("2026-13-45")).toThrow();
  });
});
