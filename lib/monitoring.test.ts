import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEvent, monitoringStatus } from "./monitoring";

describe("trackEvent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ne jette jamais, même sans PostHog configuré", () => {
    // NEXT_PUBLIC_POSTHOG_KEY absent dans l'env de test → branche posthog
    // jamais atteinte. trackEvent doit rester un no-op silencieux côté valeur.
    expect(() =>
      trackEvent("venue_view", { venueId: "abc", sport: "tennis" }),
    ).not.toThrow();
    expect(trackEvent("noop")).toBeUndefined();
  });

  it("logue l'événement en dev (NODE_ENV !== production)", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    trackEvent("cta_click", { label: "claim" });
    expect(spy).toHaveBeenCalledWith(
      '[monitoring] event "cta_click":',
      { label: "claim" },
    );
  });
});

describe("monitoringStatus", () => {
  it("expose les flags sentry/posthog et l'env", () => {
    const status = monitoringStatus();
    expect(status).toHaveProperty("sentryEnabled");
    expect(status).toHaveProperty("posthogEnabled");
    expect(status).toHaveProperty("env");
    expect(typeof status.sentryEnabled).toBe("boolean");
    expect(typeof status.posthogEnabled).toBe("boolean");
  });
});
