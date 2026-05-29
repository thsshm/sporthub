"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { FAMILIES, FAMILIES_BY_SLUG } from "@/lib/families";
import { loadActiveFamily, saveActiveFamily } from "@/lib/map-storage";
import { cn } from "@/lib/utils";

/**
 * Switcher de famille rapide pour /map.
 *
 * Comportement (cf. issue #121, parité V1) :
 * - 13 chips colorées (une par famille) + un chip "Toutes" en tête.
 * - Sélection mutuellement exclusive : 1 seule famille active à la fois,
 *   ou "Toutes" (= aucun param ?family).
 * - L'état authoritaire est dans l'URL : `?family=ballon`.
 *   `useSearchParams` est la source de vérité, sessionStorage = warm-restart
 *   intra-onglet quand l'user revient sur /map sans param.
 * - Au clic sur un chip, on appelle `onFamilyChange(slug | null)` pour que
 *   le parent vide les sélections sport / mette à jour les filtres familles.
 *
 * Pourquoi `useSearchParams` + `router.replace` plutôt que `nuqs` ?
 * `nuqs` n'est pas dans package.json (vérifié 2026-05-29) et le besoin est
 * limité à un seul param string — ajouter une dep pour ça n'est pas justifié.
 */
type Props = {
  /** Slug famille active ou null = "Toutes". Optionnel : si absent, le composant
   *  lit l'URL `?family=…` au mount. */
  activeFamily?: string | null;
  /** Appelé au clic. `null` = chip "Toutes". Parent doit reset les sélections
   *  sport pour éviter les sport survivants entre 2 familles (cf. acceptance). */
  onFamilyChange: (slug: string | null) => void;
  className?: string;
};

export function FamilySwitcher({
  activeFamily: activeFamilyProp,
  onFamilyChange,
  className,
}: Props) {
  const tFamilies = useTranslations("families");
  const tSwitcher = useTranslations("map.switcher");

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL d'abord (deeplink-friendly), sessionStorage en fallback (warm-restart
  // intra-onglet). Si rien ni l'autre → "Toutes".
  const urlFamily = searchParams.get("family");
  const activeFamily = useMemo(() => {
    if (activeFamilyProp !== undefined) return activeFamilyProp;
    if (urlFamily && FAMILIES_BY_SLUG[urlFamily]) return urlFamily;
    return null;
  }, [activeFamilyProp, urlFamily]);

  // Hydrate depuis URL → state parent au premier mount, ET sync sessionStorage
  // → URL si l'URL est vide mais qu'un slug est mémorisé dans le même onglet.
  //
  // Note : dépendances volontairement vides — on ne veut **qu'au mount** lire
  // l'URL/storage et propager vers le parent. Après, `onFamilyChange` est la
  // seule porte d'entrée. Cf. comportement viewport dans MapWithSearch.
  useEffect(() => {
    if (urlFamily && FAMILIES_BY_SLUG[urlFamily]) {
      // URL gagne. Propage au parent (utile si parent a un default différent).
      onFamilyChange(urlFamily);
      saveActiveFamily(urlFamily);
      return;
    }
    const stored = loadActiveFamily();
    if (stored && FAMILIES_BY_SLUG[stored]) {
      onFamilyChange(stored);
      // Ne pas pousser dans l'URL ici : on respecte le choix du user d'avoir
      // navigué sur /map sans param. L'URL sera mise à jour au prochain clic.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push l'URL via router.replace (pas push : on évite les entrées history
  // intermédiaires — l'user veut un back vers la home, pas chaque toggle).
  const syncUrl = useCallback(
    (slug: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (slug === null) {
        params.delete("family");
      } else {
        params.set("family", slug);
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const handleSelect = useCallback(
    (slug: string | null) => {
      if (slug === activeFamily) return;
      onFamilyChange(slug);
      saveActiveFamily(slug);
      syncUrl(slug);
    },
    [activeFamily, onFamilyChange, syncUrl],
  );

  return (
    <nav
      aria-label={tSwitcher("ariaLabel")}
      className={cn(
        "flex w-full flex-nowrap items-center gap-1.5 overflow-x-auto rounded-lg border bg-background/95 p-1.5 shadow-md backdrop-blur",
        // Cache la scrollbar tout en gardant le scroll horizontal (mobile)
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => handleSelect(null)}
        aria-pressed={activeFamily === null}
        aria-label={tSwitcher("allAriaLabel")}
        className={cn(
          "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition",
          activeFamily === null
            ? "border-foreground bg-foreground text-background"
            : "border-border bg-background text-muted-foreground hover:border-foreground hover:text-foreground",
        )}
      >
        {tSwitcher("all")}
      </button>

      {FAMILIES.map((f) => {
        const isActive = activeFamily === f.slug;
        const label = tFamilies(f.slug);
        // Couleur via la CSS variable --f-{slug} pour rester en sync avec
        // globals.css. Fallback à `f.color` (même valeur, mais sûr en SSR
        // si la variable n'est pas chargée).
        const colorVar = `var(--f-${f.slug}, ${f.color})`;
        return (
          <button
            key={f.slug}
            type="button"
            onClick={() => handleSelect(f.slug)}
            aria-pressed={isActive}
            aria-label={`${tSwitcher("filterBy")} ${label}`}
            title={label}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-xs transition",
              isActive
                ? "font-bold text-white shadow-sm"
                : "border-border bg-background font-medium text-foreground hover:border-foreground/40",
            )}
            style={
              isActive
                ? { backgroundColor: colorVar, borderColor: colorVar }
                : { color: colorVar }
            }
          >
            <span className="mr-1" aria-hidden="true">
              {f.emoji}
            </span>
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
