/**
 * Helpers Wikimedia / Wikipedia pour la fiche venue (#107).
 *
 * - `wikimediaThumb(url, width)` : transforme une URL `upload.wikimedia.org`
 *   en URL de vignette à la largeur demandée. Utilise le query param `?width=N`
 *   supporté par les variantes spéciales `/wiki/Special:FilePath/...` et le
 *   query string de l'image originale.
 *
 *   Stratégie : si l'URL pointe vers `upload.wikimedia.org` (URL canonique
 *   d'une image Commons), on génère une URL `Special:FilePath` paramétrée
 *   en `width` via `commons.wikimedia.org/wiki/Special:FilePath/<filename>?width=N`.
 *   Sinon, on renvoie l'URL telle quelle (fallback gracieux).
 *
 * - `truncate(text, max)` : tronque proprement à la frontière de mot, ajoute "…".
 */

/**
 * Génère une URL de vignette Wikimedia à la largeur demandée. Si l'URL
 * d'entrée ne pointe pas vers Wikimedia (upload ou commons), renvoie l'URL
 * d'origine inchangée — comportement gracieux.
 */
export function wikimediaThumb(
  url: string | null | undefined,
  width: number,
): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  // URL canonique upload.wikimedia.org : on extrait le filename et on génère
  // une URL Special:FilePath qui supporte ?width=N.
  if (parsed.hostname === "upload.wikimedia.org") {
    const parts = parsed.pathname.split("/");
    const filename = parts[parts.length - 1];
    if (!filename) return url;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=${width}`;
  }

  // URL déjà sous forme Special:FilePath — on ajoute / remplace `width`.
  if (
    parsed.hostname === "commons.wikimedia.org" &&
    parsed.pathname.startsWith("/wiki/Special:FilePath/")
  ) {
    parsed.searchParams.set("width", String(width));
    return parsed.toString();
  }

  return url;
}

/**
 * Tronque un texte à la frontière de mot la plus proche de `max`, ajoute
 * une ellipse "…" si tronqué. Retourne la chaîne d'origine si déjà <= max.
 */
export function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const slice = trimmed.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + "…";
}
