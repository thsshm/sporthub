"use client";

import { useTranslations } from "next-intl";
import { FAMILIES } from "@/lib/families";
import { FamilySwitcher } from "@/app/[locale]/map/FamilySwitcher";

/** Critères universels — héritage filtres V1 (sporthub-map.js, UNIVERSAL_FILTERS).
 * Mappent côté DB :
 *   lit        → v.has_lighting = TRUE
 *   indoor     → v.is_indoor = TRUE
 *   wheelchair → v.is_wheelchair_accessible = TRUE
 *   free       → v.fee_required = FALSE
 *   paid       → v.fee_required = TRUE
 */
export const CRITERIA = [
  { key: "lit", emoji: "🌙" },
  { key: "indoor", emoji: "🏠" },
  { key: "wheelchair", emoji: "♿" },
  { key: "free", emoji: "🆓" },
  { key: "paid", emoji: "💰" },
] as const;

export type CriteriaKey = (typeof CRITERIA)[number]["key"];

/** Surfaces de terrain (#99). Valeurs canoniques alignées sur le filtre RPC
 * venues_in_bbox (0014) qui matche venue_sport.surface. AND avec les critères. */
export const SURFACES = [
  { key: "clay", emoji: "🟧" },
  { key: "concrete", emoji: "⬜" },
  { key: "synthetic", emoji: "🟩" },
  { key: "grass", emoji: "🌱" },
  { key: "parquet", emoji: "🟫" },
  { key: "sand", emoji: "🏖️" },
] as const;

export type SurfaceKey = (typeof SURFACES)[number]["key"];

type Props = {
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  selectedCriteria: Set<CriteriaKey>;
  onCriteriaChange: (next: Set<CriteriaKey>) => void;
  selectedSurfaces: Set<SurfaceKey>;
  onSurfacesChange: (next: Set<SurfaceKey>) => void;
  /** Toggle "Mise à jour auto" (recharge à chaque pan/zoom). Quand off,
   * un bouton "Rechercher dans cette zone" apparaît dans MapClient. */
  autoUpdate: boolean;
  onAutoUpdateChange: (next: boolean) => void;
  /** Rouvre le picker explore (#132). Si absent, le bouton n'est pas rendu. */
  onReopenPicker?: () => void;
  /** Compteurs à facettes par option (#279) : nb de lieux du viewport qui
   * matcheraient, en respectant les autres filtres actifs. Si absent, aucun
   * compteur n'est affiché (pas de régression hors carte). */
  familyCounts?: Record<string, number>;
  criteriaCounts?: Record<string, number>;
  surfaceCounts?: Record<string, number>;
  className?: string;
};

/** Petit badge compteur aligné à droite d'une option de filtre (#279). */
function CountBadge({ counts, k }: { counts?: Record<string, number>; k: string }) {
  if (!counts) return null;
  const n = counts[k] ?? 0;
  return (
    <span
      className={`ml-auto shrink-0 text-xs tabular-nums ${
        n === 0 ? "text-muted-foreground/40" : "text-muted-foreground"
      }`}
    >
      {n.toLocaleString("fr-FR")}
    </span>
  );
}

