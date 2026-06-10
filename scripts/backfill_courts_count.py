#!/usr/bin/env python3
"""
backfill_courts_count.py — Dérive venue.courts_count par regroupement d'adresse.

Issue #274 (prérequis du ranking /disciplines #265). Constat (vérifié en prod
2026-06-01) : courts_count est rempli sur ~0% des venues. Or 97% ont une
`address`, et les courts d'un même club partagent cette adresse — ex. 17 venues
« COURT DE TENNIS … 1/2/3 » à la même adresse = 17 courts du même établissement.

Stratégie : grouper les venues publiées par (city_id, address normalisée) au
sein d'une même FAMILLE, puis poser courts_count = taille du groupe sur chaque
venue du groupe. On NE touche PAS les venues sans adresse (on les laisse à NULL)
ni celles dont le courts_count actuel est déjà renseigné et cohérent.

On groupe PAR FAMILLE (family_slug) en plus de l'adresse : un complexe multisport
à une adresse unique ne doit pas compter ses terrains de foot comme des courts
de tennis. La granularité « courts » est par discipline/famille.

Dry-run par défaut (analyse + distribution). L'ÉCRITURE réelle se fait via la
migration SQL 0020_backfill_courts_count.sql (UPDATE de masse côté serveur) —
268k updates via l'API REST timeout en boucle. --apply ne fait donc qu'orienter
vers la migration.

Usage :
    pip install supabase python-dotenv          # ou via le venv du projet
    python3 scripts/backfill_courts_count.py --dry-run            # report only
    python3 scripts/backfill_courts_count.py --dry-run --limit 5000
    python3 scripts/backfill_courts_count.py --apply              # écrit en DB
"""
from __future__ import annotations

import argparse
import sys
import unicodedata
from collections import defaultdict
from typing import Iterable


def normalize_address(addr: str | None) -> str | None:
    """Normalise une adresse pour le regroupement : minuscules, sans accents,
    espaces compactés. None/vide → None (venue non groupable)."""
    if not addr:
        return None
    s = unicodedata.normalize("NFKD", addr).encode("ascii", "ignore").decode()
    s = " ".join(s.lower().split())
    return s or None


# Clé de groupe : (city_id, family_slug, adresse normalisée). Exposée pour les tests.
def group_key(venue: dict) -> tuple | None:
    addr = normalize_address(venue.get("address"))
    city_id = venue.get("city_id")
    # Sans city_id, l'adresse seule n'est PAS un identifiant fiable : des adresses
    # génériques ("le bourg", "centre village") existent à l'identique dans des
    # centaines de communes distinctes. Les grouper revient à fusionner des lieux
    # sans rapport → sur-comptage (incident : 137 venues "le bourg" comptées comme
    # un club de 137 courts). On ne groupe donc PAS les venues sans ville ; elles
    # restent ungroupables (cf. migration 0031 qui a remis leur courts_count à NULL).
    if addr is None or city_id is None:
        return None
    return (city_id, venue.get("family_slug"), addr)


# Plafond de plausibilité par famille (#555) : au-delà, le « groupe d'adresse »
# agrège presque sûrement au mauvais niveau (lieu-dit partagé, complexe
# municipal…) → on N'ÉCRIT PAS courts_count (on ne propage pas une valeur
# fausse). MIROIR des caps d'affichage de lib/venue/courts-plausibility.ts
# (#590) — garder les deux alignés.
FAMILY_MAX_COURTS: dict[str, int] = {
    "raquette": 40, "ballon": 30, "boules": 60, "baignade": 25, "combat": 20,
    "fitness": 30, "yoga": 30, "nautique": 30, "glisse": 20, "snow": 20,
    "hike": 20, "retraites": 20, "plus": 40,
}
DEFAULT_MAX_COURTS = 50


