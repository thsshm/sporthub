/**
 * Génération de description structurée pour les fiches venue (#414).
 *
 * Produit une phrase lisible à partir des données structurées quand
 * `enrichments.description` est absent (venues OSM génériques, ex.
 * « Court de tennis 2 » sans description Wikipedia).
 *
 * Exemples de sortie :
 *   fr : « Court de tennis extérieur à Blagnac (France) — 16 terrains, éclairé,
 *          accès libre. »
 *   en : « Outdoor tennis court in Blagnac (France) — 16 courts, lit, free access. »
 *   zh : « 法国布拉尼亚克的户外网球场 — 16 片球场，有照明，免费进入。»
 *
 * Logique PURE (pas de traduction next-intl, pas d'I/O) → testable facilement.
 * Les chaînes i18n sont passées en paramètre par le composant appelant.
 */

export type DescriptionContext = {
  /** Nom du sport principal (ex. "tennis", "padel"). */
  sportName: string | null;
  /** Nom de la ville (ex. "Blagnac"). */
  cityName: string | null;
  /** Code pays ISO-2 (ex. "FR"). */
  countryCode: string | null;
  /** Nombre total de courts/terrains. */
  courtsCount: number | null;
  /** true = en intérieur, false = extérieur, null = inconnu. */
  isIndoor: boolean | null;
  /** true = éclairage. */
  hasLighting: boolean | null;
  /** false = entrée libre. */
  feeRequired: boolean | null;
};

export type DescriptionStrings = {
  /** "court de tennis" / "tennis court" / "网球场" etc. — traduit. */
  venueType: string;
  /** "intérieur" / "indoor" / "室内". */
  indoor: string;
  /** "extérieur" / "outdoor" / "户外". */
  outdoor: string;
  /** "dans" / "in" / "的". Préposition ville. */
  inCity: string;
  /** "{n} terrains" / "{n} courts" / "{n} 片球场". Utilise {n}. */
  courtsPattern: string;
  /** "éclairé" / "lit" / "有照明". */
  lit: string;
  /** "accès libre" / "free access" / "免费进入". */
  freeAccess: string;
  /** "payant" / "paid access" / "收费". */
  paidAccess: string;
};

/**
 * Génère une description d'une ligne à partir du contexte + des chaînes i18n.
 * Retourne `null` si le contexte est insuffisant (pas de sport, pas de ville).
 *
 * Format : « <type> [indoor/outdoor] à/in <ville> (<pays>) [— <features>]. »
 */
export function generateVenueDescription(
  ctx: DescriptionContext,
  strings: DescriptionStrings,
): string | null {
  if (!ctx.sportName && !strings.venueType) return null;

  const parts: string[] = [];

  // « <type> [intérieur/extérieur] »
  let subject = strings.venueType;
  if (ctx.isIndoor === true) subject = `${strings.indoor} ${subject}`;
  else if (ctx.isIndoor === false) subject = `${strings.outdoor} ${subject}`;
  parts.push(subject);

  // « à/in <ville> (<pays>) »
  if (ctx.cityName) {
    const country = ctx.countryCode ? ` (${ctx.countryCode})` : "";
    parts.push(`${strings.inCity} ${ctx.cityName}${country}`);
  }

  // Features
  const features: string[] = [];
  if (ctx.courtsCount && ctx.courtsCount > 1) {
    features.push(strings.courtsPattern.replace("{n}", String(ctx.courtsCount)));
  }
  if (ctx.hasLighting === true) features.push(strings.lit);
  if (ctx.feeRequired === false) features.push(strings.freeAccess);
  else if (ctx.feeRequired === true) features.push(strings.paidAccess);

  let sentence = parts.join(" ");
  if (features.length > 0) {
    sentence += ` — ${features.join(", ")}`;
  }
  sentence = sentence.trim();
  if (sentence && !sentence.endsWith(".")) sentence += ".";
  return sentence || null;
}
