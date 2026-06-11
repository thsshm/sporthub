/**
 * Normalisation d'affichage des NOMS de venue (#658, généralise #588).
 *
 * Les sources publiques (OSM, RES) livrent souvent des noms d'équipement bruts
 * tout en minuscules (« courts de tennis couverts », « court de tennis béton
 * poreux ») utilisés tels quels comme titres de card et H1 de fiche → ça fait
 * « ligne de base de données », nuit à la confiance et au SEO.
 *
 * `formatVenueName` passe ces noms en CASSE PHRASE (1ʳᵉ lettre en majuscule),
 * pas en casse-titre mot-à-mot (qui donnerait « Courts De Tennis Couverts »,
 * faux en français). Conservateur, comme `formatCityName` (#559) :
 *   - noms déjà en casse MIXTE (« Roland-Garros », « TC Paris 15 ») → gardés
 *     intacts (on fait confiance à la source : noms propres) ;
 *   - noms TOUT EN MAJUSCULES (« COURT DE PADEL ») → gardés tels quels : on ne
 *     peut pas distinguer un acronyme (« TC PARIS ») d'une description criée,
 *     et casser « TC PARIS » en « Tc paris » serait pire. Hors périmètre
 *     (l'issue cible explicitement les noms *lowercase*).
 *
 * Purement présentationnel : ne modifie JAMAIS la donnée stockée ni les slugs.
 * Le retrait des suffixes d'équipement dupliqués (« piste 1 », « 2 ») relève du
 * regroupement court→club (#635), pas de cette fonction.
 */
export function formatVenueName(name: string | null | undefined): string {
  const s = (name ?? "").trim();
  if (!s) return "";
  // Pas de lettre (ex. « 12 ») → rien à capitaliser.
  if (!/\p{L}/u.test(s)) return s;
  // Pas entièrement en minuscules (casse mixte ou tout-majuscule) → on garde.
  if (s !== s.toLowerCase()) return s;
  // Tout-minuscule → casse phrase : majuscule sur la 1ʳᵉ lettre, reste inchangé
  // (déjà minuscule). `\p{L}` préserve les accents (é, è…).
  return s.replace(/\p{L}/u, (c) => c.toUpperCase());
}
