/**
 * Tests de la primitive `createDebouncer` (logique d'ordonnancement testable
 * sans @testing-library/react).
 *
 * On ne teste pas le hook React directement — vitest tourne en env "node" et
 * pas de DOM. Mais comme tout le state non-trivial vit dans createDebouncer,
 * couvrir cette fonction valide aussi l'invariant central du hook.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createDebouncer } from "@/lib/hooks/use-debounced-callback";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDebouncer", () => {
  it("n'appelle pas la fonction avant l'écoulement du délai", () => {
    const fn = vi.fn();
    const d = createDebouncer(() => fn, 200);
    d.call();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(fn).not.toHaveBeenCalled();
  });

  it("appelle exactement une fois après le délai", () => {
    const fn = vi.fn();
    const d = createDebouncer(() => fn, 200);
    d.call();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("regroupe plusieurs appels rapides en un seul (cas pan/zoom MapLibre)", () => {
    const fn = vi.fn();
    const d = createDebouncer(() => fn, 200);
    // Rafale de 5 appels en 100ms
    for (let i = 0; i < 5; i++) {
      d.call(i);
      vi.advanceTimersByTime(20);
    }
    // Pas encore exécuté (chaque call a reset le timer)
    expect(fn).not.toHaveBeenCalled();
    // Attendre la fin du dernier débounce
    vi.advanceTimersByTime(200);
    // Une seule exécution, avec les derniers args (4)
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(4);
  });

  it("conserve les derniers arguments passés", () => {
    const fn = vi.fn();
    const d = createDebouncer(() => fn, 200);
    d.call("first");
    d.call("second");
    d.call("third");
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("third");
  });

  it("lit la version la plus récente du callback au moment de l'exécution", () => {
    // Simule le pattern ref-latest du hook React : le getter retourne la
    // dernière version même si elle a changé entre call() et l'exécution.
    let currentFn = vi.fn();
    const fnA = currentFn;
    const d = createDebouncer(() => currentFn, 200);
    d.call();
    // Le user re-render avec un nouveau callback avant l'expiration
    const fnB = vi.fn();
    currentFn = fnB;
    vi.advanceTimersByTime(200);
    expect(fnA).not.toHaveBeenCalled();
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it("cancel() annule l'appel pending", () => {
    const fn = vi.fn();
    const d = createDebouncer(() => fn, 200);
    d.call();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it("flush() exécute immédiatement l'appel pending", () => {
    const fn = vi.fn();
    const d = createDebouncer(() => fn, 200);
    d.call("urgent");
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("urgent");
    // Et le timer pending est nettoyé : pas de double exécution
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("flush() sans appel pending est un no-op", () => {
    const fn = vi.fn();
    const d = createDebouncer(() => fn, 200);
    d.flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it("permet un nouveau cycle après cancel()", () => {
    const fn = vi.fn();
    const d = createDebouncer(() => fn, 200);
    d.call("a");
    d.cancel();
    d.call("b");
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("b");
  });
});
