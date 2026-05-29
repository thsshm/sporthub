import { describe, expect, it } from "vitest";
import {
  parseOpeningHours,
  toSchemaOpeningHours,
  formatRange,
  getOpenStatus,
} from "@/lib/venue/opening-hours";

describe("parseOpeningHours", () => {
  it("retourne null pour null/undefined/vide", () => {
    expect(parseOpeningHours(null)).toBeNull();
    expect(parseOpeningHours(undefined)).toBeNull();
    expect(parseOpeningHours("")).toBeNull();
    expect(parseOpeningHours("   ")).toBeNull();
  });

  it("supporte 24/7", () => {
    const result = parseOpeningHours("24/7");
    expect(result).toHaveLength(7);
    expect(result![0]).toEqual({
      day: "Mo",
      ranges: [{ open: "00:00", close: "24:00" }],
    });
  });

  it("parse Mo-Fr 09:00-22:00", () => {
    const result = parseOpeningHours("Mo-Fr 09:00-22:00");
    expect(result).toHaveLength(5);
    expect(result![0].day).toBe("Mo");
    expect(result![4].day).toBe("Fr");
    expect(result![0].ranges).toEqual([{ open: "09:00", close: "22:00" }]);
  });

  it("parse plusieurs blocs avec ;", () => {
    const result = parseOpeningHours("Mo-Fr 09:00-22:00; Sa,Su 10:00-20:00");
    expect(result).toHaveLength(7);
    const sa = result!.find((s) => s.day === "Sa");
    expect(sa?.ranges).toEqual([{ open: "10:00", close: "20:00" }]);
  });

  it("parse plages multiples séparées par ,", () => {
    const result = parseOpeningHours("Mo-Fr 09:00-12:00,14:00-18:00");
    expect(result![0].ranges).toHaveLength(2);
    expect(result![0].ranges[1]).toEqual({ open: "14:00", close: "18:00" });
  });

  it("parse jours non contigus Mo,Tu,Th", () => {
    const result = parseOpeningHours("Mo,Tu,Th 18:00-22:00");
    expect(result).toHaveLength(3);
    expect(result!.map((s) => s.day)).toEqual(["Mo", "Tu", "Th"]);
  });

  it("retourne null pour un format inconnu", () => {
    expect(parseOpeningHours("Mo sunset-sunrise")).toBeNull();
    expect(parseOpeningHours("PH off")).toBeNull();
    expect(parseOpeningHours("week 1-3 Mo 09:00-22:00")).toBeNull();
  });

  it("retourne null si jour invalide", () => {
    expect(parseOpeningHours("Xx 09:00-22:00")).toBeNull();
  });

  it("ordonne les jours Mo..Su", () => {
    const result = parseOpeningHours("Su 10:00-20:00; Mo-Fr 09:00-22:00");
    expect(result!.map((s) => s.day)).toEqual([
      "Mo",
      "Tu",
      "We",
      "Th",
      "Fr",
      "Su",
    ]);
  });
});

describe("toSchemaOpeningHours", () => {
  it("convertit en OpeningHoursSpecification[]", () => {
    const specs = parseOpeningHours("Mo-Fr 09:00-22:00")!;
    const schema = toSchemaOpeningHours(specs);
    expect(schema).toHaveLength(5);
    expect(schema[0]).toEqual({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: "Monday",
      opens: "09:00",
      closes: "22:00",
    });
  });

  it("développe les plages multiples (2 ranges = 2 entrées par jour)", () => {
    const specs = parseOpeningHours("Mo 09:00-12:00,14:00-18:00")!;
    const schema = toSchemaOpeningHours(specs);
    expect(schema).toHaveLength(2);
  });
});

describe("formatRange", () => {
  it("français : 9h-22h pour minutes 00", () => {
    expect(formatRange("09:00", "22:00", "fr")).toBe("9h-22h");
  });

  it("français : 9h30-22h pour minutes != 00", () => {
    expect(formatRange("09:30", "22:00", "fr")).toBe("9h30-22h");
  });

  it("anglais : 9:00-22:00", () => {
    expect(formatRange("09:00", "22:00", "en")).toBe("9:00-22:00");
  });
});

describe("getOpenStatus", () => {
  // 2024-01-08 (Monday) 10:00 local
  const monday10 = new Date(2024, 0, 8, 10, 0);
  // 2024-01-08 (Monday) 23:00 local
  const monday23 = new Date(2024, 0, 8, 23, 0);
  // 2024-01-08 (Monday) 06:00 local
  const monday6 = new Date(2024, 0, 8, 6, 0);

  it("retourne null si pas de specs", () => {
    expect(getOpenStatus(null, monday10)).toBeNull();
    expect(getOpenStatus([], monday10)).toBeNull();
  });

  it("ouvert : lundi 10h dans Mo-Fr 09:00-22:00", () => {
    const specs = parseOpeningHours("Mo-Fr 09:00-22:00");
    const status = getOpenStatus(specs, monday10);
    expect(status).not.toBeNull();
    if (!status) throw new Error("status null");
    expect(status.isOpen).toBe(true);
    if (status.isOpen) {
      expect(status.closesAt).toBe("22:00");
    }
  });

  it("fermé après l'horaire : lundi 23h hors 09:00-22:00", () => {
    const specs = parseOpeningHours("Mo-Fr 09:00-22:00");
    const status = getOpenStatus(specs, monday23);
    if (!status) throw new Error("status null");
    expect(status.isOpen).toBe(false);
  });

  it("fermé avant l'horaire : lundi 6h donne next opensAt 9h", () => {
    const specs = parseOpeningHours("Mo-Fr 09:00-22:00");
    const status = getOpenStatus(specs, monday6);
    if (!status) throw new Error("status null");
    expect(status.isOpen).toBe(false);
    if (!status.isOpen) {
      expect(status.opensAt).toBe("09:00");
    }
  });

  it("24/7 : toujours ouvert", () => {
    const specs = parseOpeningHours("24/7");
    const s1 = getOpenStatus(specs, monday23);
    const s2 = getOpenStatus(specs, monday6);
    if (!s1 || !s2) throw new Error("status null");
    expect(s1.isOpen).toBe(true);
    expect(s2.isOpen).toBe(true);
  });

  it("pause méridienne : 13h fermé entre les 2 créneaux", () => {
    const specs = parseOpeningHours("Mo-Fr 09:00-12:00,14:00-18:00");
    const monday13 = new Date(2024, 0, 8, 13, 0);
    const status = getOpenStatus(specs, monday13);
    if (!status) throw new Error("status null");
    expect(status.isOpen).toBe(false);
    if (!status.isOpen) {
      expect(status.opensAt).toBe("14:00");
    }
  });
});
