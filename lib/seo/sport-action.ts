/**
 * Verbe d'action adapté au sport pour les pages sport×ville (#560).
 *
 * « Where to play » universel sonne faux : « where to play gym », « where to
 * play yoga ». On choisit un verbe par sport/famille :
 *   - gym/fitness, combat        → train (s'entraîner)
 *   - yoga, méditation           → practice (pratiquer)
 *   - spa, sauna, hammam         → relax (se détendre)
 *   - retraites                  → retreat (partir en retraite)
 *   - baignade                   → swim (nager)
 *   - reste (ballon, raquette…)  → play (jouer)
 *
 * Pur → testable. La clé renvoyée pointe vers `programmatic.action.<key>` en i18n.
 */
export type SportActionKey =
  | "play"
  | "train"
  | "practice"
  | "relax"
  | "retreat"
  | "swim";

// Surcharges par sport (priment sur la famille).
const SPORT_OVERRIDES: Record<string, SportActionKey> = {
  spa: "relax",
  sauna: "relax",
  hammam: "relax",
  yoga: "practice",
  meditation: "practice",
  swimming: "swim",
  pool: "swim",
};

// Défaut par famille.
const FAMILY_ACTION: Record<string, SportActionKey> = {
  fitness: "train",
  combat: "train",
  yoga: "practice", // famille « Bien-être » (spa/sauna/hammam surchargés en relax)
  retraites: "retreat",
  baignade: "swim",
};

export function sportActionKey(
  familySlug: string | null | undefined,
  sportSlug: string | null | undefined,
): SportActionKey {
  if (sportSlug && SPORT_OVERRIDES[sportSlug]) return SPORT_OVERRIDES[sportSlug];
  if (familySlug && FAMILY_ACTION[familySlug]) return FAMILY_ACTION[familySlug];
  return "play";
}
