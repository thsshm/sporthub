import { describe, expect, it } from "vitest";
import {
  parseOpeningHours,
  toSchemaOpeningHours,
  formatRange,
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
