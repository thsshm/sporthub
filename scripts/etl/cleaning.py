"""#463 — nettoyage à l'ingestion : écarte les records visiblement mal classés.

Constat (audit 08/06, pages tennis & padel) : des lieux de **pêche / golf /
boules** se retrouvent classés en sport de raquette (padel surtout), et des
**boulodromes** en tennis. Ces erreurs polluent les pages indexables.

Heuristique CONSERVATRICE — on ne rejette un record QUE si son nom signale
fortement un sport d'une FAMILLE DIFFÉRENTE de celle du sport assigné (ex. pêche
≠ raquette), et ne signale pas le sport assigné. On ne touche PAS aux ambiguïtés
INTRA-famille (padel vs tennis vs squash) : un court de padel dans un « Tennis
Club » est légitime → un filtre nom y ferait des faux négatifs. Ces cas relèvent
de la passe de scoring + revue manuelle (côté DB, cf. reste de #463).

Module PUR (aucune I/O) → testable via `--self-test`.
"""

from __future__ import annotations

import re
import unicodedata


def _norm(s: str) -> str:
    """minuscule + sans accents, pour des comparaisons de sous-chaînes robustes."""
    if not s:
        return ""
    decomposed = unicodedata.normalize("NFKD", s)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()


# Famille SportHub de chaque sport pouvant servir de "signal" dans un nom.
# `fishing` n'est pas une famille SportHub → sentinelle "_autre" (toujours
# inter-familles donc).
_SPORT_FAMILY: dict[str, str] = {
    "tennis": "raquette",
    "padel": "raquette",
    "squash": "raquette",
    "badminton": "raquette",
    "table_tennis": "raquette",
    "boules": "boules",
    "golf": "plus",
    "fishing": "_autre",
}

# Sous-chaînes (NORMALISÉES, sans accents) signalant fortement un sport dans un
# nom de lieu. Termes peu ambigus uniquement (conservateur).
# Ordre des clés : `table_tennis` avant `tennis` n'importe pas (on teste tout).
_NAME_SIGNALS: dict[str, tuple[str, ...]] = {
    "tennis": ("tennis",),
    "padel": ("padel",),
    "squash": ("squash",),
    "badminton": ("badminton",),
    "table_tennis": ("tennis de table", "ping pong", "ping-pong"),
    "boules": ("petanque", "boulodrome", "boule lyonnaise", "boules lyonnaises"),
    "golf": ("golf",),
    "fishing": ("etang de peche", "etang de la peche", "peche", "pisciculture"),
}


# Frontières de MOT (sur la chaîne normalisée, déjà en minuscules ASCII) — PAS
# de simple sous-chaîne, sinon faux positifs : « golf » ⊂ « montgolfière »,
# « peche » ⊂ « pêchers » (lieu-dit), etc. (#463 — vérifié en prod).
_SIGNAL_PATTERNS: dict[str, list[re.Pattern[str]]] = {
    sport: [re.compile(r"(?<![a-z])" + re.escape(t) + r"(?![a-z])") for t in terms]
    for sport, terms in _NAME_SIGNALS.items()
}


def _signaled_sports(name_norm: str) -> set[str]:
    """Sports dont au moins un terme-signal apparaît comme MOT dans le nom normalisé."""
    out: set[str] = set()
    for sport, pats in _SIGNAL_PATTERNS.items():
        if any(p.search(name_norm) for p in pats):
            out.add(sport)
    return out


def misclassification_reason(name: str, sport: str | None) -> str | None:
    """Retourne le terme/sport conflictuel si `name` indique clairement un sport
    d'une AUTRE famille que `sport`, sinon None.

    Conservateur :
      - ne se prononce que si le sport assigné est connu de `_SPORT_FAMILY` ;
      - garde le record si le nom signale aussi le sport assigné (ex. complexe
        multi-sport « Tennis & Padel ») ;
      - n'écarte que sur un signal INTER-familles (ex. « pêche » sur un padel).
    """
    fam_assigned = _SPORT_FAMILY.get(sport or "")
    if fam_assigned is None:
        return None  # sport non surveillé → on ne tranche pas

    name_norm = _norm(name)
    if not name_norm:
        return None

    signaled = _signaled_sports(name_norm)
    if not signaled or sport in signaled:
        return None  # aucun signal, ou le nom confirme le sport assigné → on garde

    # On ne rejette que sur un conflit INTER-familles (intra-famille = ambigu,
    # on laisse passer pour ne pas perdre de vrais lieux multi-sport).
    cross = [s for s in signaled if _SPORT_FAMILY.get(s, "_autre") != fam_assigned]
    if not cross:
        return None
    other = sorted(cross)[0]
    return f"nom signale '{other}' (famille {_SPORT_FAMILY[other]}) ≠ sport assigné '{sport}' ({fam_assigned})"


def is_misclassified(name: str, sport: str | None) -> bool:
    return misclassification_reason(name, sport) is not None


# ── Self-test ────────────────────────────────────────────────────────────────
def self_test() -> int:
    keep = [
        ("Padel Club Lyon", "padel"),
        ("Tennis Club de Paris", "tennis"),
        ("Complexe Tennis & Padel", "padel"),  # signale aussi padel → garde
        ("Le Squash Center", "squash"),
        ("Boulodrome municipal", "boules"),
        ("Salle omnisport", "padel"),  # aucun signal → garde
        ("Dojo du Centre", "judo"),  # sport non surveillé → garde
        ("Tennis de Table Annecy", "table_tennis"),  # signale assigné → garde
        # #463 — frontières de mot : ne PAS matcher ces sous-chaînes innocentes :
        ("Jardin de la Montgolfière", "padel"),  # 'golf' ⊂ montgolfière → garde
        ("Complexe sportif des Grands Pêchers", "tennis"),  # 'peche' ⊂ pêchers → garde
        ("Salle Decathlon", "padel"),  # 'cathlon'… aucun terme entier → garde
    ]
    drop = [
        ("Étang de pêche du Moulin", "padel"),  # pêche → padel : inter-familles
        ("Squash & Pêche ... pisciculture", "padel"),
        ("Boulodrome lyonnais", "tennis"),  # boules classé tennis (#463)
        ("Golf de Saint-Cloud", "padel"),  # golf classé padel
        ("Tennis Club Lyon", "padel"),  # tennis (raquette) vs padel… même famille → NON
    ]
    ok = True
    for n, s in keep:
        if is_misclassified(n, s):
            print(f"  ✗ KEEP raté : {n!r} ({s}) → {misclassification_reason(n, s)}")
            ok = False
    # NB : le dernier cas de `drop` est en réalité INTRA-famille (raquette) →
    # doit être GARDÉ (conservateur). On le vérifie explicitement.
    intra = ("Tennis Club Lyon", "padel")
    if is_misclassified(*intra):
        print(f"  ✗ intra-famille rejeté à tort : {intra}")
        ok = False
    for n, s in drop[:-1]:
        if not is_misclassified(n, s):
            print(f"  ✗ DROP raté : {n!r} ({s}) aurait dû être écarté")
            ok = False
    print("✓ cleaning self-test OK" if ok else "✗ cleaning self-test FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(self_test())
