#!/usr/bin/env python3
"""
backfill_primary_sport.py — déduit `venue.primary_sport_slug` quand il est NULL.

Problème : ~7-9 % des venues ont `primary_sport_slug` NULL (vérifié via l'API
carte : 68/1000 à Paris, 75/789 à Lyon). Les pages /[sport]/[pays]/[ville]
filtrent sur `primary_sport_slug` → ces venues n'apparaissent sur AUCUNE page
sport, alors qu'elles ont souvent un (ou des) sport(s) dans `venue_sport`.

Fix : pour chaque venue publiée à `primary_sport_slug` NULL, promouvoir un sport
de `venue_sport` comme primaire (priorité is_primary, puis le plus de courts,
puis le 1er). On ne touche QUE les NULL → idempotent. On NE modifie PAS
`family_slug` (la page ne le filtre pas) — cohérence famille = chantier séparé.

Dry-run par défaut (chiffre le scope) ; --apply pour écrire. Pattern d'écriture
groupée par valeur (cf. backfill_courts_count_rest.py #274).

Env (GitHub Actions) : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Stdlib only.
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# Mots-clés de NOM → sport canonique. Ordre = du plus spécifique au plus large
# (1ʳᵉ correspondance gagne). Mots entiers (\b) pour limiter les faux positifs ;
# multilingue FR/EN. Restreint à des sports SANS ambiguïté. La cohérence avec la
# famille de la venue est vérifiée en plus (classify_by_name) → garde-fou.
_NAME_SPORT_PATTERNS = [
    (r"brazilian jiu[- ]?jitsu", "bjj"),
    (r"jiu[- ]?jitsu", "bjj"),
    (r"bjj", "bjj"),
    (r"jjb", "bjj"),
    (r"grappling", "bjj"),
    # Arts martiaux ajoutés (#645). Disciplines SPÉCIFIQUES avant le générique
    # `martial_arts` (1ʳᵉ correspondance gagne) ; kickboxing AVANT boxing.
    (r"tae?[- ]?kwon[- ]?do", "taekwondo"),
    (r"taekwondo", "taekwondo"),
    (r"hapkido", "taekwondo"),
    (r"tang soo do", "taekwondo"),
    (r"a[iï]kido", "aikido"),
    (r"kung[- ]?fu", "kung_fu"),
    (r"wing chun", "kung_fu"),
    (r"wushu", "kung_fu"),
    (r"shaolin", "kung_fu"),
    (r"krav[- ]?maga", "krav_maga"),
    (r"capoeira", "capoeira"),
    (r"kendo", "kendo"),
    (r"iaido", "kendo"),
    (r"kick[- ]?box\w*", "kickboxing"),
    (r"muay[- ]?thai", "kickboxing"),
    (r"tai[- ]?chi", "taichi"),
    (r"qi[- ]?gong", "taichi"),
    (r"boxing", "boxing"),
    (r"boxe", "boxing"),
    (r"boxeo", "boxing"),
    (r"judo", "judo"),
    (r"karat[eé]", "karate"),
    (r"mixed martial arts?", "mma"),
    (r"mma", "mma"),
    # Générique : seulement si aucune discipline spécifique n'a matché.
    (r"martial arts?", "martial_arts"),
    (r"arts? martiaux", "martial_arts"),
    (r"dojo", "martial_arts"),
    (r"budo", "martial_arts"),
    (r"padel", "padel"),
    (r"squash", "squash"),
    (r"badminton", "badminton"),
    (r"crossfit", "crossfit"),
    (r"pilates", "pilates"),
    (r"p[eé]tanque", "petanque"),
    (r"golf", "golf"),
    (r"tennis de table|ping[- ]?pong", "table_tennis"),
]
_NAME_SPORT_RE = [(re.compile(r"\b" + p + r"\b", re.IGNORECASE), s)
                  for p, s in _NAME_SPORT_PATTERNS]

# Disciplines pour l'ANALYSE seule (#645/#613 taxonomie) — chiffrer quels NOUVEAUX
# sports ajouter. NE classe RIEN (beaucoup n'ont pas de slug) : 1ʳᵉ correspondance
# gagne, sur le nom (insensible à la casse). Élargi exprès au-delà de la taxo.
_DISCIPLINE_ANALYSIS = [
    ("taekwondo", r"tae?\s?kwon[\s-]?do|taekwondo|\btkd\b|hapkido|soo\s?bahk|tang\s?soo\s?do"),
    ("aikido", r"a[iï]kido|ai[\s-]?ki[\s-]?do"),
    ("karate", r"karat[eé]|shotokan|kyokushin|goju[\s-]?ryu|shito[\s-]?ryu|wado"),
    ("kung_fu", r"kung[\s-]?fu|wing[\s-]?chun|wushu|shaolin|sanda|jeet[\s-]?kune"),
    ("taichi", r"tai[\s-]?chi|t[aā]i[\s-]?ji|qi[\s-]?gong|chi[\s-]?gong"),
    ("krav_maga", r"krav[\s-]?maga"),
    ("self_defense", r"self[\s-]?defen|d[ée]fense\s?personnelle|self[\s-]?defence"),
    ("bjj", r"brazilian\s?jiu|jiu[\s-]?jitsu|\bbjj\b|\bjjb\b|gracie|grappling|no[\s-]?gi|luta\s?livre"),
    ("judo", r"\bjudo\b"),
    ("kickboxing", r"kick[\s-]?box|muay[\s-]?thai|muaythai|boxe\s?tha[iï]|\bk-?1\b|full[\s-]?contact|savate"),
    ("boxing", r"\bboxe\b|boxing|boxeo|pugilat"),
    ("mma", r"\bmma\b|mixed\s?martial|free[\s-]?fight"),
    ("kendo", r"kendo|iaido|kenjutsu|naginata|kyudo"),
    ("capoeira", r"capoeira"),
    ("wrestling", r"wrestl|\blutte\b|\bcatch\b|sambo"),
    ("fencing", r"escrime|fencing|sabre|fleuret|[ée]p[ée]e"),
    ("nunchaku_weapons", r"nunchaku|kobudo|eskrima|kali\b|arnis"),
    ("martial_generic", r"martial\s?art|arts?\s?martiaux|\bdojo\b|\bbudo\b|\bryu\b|\bcombat\b"),
    # quelques non-combat → mesurer le résidu hors arts martiaux
    ("dance", r"\bdanse\b|\bdance\b|ballet|zumba|salsa"),
    ("climbing", r"escalade|climbing|bouldering|grimpe"),
    ("yoga_pilates", r"\byoga\b|pilates"),
    ("padel", r"\bpadel\b"),
    ("fitness", r"fitness|muscu|crossfit|gym\b"),
]
_DISCIPLINE_ANALYSIS_RE = [(lbl, re.compile(rx, re.IGNORECASE)) for lbl, rx in _DISCIPLINE_ANALYSIS]


def classify_by_name(name: str | None, family_slug: str | None,
                     sport_family: dict[str, str]) -> str | None:
    """Sport canonique déduit du NOM, SEULEMENT s'il est cohérent avec la famille
    déjà attribuée à la venue (pur, testable). None sinon → on ne fabrique rien."""
    if not name:
        return None
    for rgx, sport in _NAME_SPORT_RE:
        if rgx.search(name):
            return sport if sport_family.get(sport) == family_slug else None
    return None


# ── Logique pure (testée) ───────────────────────────────────────────────────────
def derive_primary_sport(venue_sports: list[dict]) -> str | None:
    """Sport à promouvoir primaire. Priorité : is_primary, puis +de courts, puis
    1er. None si aucun sport exploitable."""
    cands = [vs for vs in (venue_sports or []) if vs.get("sport_slug")]
    if not cands:
        return None
    primary = [vs for vs in cands if vs.get("is_primary")]
    if primary:
        return primary[0]["sport_slug"]
    cands.sort(key=lambda vs: -(vs.get("courts_count") or 0))
    return cands[0]["sport_slug"]


def plan_primary(venues: list[dict]) -> dict[str, str]:
    """{venue_id: sport_slug} pour les venues réparables (pur, testable)."""
    out: dict[str, str] = {}
    for v in venues:
        sport = derive_primary_sport(v.get("venue_sport") or [])
        if sport:
            out[v["id"]] = sport
    return out


# ── REST Supabase (service-role) ────────────────────────────────────────────────
def load_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    f = Path(__file__).resolve().parent.parent / ".env.local"
    if f.exists():
        for line in f.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    url = (os.getenv("SUPABASE_URL") or env.get("NEXT_PUBLIC_SUPABASE_URL")
           or env.get("SUPABASE_URL", ""))
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        print("❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants", file=sys.stderr)
        raise SystemExit(1)
    return url.rstrip("/"), key


def req(url, key, method="GET", path="", body=None, prefer=None, timeout=120, retries=5):
    headers = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url + "/rest/v1/" + path, data=data,
                                       headers=headers, method=method)
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code not in (408, 429, 500, 502, 503, 504):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
        time.sleep(min(2 ** attempt, 20))
    raise last


def fetch_null_primary(url, key, limit=None) -> list[dict]:
    """Venues publiées, non supprimées, primary_sport_slug NULL, + leur
    venue_sport embarqué (sport_slug, is_primary, courts_count)."""
    rows, last_id, page = [], "", 1000
    while True:
        path = (
            "venue?select=id,venue_sport(sport_slug,is_primary,courts_count)"
            "&primary_sport_slug=is.null&is_published=eq.true&deleted_at=is.null"
            f"&order=id.asc&limit={page}"
        )
        if last_id:
            path += f"&id=gt.{last_id}"
        chunk = json.loads(req(url, key, path=path))
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if limit and len(rows) >= limit:
            return rows[:limit]
        if len(rows) % 20000 < page:
            print(f"    … {len(rows):,} venues NULL chargées", flush=True)
        if len(chunk) < page:
            break
    return rows


def load_sport_family(url, key) -> dict[str, str]:
    """{sport_slug: family_slug} depuis la table de référence `sport`."""
    rows = json.loads(req(url, key, path="sport?select=slug,family_slug&limit=1000"))
    return {r["slug"]: r.get("family_slug") for r in rows if r.get("slug")}


def fetch_null_named(url, key, limit=None) -> list[dict]:
    """Venues publiées, primary_sport_slug NULL, avec id/name/family_slug."""
    rows, last_id, page = [], "", 1000
    while True:
        path = ("venue?select=id,name,family_slug&primary_sport_slug=is.null"
                "&is_published=eq.true&deleted_at=is.null"
                f"&order=id.asc&limit={page}")
        if last_id:
            path += f"&id=gt.{last_id}"
        chunk = json.loads(req(url, key, path=path))
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if limit and len(rows) >= limit:
            return rows[:limit]
        if len(rows) % 20000 < page:
            print(f"    … {len(rows):,} venues chargées", flush=True)
        if len(chunk) < page:
            break
    return rows


def apply_primary(url, key, assignments: dict[str, str], chunk=120) -> int:
    """PATCH groupés PAR sport : venue?id=in.(ids) SET primary_sport_slug=<sport>."""
    by_sport: dict[str, list[str]] = {}
    for vid, sport in assignments.items():
        by_sport.setdefault(sport, []).append(vid)
    written = 0
    for sport, ids in by_sport.items():
        for i in range(0, len(ids), chunk):
            batch = ids[i:i + chunk]
            path = f"venue?id=in.({','.join(batch)})"
            req(url, key, method="PATCH", path=path,
                body={"primary_sport_slug": sport}, prefer="return=minimal")
            written += len(batch)
    return written


def sample_unclassified(args: argparse.Namespace) -> int:
    """Lecture seule : échantillon des venues NULL pour juger la classifiabilité
    (nom, family_slug, tags OSM `sport`/`leisure`/`amenity`)."""
    url, key = load_env()
    n = args.sample or 400
    path = (
        "venue?select=id,name,family_slug,enrichments"
        "&primary_sport_slug=is.null&is_published=eq.true&deleted_at=is.null"
        f"&order=id.asc&limit={n}"
    )
    rows = json.loads(req(url, key, path=path))
    fam = collections.Counter(r.get("family_slug") for r in rows)
    osm_sport = collections.Counter()
    leisure = collections.Counter()
    n_sport_tag = n_leisure = 0
    examples = []
    for r in rows:
        tags = ((r.get("enrichments") or {}).get("raw_tags")) or {}
        sp = tags.get("sport")
        lz = tags.get("leisure") or tags.get("amenity")
        if sp:
            n_sport_tag += 1
            osm_sport[sp] += 1
        if lz:
            n_leisure += 1
            leisure[lz] += 1
        if len(examples) < 18:
            examples.append((r.get("name"), r.get("family_slug"), sp, lz))
    print(f"▶ échantillon de {len(rows)} venues sans primary_sport_slug\n")
    print(f"  avec tag OSM `sport`   : {n_sport_tag}/{len(rows)} "
          f"({100*n_sport_tag//max(1,len(rows))}%) → top: {dict(osm_sport.most_common(12))}")
    print(f"  avec tag leisure/amenity: {n_leisure}/{len(rows)} → top: {dict(leisure.most_common(10))}")
    print(f"  familles : {dict(fam.most_common(14))}")
    print("\n  exemples (nom | famille | tag sport | leisure) :")
    for name, f, sp, lz in examples:
        print(f"     {str(name)[:42]:42} | {str(f):10} | {str(sp):14} | {lz}")
    return 0


# ── Pipeline ────────────────────────────────────────────────────────────────────
def run_by_name(args: argparse.Namespace) -> int:
    """Classe par NOM (sport canonique cohérent avec la famille). Dry-run/apply."""
    url, key = load_env()
    sport_family = load_sport_family(url, key)
    print(f"▶ {len(sport_family)} sports référencés ; chargement des venues NULL…")
    venues = fetch_null_named(url, key, limit=args.limit)
    print(f"  ✓ {len(venues):,} venues à primary_sport NULL")

    assignments: dict[str, str] = {}
    for v in venues:
        sport = classify_by_name(v.get("name"), v.get("family_slug"), sport_family)
        if sport:
            assignments[v["id"]] = sport
    dist = collections.Counter(assignments.values())
    print(f"\n  classées par nom (sûres, cohérentes famille) : {len(assignments):,}"
          f" ({100*len(assignments)//max(1,len(venues))}%)")
    print(f"  par sport : {dict(dist.most_common(20))}")

    if args.apply:
        written = apply_primary(url, key, assignments, chunk=args.chunk)
        print(f"\n✅ APPLY — {written:,} venues classées par nom.")
    else:
        print("\n✅ DRY-RUN — aucune écriture. Relancer avec --apply pour écrire.")
    return 0


def run_distribution(args: argparse.Namespace) -> int:
    """Lecture seule (#645) : distribution des DISCIPLINES (mots-clés de nom) sur
    les venues NULL, pour décider quels NOUVEAUX sports ajouter. N'écrit/ne classe
    rien — purement informatif (la plupart n'ont pas de slug existant)."""
    url, key = load_env()
    print("▶ chargement des venues NULL (analyse disciplines)…")
    venues = fetch_null_named(url, key, limit=args.limit)
    print(f"  ✓ {len(venues):,} venues à primary_sport NULL\n")

    disc: collections.Counter = collections.Counter()
    disc_family: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    unmatched_family: collections.Counter = collections.Counter()
    matched = 0
    for v in venues:
        name = v.get("name") or ""
        fam = v.get("family_slug") or "?"
        hit = next((lbl for lbl, rx in _DISCIPLINE_ANALYSIS_RE if rx.search(name)), None)
        if hit:
            matched += 1
            disc[hit] += 1
            disc_family[hit][fam] += 1
        else:
            unmatched_family[fam] += 1

    total = max(1, len(venues))
    print(f"  reconnues par mot-clé : {matched:,} ({100 * matched // total}%)"
          f"  ·  non reconnues : {len(venues) - matched:,}")
    print("\n  ── disciplines par volume (candidates à un slug sport) ──")
    for lbl, n in disc.most_common(25):
        topfam = dict(disc_family[lbl].most_common(3))
        print(f"    {lbl:18} {n:6,}   familles: {topfam}")
    print("\n  ── non reconnues, par famille ──")
    print(f"    {dict(unmatched_family.most_common(14))}")
    return 0


def run(args: argparse.Namespace) -> int:
    url, key = load_env()
    print("▶ chargement des venues sans primary_sport_slug…")
    venues = fetch_null_primary(url, key, limit=args.limit)
    print(f"  ✓ {len(venues):,} venues à primary_sport NULL")

    assignments = plan_primary(venues)
    n = len(assignments)
    unfixable = len(venues) - n
    dist = collections.Counter(assignments.values())
    print(f"\n  réparables (≥1 sport dans venue_sport) : {n:,}")
    print(f"  non réparables (aucun venue_sport)       : {unfixable:,}")
    print(f"  sports promus (top) : {dict(dist.most_common(12))}")

    if args.apply:
        written = apply_primary(url, key, assignments, chunk=args.chunk)
        print(f"\n✅ APPLY — {written:,} venues ont reçu un primary_sport_slug.")
    else:
        print("\n✅ DRY-RUN — aucune écriture. Relancer avec --apply pour écrire.")
    return 0


def self_test() -> int:
    # is_primary prioritaire
    assert derive_primary_sport([
        {"sport_slug": "padel", "is_primary": False, "courts_count": 9},
        {"sport_slug": "tennis", "is_primary": True, "courts_count": 1},
    ]) == "tennis"
    # sinon le plus de courts
    assert derive_primary_sport([
        {"sport_slug": "padel", "is_primary": False, "courts_count": 2},
        {"sport_slug": "tennis", "is_primary": False, "courts_count": 8},
    ]) == "tennis"
    # sinon le premier ; ignore les entrées sans slug ; None si vide
    assert derive_primary_sport([{"sport_slug": "yoga"}, {"sport_slug": None}]) == "yoga"
    assert derive_primary_sport([]) is None
    assert derive_primary_sport([{"is_primary": True}]) is None  # pas de slug

    plan = plan_primary([
        {"id": "v1", "venue_sport": [{"sport_slug": "tennis", "is_primary": True}]},
        {"id": "v2", "venue_sport": []},   # non réparable
        {"id": "v3", "venue_sport": [{"sport_slug": "padel", "courts_count": 3}]},
    ])
    assert plan == {"v1": "tennis", "v3": "padel"}, plan

    # classify_by_name : sport canonique nommé + cohérent avec la famille.
    sf = {"karate": "combat", "judo": "combat", "boxing": "combat", "bjj": "combat",
          "mma": "combat", "taekwondo": "combat", "aikido": "combat", "kung_fu": "combat",
          "krav_maga": "combat", "kickboxing": "combat", "capoeira": "combat",
          "taichi": "combat", "kendo": "combat", "martial_arts": "combat",
          "yoga": "yoga", "padel": "raquette"}
    assert classify_by_name("Academia de Karate Ronin", "combat", sf) == "karate"
    assert classify_by_name("Brazilian Jiu-Jitsu Lyon", "combat", sf) == "bjj"
    assert classify_by_name("Boxing Club Paris", "combat", sf) == "boxing"
    # incohérence famille (karate dans une venue 'glisse') → on NE classe PAS
    assert classify_by_name("Karate Surf Shop", "glisse", sf) is None
    # arts martiaux ajoutés (#645) : disciplines spécifiques classées.
    assert classify_by_name("Aikido Kouvola", "combat", sf) == "aikido"
    assert classify_by_name("Taekwondo Club Lyon", "combat", sf) == "taekwondo"
    assert classify_by_name("École Tang Soo Do", "combat", sf) == "taekwondo"
    assert classify_by_name("Wing Chun Académie", "combat", sf) == "kung_fu"
    assert classify_by_name("Krav Maga Défense", "combat", sf) == "krav_maga"
    assert classify_by_name("Kickboxing Gym", "combat", sf) == "kickboxing"
    # le spécifique l'emporte sur le générique : kickboxing ≠ boxing.
    assert classify_by_name("Muay Thai Camp", "combat", sf) == "kickboxing"
    # générique seulement si aucune discipline : « dojo / arts martiaux » → martial_arts.
    assert classify_by_name("Dojo des Arts Martiaux", "combat", sf) == "martial_arts"
    assert classify_by_name("Stade municipal", "ballon", sf) is None
    assert classify_by_name(None, "combat", sf) is None
    # mot entier : 'mmaison' ne matche pas 'mma'
    assert classify_by_name("La Mmaison du Sport", "combat", sf) is None

    print("✓ backfill_primary_sport self-test OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Déduit primary_sport_slug NULL depuis venue_sport")
    p.add_argument("--apply", action="store_true", help="Écrit en DB (sinon dry-run)")
    p.add_argument("--limit", type=int, default=None, help="Cap venues (smoke test)")
    p.add_argument("--chunk", type=int, default=120, help="ids par PATCH")
    p.add_argument("--sample", type=int, default=0,
                   help="Lecture seule : échantillonne N venues NULL (nom/tags/famille)")
    p.add_argument("--by-name", action="store_true",
                   help="Classe par NOM (sport canonique cohérent avec la famille)")
    p.add_argument("--distribution", action="store_true",
                   help="Lecture seule : distribution des disciplines (analyse taxonomie #645)")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    if args.sample:
        return sample_unclassified(args)
    if args.distribution:
        return run_distribution(args)
    if args.by_name:
        return run_by_name(args)
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