export function SportFilters({
  selected,
  onChange,
  selectedCriteria,
  onCriteriaChange,
  selectedSurfaces,
  onSurfacesChange,
  autoUpdate,
  onAutoUpdateChange,
  onReopenPicker,
  familyCounts,
  criteriaCounts,
  surfaceCounts,
  className,
}: Props) {
  const tMap = useTranslations("map");
  const tFamilies = useTranslations("families");
  const tFeat = useTranslations("map.feat");
  const tSurface = useTranslations("map.surface");

  const toggle = (slug: string) => {
    const next = new Set(selected);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange(next);
  };

  const selectAll = () => onChange(new Set(FAMILIES.map((f) => f.slug)));
  const selectNone = () => onChange(new Set());

  // Reset = "tout cocher familles + aucun critère + autoUpdate on".
  // Pratique : un seul clic pour revenir à la vue par défaut après explorer
  // une sélection fine.
  const hasActiveFilters =
    selected.size < FAMILIES.length ||
    selectedCriteria.size > 0 ||
    selectedSurfaces.size > 0 ||
    !autoUpdate;
  const resetAll = () => {
    onChange(new Set(FAMILIES.map((f) => f.slug)));
    onCriteriaChange(new Set());
    onSurfacesChange(new Set());
    onAutoUpdateChange(true);
  };

  const toggleCriterion = (key: CriteriaKey) => {
    const next = new Set(selectedCriteria);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onCriteriaChange(next);
  };

  const toggleSurface = (key: SurfaceKey) => {
    const next = new Set(selectedSurfaces);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSurfacesChange(next);
  };

  // Single-active : si exactement 1 famille cochée, on est en mode "switcher".
  // Sinon (0, toutes, ou multi) = activeSlug=null (chip "Toutes" active).
  const activeSlug = selected.size === 1 ? Array.from(selected)[0] : null;
  const handleSwitchFamily = (slug: string | null) => {
    if (slug === null) {
      // Retour à "Toutes les familles"
      onChange(new Set(FAMILIES.map((f) => f.slug)));
    } else {
      // Switch single-family : on remplace toute la sélection par ce slug
      onChange(new Set([slug]));
    }
  };

  return (
    <aside
      aria-label={tMap("filtersTitle")}
      className={`flex flex-col gap-3 rounded-lg border bg-background/95 p-3 shadow-md backdrop-blur ${className ?? ""}`}
    >
      {/* Rouvre le picker explore (multi-familles + ville) — point d'entrée
          pour changer toute sa sélection d'un coup. Cf. #132. */}
      {onReopenPicker && (
        <button
          type="button"
          onClick={onReopenPicker}
          className="flex items-center justify-center gap-1.5 rounded-md bg-gradient-to-r from-orange-500 to-yellow-400 px-2 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
        >
          <span aria-hidden="true">🔄</span>
          {tMap("picker.changeSelection")}
        </button>
      )}

      {/* Switcher famille rapide — pattern V1 "1 famille active en 1 clic".
          Complète les checkboxes multi-select ci-dessous. Cf. #121. */}
      <FamilySwitcher
        activeSlug={activeSlug}
        onSelect={handleSwitchFamily}
      />

      {/* Bouton Reset global — visible uniquement si filtres actifs */}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={resetAll}
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-muted-foreground/30 px-2 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-foreground hover:text-foreground"
        >
          ↺ {tMap("resetFilters")}
        </button>
      )}

      {/* Familles */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{tMap("filtersTitle")}</h2>
          <div className="flex gap-1.5 text-[11px]">
            <button
              type="button"
              onClick={selectAll}
              className="text-blue-600 hover:underline"
            >
              {tMap("filtersAll")}
            </button>
            <span className="text-muted-foreground">·</span>
            <button
              type="button"
              onClick={selectNone}
              className="text-blue-600 hover:underline"
            >
              {tMap("filtersNone")}
            </button>
          </div>
        </div>
        <ul className="space-y-0.5">
          {FAMILIES.map((f) => {
            const name = tFamilies(f.slug);
            return (
              <li key={f.slug}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={selected.has(f.slug)}
                    onChange={() => toggle(f.slug)}
                    className="h-3.5 w-3.5 cursor-pointer"
                    aria-label={name}
                  />
                  <span
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: f.color }}
                    aria-hidden="true"
                  />
                  <span aria-hidden="true">{f.emoji}</span>
                  <span className="truncate">{name}</span>
                  <CountBadge counts={familyCounts} k={f.slug} />
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Critères universels */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <h3 className="text-sm font-semibold">{tMap("criteriaTitle")}</h3>
        <ul className="space-y-0.5">
          {CRITERIA.map((c) => {
            const name = tFeat(c.key);
            return (
              <li key={c.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={selectedCriteria.has(c.key)}
                    onChange={() => toggleCriterion(c.key)}
                    className="h-3.5 w-3.5 cursor-pointer"
                    aria-label={name}
                  />
                  <span aria-hidden="true">{c.emoji}</span>
                  <span className="truncate">{name}</span>
                  <CountBadge counts={criteriaCounts} k={c.key} />
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Surface des terrains (#99) — filtre RPC sur venue_sport.surface */}
      <div className="flex flex-col gap-2 border-t pt-3">
        <h3 className="text-sm font-semibold">{tSurface("title")}</h3>
        <ul className="space-y-0.5">
          {SURFACES.map((s) => {
            const name = tSurface(s.key);
            return (
              <li key={s.key}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={selectedSurfaces.has(s.key)}
                    onChange={() => toggleSurface(s.key)}
                    className="h-3.5 w-3.5 cursor-pointer"
                    aria-label={name}
                  />
                  <span aria-hidden="true">{s.emoji}</span>
                  <span className="truncate">{name}</span>
                  <CountBadge counts={surfaceCounts} k={s.key} />
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Toggle mise à jour auto (recharge en pan/zoom) */}
      <div className="flex flex-col gap-1 border-t pt-3">
        <label className="flex cursor-pointer items-center justify-between gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
          <span className="font-medium">{tMap("autoUpdate")}</span>
          <input
            type="checkbox"
            checked={autoUpdate}
            onChange={(e) => onAutoUpdateChange(e.target.checked)}
            className="h-4 w-4 cursor-pointer"
            aria-label={tMap("autoUpdate")}
          />
        </label>
        <p className="px-1.5 text-[11px] leading-tight text-muted-foreground">
          {tMap("autoUpdateHint")}
        </p>
      </div>
    </aside>
  );
}
