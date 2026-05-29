/**
 * Slugification stable pour les venues importés via cron.
 *
 * Port direct de la fonction `slugify()` Python utilisée par
 * `scripts/import_v1.py` — on garde EXACTEMENT le même algorithme pour que
 * deux imports (Python ou Node) sur la même donnée produisent le même slug,
 * et donc la même clé d'upsert côté DB.
 *
 * Algorithme :
 *   1. Normalise NFKD (sépare les diacritiques) puis enlève les non-ASCII
 *   2. Remplace tout ce qui n'est pas [a-zA-Z0-9] par des tirets
 *   3. Trim les tirets en début/fin
 *   4. Lowercase
 *   5. Fallback "untitled" si chaîne vide
 *
 * Le venue.slug est UNIQUE (cf. supabase/migrations/0001_initial_schema.sql),
 * d'où la stratégie `{slug-base}-{external-id-suffix}` pour garantir l'unicité
 * sans collision entre sources différentes.
 */

export function slugify(input: string): string {
  const normalized = (input || "")
    // NFKD : décompose les caractères accentués (é → e + ◌́)
    .normalize("NFKD")
    // Supprime les diacritiques résultants (toute la range Unicode Mn)
    .replace(/[̀-ͯ]/g, "")
    // Tout caractère non ASCII alphanumérique → tiret
    .replace(/[^a-zA-Z0-9]+/g, "-")
    // Trim des tirets
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return normalized || "untitled";
}

/**
 * Construit un slug stable pour un venue importé d'une source externe.
 * `externalSuffix` est typiquement l'ID source (ex: "hyrox/12345", "pge/678",
 * "osm/node/12345"). On en garde au plus 30 chars pour rester court.
 */
export function venueSlugFromName(name: string, externalSuffix: string): string {
  // Cas dégénéré : ni nom ni id source utilisable → fallback unique stable.
  // On évite "untitled-untitled" en court-circuitant si les deux sont vides.
  const hasName = name && name.trim().length > 0;
  const hasSuffix = externalSuffix && externalSuffix.trim().length > 0;
  if (!hasName && !hasSuffix) return "untitled";

  const nameSlug = slugify(name).slice(0, 80);
  const suffix = slugify(externalSuffix).slice(0, 30);
  // Slug = "{name}-{suffix}", cappé à 120 chars (cf. import_v1.py).
  const out = `${nameSlug}-${suffix}`.slice(0, 120);
  return out.replace(/-+$/g, "") || "untitled";
}
