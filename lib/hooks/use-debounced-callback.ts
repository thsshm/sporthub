/**
 * Hook React de débounce d'un callback.
 *
 * Cf. issue #114 (perf carte) : on veut un seul appel API à la fin d'un pan/zoom,
 * pas un par micro-mouvement. MapLibre émet `moveend` / `zoomend` rapidement
 * pendant un drag/wheel, et chaque appel naïf déclenche un fetch coûteux côté
 * Supabase. Débouncer à 200ms regroupe la rafale en un seul appel final.
 *
 * Implémentation maison plutôt qu'une dep (lodash full ~90 KB) : 30 lignes
 * suffisent et on ne paye pas le bundle.
 *
 * Spec :
 *   - Le callback reçu peut changer entre les renders ; on lit toujours le
 *     dernier via une ref pour éviter de capturer une version stale.
 *   - Le timer est annulé/recréé à chaque appel ; seul le dernier survit.
 *   - Cleanup au unmount → pas de setState après démontage.
 *   - `flush()` exécute immédiatement avec les derniers args en pending.
 *   - `cancel()` annule l'appel pending sans rien exécuter.
 *
 * La logique d'ordonnancement est extraite dans `createDebouncer` (pur, non-React)
 * pour permettre des tests unitaires sans @testing-library/react.
 */
import { useEffect, useMemo, useRef } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => void;

export type Debouncer<F extends AnyFn> = {
  call: (...args: Parameters<F>) => void;
  flush: () => void;
  cancel: () => void;
};

/**
 * Crée un débouncer pur (sans React) — l'unité testable.
 *
 * `getFn` est appelé au moment de l'exécution pour lire la version la plus
 * récente du callback (équivalent du pattern ref-latest côté React).
 */
export function createDebouncer<F extends AnyFn>(
  getFn: () => F,
  delayMs: number,
): Debouncer<F> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Parameters<F> | null = null;

  const run = () => {
    timer = null;
    if (pendingArgs) {
      const args = pendingArgs;
      pendingArgs = null;
      getFn()(...args);
    }
  };

  return {
    call(...args: Parameters<F>) {
      pendingArgs = args;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    flush() {
      if (timer !== null) {
        clearTimeout(timer);
        run();
      }
    },
    cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pendingArgs = null;
    },
  };
}

/**
 * Hook React : retourne une fonction stable (référence identique entre renders)
 * qui débounce le `callback` passé en argument. Le callback peut changer de
 * référence sans réinitialiser le timer en cours.
 *
 * Usage :
 *   const debouncedUpdate = useDebouncedCallback(() => updateViewport(), 200);
 *   <Map onMoveEnd={debouncedUpdate} onZoomEnd={debouncedUpdate} />
 */
export function useDebouncedCallback<F extends AnyFn>(
  callback: F,
  delayMs: number,
): (...args: Parameters<F>) => void {
  const cbRef = useRef(callback);
  // Toujours pointer vers le dernier callback (les renders suivants).
  cbRef.current = callback;

  // Débouncer stable entre les renders : ne dépend que de delayMs.
  // Si delayMs change, on recrée le débouncer (rare en pratique).
  const debouncer = useMemo(
    () => createDebouncer<F>(() => cbRef.current, delayMs),
    [delayMs],
  );

  // Annule tout appel pending au démontage pour éviter un setState post-unmount.
  useEffect(() => {
    return () => debouncer.cancel();
  }, [debouncer]);

  return debouncer.call;
}
