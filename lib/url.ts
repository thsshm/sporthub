/**
 * Normalise une URL externe fournie par la data (OSM/RES/Overture…) en un href
 * SÛR pour un `<a href>`. La donnée brute peut être un domaine nu
 * (`exemple.fr`), une vraie URL, ou — pire — un schéma dangereux
 * (`javascript:…`, `data:…`) → vecteur XSS si rendu tel quel.
 *
 * Retourne :
 *   - une URL `http(s)` normalisée (domaine nu → préfixé `https://`) ;
 *   - `null` si vide, non parsable, ou d'un schéma autre que http/https.
 */
export function safeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  let candidate = s;
  if (!/^https?:\/\//i.test(s)) {
    // Un schéma explicite NON-http (javascript:, data:, mailto:, ftp:…) est
    // rejeté ; sinon on suppose un domaine nu → https://.
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
    candidate = `https://${s}`;
  }

  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
