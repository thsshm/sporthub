import { describe, expect, it } from "vitest";
import { validateReportInput, MAX_REPORT_NOTE } from "@/lib/venue/report";

const UUID = "74fd88a0-3e65-47e9-bac4-2278cc479b95";

describe("validateReportInput", () => {
  it("accepte un signalement valide (avec note)", () => {
    const r = validateReportInput({ venue_id: UUID, issue_type: "closed", note: "Fermé depuis 2024" });
    expect(r).toEqual({ ok: true, value: { venue_id: UUID, issue_type: "closed", note: "Fermé depuis 2024" } });
  });

  it("note optionnelle : absente / vide → null", () => {
    expect(validateReportInput({ venue_id: UUID, issue_type: "other" })).toMatchObject({
      ok: true,
      value: { note: null },
    });
    expect(validateReportInput({ venue_id: UUID, issue_type: "other", note: "   " })).toMatchObject({
      ok: true,
      value: { note: null },
    });
  });

  it("trim le venue_id et la note", () => {
    const r = validateReportInput({ venue_id: ` ${UUID} `, issue_type: "wrong_sport", note: "  x  " });
    expect(r.ok && r.value.venue_id).toBe(UUID);
    expect(r.ok && r.value.note).toBe("x");
  });

  it("rejette un venue_id non-UUID", () => {
    expect(validateReportInput({ venue_id: "abc", issue_type: "closed" }).ok).toBe(false);
    expect(validateReportInput({ issue_type: "closed" }).ok).toBe(false);
  });

  it("rejette un issue_type hors liste", () => {
    expect(validateReportInput({ venue_id: UUID, issue_type: "spam" }).ok).toBe(false);
    expect(validateReportInput({ venue_id: UUID }).ok).toBe(false);
  });

  it("rejette une note trop longue", () => {
    const long = "a".repeat(MAX_REPORT_NOTE + 1);
    expect(validateReportInput({ venue_id: UUID, issue_type: "other", note: long }).ok).toBe(false);
  });

  it("rejette un corps non-objet", () => {
    expect(validateReportInput(null).ok).toBe(false);
    expect(validateReportInput("x").ok).toBe(false);
  });
});
