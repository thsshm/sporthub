/**
 * Détection de WebGL — requis par MapLibre GL. Permet d'afficher un repli
 * lisible (message + alternatives) au lieu d'un canvas blanc quand le navigateur
 * n'a pas WebGL : accélération matérielle coupée, politique de sécurité, vieux
 * GPU, etc. (#466 / demande @thsshm « la carte doit s'afficher quel que soit le
 * paramétrage navigateur »).
 */

/**
 * Pur (testable) : vrai dès qu'un type de contexte WebGL renvoie un objet.
 * `getContext` peut renvoyer `null` OU lever selon le type et le navigateur →
 * on essaie successivement webgl2, webgl, puis experimental-webgl.
 */
export function hasWebGLContext(getContext: (type: string) => unknown): boolean {
  for (const type of ["webgl2", "webgl", "experimental-webgl"]) {
    try {
      if (getContext(type)) return true;
    } catch {
      // Certains navigateurs lèvent sur un type non supporté → essayer le suivant.
    }
  }
  return false;
}

/**
 * Côté client : WebGL est-il disponible ? SSR-safe (renvoie `true` côté serveur).
 * CONSERVATEUR : ne renvoie `false` que si la création de contexte échoue
 * explicitement → un navigateur fonctionnel n'est jamais dégradé par erreur.
 */
export function isWebGLAvailable(): boolean {
  if (typeof document === "undefined") return true;
  try {
    const canvas = document.createElement("canvas");
    return hasWebGLContext((type) => canvas.getContext(type));
  } catch {
    return true; // incertitude (ex. createElement indisponible) → ne PAS dégrader
  }
}