def compute_courts_counts(venues: list[dict]) -> dict[str, int]:
    """Mappe venue_id → courts_count dérivé (taille du groupe d'adresse).

    Les venues sans clé groupable (pas d'adresse) sont ignorées (absentes du
    dict de sortie → on ne les écrase pas). Les groupes au-delà du plafond de
    plausibilité de leur famille sont SKIPPÉS (#555). Logique pure, testable.
    """
    groups: dict[tuple, list[str]] = defaultdict(list)
    for v in venues:
        k = group_key(v)
        if k is None:
            continue
        groups[k].append(v["id"])

    out: dict[str, int] = {}
    for k, ids in groups.items():
        n = len(ids)
        family = k[1]
        if n > FAMILY_MAX_COURTS.get(family or "", DEFAULT_MAX_COURTS):
            continue  # agrégation suspecte → ne pas écrire (#555)
        for vid in ids:
            out[vid] = n
    return out


# ─── I/O DB (non testé — séparé de la logique pure) ──────────────────────────


def _load_env_client():
    import os
    from pathlib import Path

    try:
        from supabase import create_client
        from dotenv import load_dotenv
    except ImportError:
        print("❌ pip install supabase python-dotenv", file=sys.stderr)
        raise SystemExit(1)

    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
    load_dotenv()
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("❌ Définir NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        raise SystemExit(1)
    client = create_client(url, key)
    # Timeout PostgREST large : on pagine ~350k venues (700+ requêtes), chaque
    # page peut être lente sous charge → 120s évite les ReadTimeout (défaut court).
    # On agit sur le client httpx sous-jacent (l'API ClientOptions varie selon la
    # version de supabase-py, donc on règle le timeout directement et sûrement).
    try:
        client.postgrest.session.timeout = 120  # httpx.Client.timeout
    except Exception:
        pass
    return client


def fetch_all_venues(sb, limit: int | None) -> list[dict]:
    """Charge les venues publiées (id, address, city_id, family_slug,
    courts_count) en paginant. limit = cap total pour les tests."""
    rows: list[dict] = []
    # KEYSET pagination (WHERE id > dernier_id) plutôt qu'OFFSET : sur ~350k
    # venues, OFFSET élevé fait scanner+jeter N lignes par page → statement
    # timeout Postgres (57014) vers la page ~120. Le keyset reste O(page_size)
    # quel que soit l'avancement (index PK sur id). Pages de 1000.
    page_size = 1000
    last_id = ""
    while True:
        q = (
            sb.table("venue")
            .select("id, address, city_id, family_slug, courts_count")
            .eq("is_published", True)
            .is_("deleted_at", "null")
            .order("id")
            .limit(page_size)
        )
        if last_id:
            q = q.gt("id", last_id)
        chunk = q.execute().data or []
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if len(rows) % 20000 < page_size:
            print(f"    … {len(rows):,} venues chargées", flush=True)
        if limit and len(rows) >= limit:
            return rows[:limit]
    return rows


def chunked(seq: list, size: int) -> Iterable[list]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def run(args: argparse.Namespace) -> int:
    print(
        f"▶ backfill courts_count · {'APPLY' if args.apply else 'DRY-RUN'}"
        f"{f' · limit {args.limit}' if args.limit else ''}"
    )
    sb = _load_env_client()
    print("  ⏳ Chargement des venues publiées…")
    venues = fetch_all_venues(sb, args.limit)
    print(f"  ✓ {len(venues):,} venues chargées")

    counts = compute_courts_counts(venues)
    current = {v["id"]: v.get("courts_count") for v in venues}
    # Ne met à jour que si la valeur change (évite les writes inutiles).
    changes = {vid: n for vid, n in counts.items() if current.get(vid) != n}

    with_addr = sum(1 for v in venues if group_key(v) is not None)
    multi = sum(1 for n in counts.values() if n >= 2)
    print(f"  · venues groupables (adresse): {with_addr:,} ({100*with_addr//max(len(venues),1)}%)")
    print(f"  · venues dans un groupe ≥2 courts: {multi:,}")
    print(f"  · venues dont courts_count changerait: {len(changes):,}")

    if not args.apply:
        # Distribution des tailles de courts_count dérivées.
        from collections import Counter

        dist = Counter(counts.values())
        print("\n  🔎 DRY-RUN — distribution courts_count dérivé :")
        for size in sorted(dist)[:10]:
            print(f"      {size:>3} courts → {dist[size]:,} venues")
        print("\n  ✅ DRY-RUN terminé (aucune écriture). Relancer avec --apply.")
        return 0

    # APPLY désactivé : l'écriture de masse (~268k lignes) via l'API REST
    # PostgREST timeout en boucle (statement_timeout), et upsert({id,courts_count})
    # viole la contrainte NOT NULL sur slug (PostgREST le traite en INSERT).
    # → Le backfill réel se fait en SQL côté serveur via la migration
    #   supabase/migrations/0020_backfill_courts_count.sql (UPDATE … FROM … en
    #   une passe). Ce script reste utile pour le DRY-RUN (analyse + distribution).
    print(
        "\n  ⚠ --apply désactivé : l'écriture de masse passe par la migration SQL.\n"
        "    Appliquer : ./scripts/db-push.sh (0020_backfill_courts_count.sql).\n"
        f"    (dry-run ci-dessus : {len(changes):,} courts_count à dériver.)"
    )
    return 0


def self_test() -> int:
    """Tests de la logique pure (sans DB). Appelé en CI — le repo n'a pas
    d'infra pytest, on embarque la vérif dans le script lui-même."""
    assert normalize_address(None) is None
    assert normalize_address("") is None
    assert normalize_address("  12 RUE de la Paix  ") == "12 rue de la paix"
    assert normalize_address("Allée Châtelet") == "allee chatelet"
    assert group_key({"address": None, "city_id": "c1", "family_slug": "r"}) is None
    assert group_key({"address": "X", "city_id": "c1", "family_slug": "r"}) == ("c1", "r", "x")
    # Régression : sans city_id, une venue est ungroupable (sinon des adresses
    # génériques de communes distinctes fusionnent → sur-comptage, incident #274).
    assert group_key({"address": "le bourg", "city_id": None, "family_slug": "r"}) is None
    venues = [
        {"id": "a", "address": "1 rue X", "city_id": "c1", "family_slug": "raquette"},
        {"id": "b", "address": "1 rue X", "city_id": "c1", "family_slug": "raquette"},
        {"id": "c", "address": "1 rue X", "city_id": "c1", "family_slug": "raquette"},
        {"id": "d", "address": "1 rue X", "city_id": "c1", "family_slug": "ballon"},
        {"id": "e", "address": "1 rue X", "city_id": "c2", "family_slug": "raquette"},
        {"id": "f", "address": None, "city_id": "c1", "family_slug": "raquette"},
        # g & h : même adresse générique, ville inconnue, communes DIFFÉRENTES.
        # Ne doivent PAS être groupés (le bug d'origine les comptait comme 2).
        {"id": "g", "address": "le bourg", "city_id": None, "family_slug": "raquette"},
        {"id": "h", "address": "le bourg", "city_id": None, "family_slug": "raquette"},
    ]
    out = compute_courts_counts(venues)
    assert out["a"] == out["b"] == out["c"] == 3, out
    assert out["d"] == 1 and out["e"] == 1, out
    assert "f" not in out, out
    assert "g" not in out and "h" not in out, out
    # #555 — plafond de plausibilité : un « groupe » de 45 combat à la même
    # adresse (cap 20) = agrégation au mauvais niveau → AUCUN courts_count écrit.
    big = [
        {"id": f"x{i}", "address": "2 rue Y", "city_id": "c9", "family_slug": "combat"}
        for i in range(45)
    ]
    out_big = compute_courts_counts(big)
    assert out_big == {}, out_big
    # …mais 45 boules (cap 60) restent plausibles (grands boulodromes).
    big_boules = [
        {"id": f"y{i}", "address": "2 rue Y", "city_id": "c9", "family_slug": "boules"}
        for i in range(45)
    ]
    assert compute_courts_counts(big_boules)["y0"] == 45
    print("✓ backfill_courts_count self-test OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Backfill venue.courts_count (#274)")
    p.add_argument("--apply", action="store_true", help="Écrit en DB (sinon dry-run)")
    p.add_argument("--limit", type=int, default=None, help="Cap le nb de venues (test)")
    p.add_argument("--self-test", action="store_true", help="Teste la logique pure (CI)")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
