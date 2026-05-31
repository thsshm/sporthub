import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildApprovalEmail,
  buildRejectionEmail,
  sendClaimResolutionEmail,
} from "@/lib/email/send-claim-resolution";

const venue = { name: "Stade Charléty", slug: "stade-charlety" };

describe("buildApprovalEmail", () => {
  it("inclut le nom du venue et l'URL", () => {
    const r = buildApprovalEmail(venue, null);
    expect(r.subject).toContain("Stade Charléty");
    expect(r.html).toContain("/venue/stade-charlety");
    expect(r.text).toContain("/venue/stade-charlety");
  });

  it("inclut la note admin si fournie", () => {
    const r = buildApprovalEmail(venue, "Documents validés.");
    expect(r.html).toContain("Documents validés.");
    expect(r.text).toContain("Documents validés.");
  });

  it("omet le bloc note quand vide ou null", () => {
    const empty = buildApprovalEmail(venue, "");
    const nul = buildApprovalEmail(venue, null);
    expect(empty.html).not.toContain("Note de l'équipe");
    expect(nul.html).not.toContain("Note de l'équipe");
  });

  it("échappe le HTML dans le nom du venue", () => {
    const r = buildApprovalEmail(
      { name: "<script>alert(1)</script>", slug: "x" },
      null,
    );
    expect(r.html).not.toContain("<script>alert(1)</script>");
    expect(r.html).toContain("&lt;script&gt;");
  });
});

describe("buildRejectionEmail", () => {
  it("inclut le nom du venue", () => {
    const r = buildRejectionEmail(venue, null);
    expect(r.subject).toContain("Stade Charléty");
    expect(r.html).toContain("Stade Charléty");
  });

  it("inclut la note admin si fournie", () => {
    const r = buildRejectionEmail(venue, "Preuve insuffisante.");
    expect(r.html).toContain("Preuve insuffisante.");
    expect(r.text).toContain("Preuve insuffisante.");
  });
});

describe("sendClaimResolutionEmail", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  it("log un payload avec le préfixe [email:claim] pour un approve", async () => {
    await sendClaimResolutionEmail({
      to: "user@example.com",
      type: "approve",
      venue,
      adminNote: null,
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [prefix, payloadStr] = logSpy.mock.calls[0] as [string, string];
    expect(prefix).toBe("[email:claim]");
    const payload = JSON.parse(payloadStr) as {
      to: string;
      subject: string;
      body: string;
      type: string;
    };
    expect(payload.to).toBe("user@example.com");
    expect(payload.type).toBe("approve");
    expect(payload.subject).toContain("approuvée");
    expect(payload.body).toContain("Stade Charléty");
  });

  it("log un payload type 'reject' pour un rejet", async () => {
    await sendClaimResolutionEmail({
      to: "user@example.com",
      type: "reject",
      venue,
      adminNote: "Manque de preuves.",
    });
    const payloadStr = (logSpy.mock.calls[0] as [string, string])[1];
    const payload = JSON.parse(payloadStr) as { type: string; body: string };
    expect(payload.type).toBe("reject");
    expect(payload.body).toContain("Manque de preuves.");
  });
});
