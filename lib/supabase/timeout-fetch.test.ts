import { describe, expect, it, vi } from "vitest";
import { createTimeoutFetch, SUPABASE_FETCH_TIMEOUT_MS } from "@/lib/supabase/timeout-fetch";

/** Faux fetch qui ne résout JAMAIS seul : ne rejette QUE si son signal abort. */
function hangingFetch(): typeof fetch {
  return ((_input: unknown, init?: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) return reject(new DOMException("aborted", "AbortError"));
      signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), {
        once: true,
      });
    })) as unknown as typeof fetch;
}

describe("createTimeoutFetch", () => {
  it("laisse passer une réponse rapide et nettoie le timer", async () => {
    const resp = new Response("ok");
    const base = vi.fn(async () => resp) as unknown as typeof fetch;
    const tf = createTimeoutFetch(50, base);
    await expect(tf("http://x")).resolves.toBe(resp);
    expect(base).toHaveBeenCalledOnce();
  });

  it("abandonne après le timeout si le backend pend", async () => {
    vi.useFakeTimers();
    const tf = createTimeoutFetch(12_000, hangingFetch());
    const p = tf("http://x");
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
    vi.useRealTimers();
  });

  it("respecte un signal déjà fourni par l'appelant", async () => {
    const upstream = new AbortController();
    const tf = createTimeoutFetch(99_999, hangingFetch());
    const p = tf("http://x", { signal: upstream.signal });
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    upstream.abort();
    await assertion;
  });

  it("expose un délai par défaut < 25 s (limite fonction Vercel)", () => {
    expect(SUPABASE_FETCH_TIMEOUT_MS).toBeLessThan(25_000);
    expect(SUPABASE_FETCH_TIMEOUT_MS).toBeGreaterThan(8_000);
  });
});
