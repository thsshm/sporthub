#!/usr/bin/env python3
"""
data_quality_report.py — rapport de qualité data des venues SEO-visibles (#589).

Vérifier des milliers de pages SEO à la main n'est pas tenable. Ce rapport
LECTURE SEULE agrège les signaux qualité de la prod et sort les pires pages /
sports, pour décider quoi noindexer ou corriger. Exécutable en local ou en CI
(workflow `data-quality-report.yml`, cron hebdo).

Métriques (cf. issue #589) :
  1. venues SEO-visibles (quality_score ≥ seuil) vs masquées par le filtre ;
  2. top mots suspects par sport (réutilise scripts/etl/cleaning.py, #553) ;
  3. pages sport×ville avec < 5 venues fiables (candidates noindex) ;
  4. pages en « mismatch » : 0 visible mais des venues publiées existent (#551) ;
  5. pages avec cartes en doublon (même nom normalisé, même ville, même sport) ;
  6. venues à nombre de courts implausible (seuils par famille, cf.
     lib/venue/courts-plausibility.ts — GARDER EN PHASE) ;
  7. « Popular searches » de la home sous le gate qualité (≥ 5 visibles) — les
     combos sont parsés depuis lib/home-stats.ts (pas de liste dupliquée).

`quality_score` est une colonne GENERATED STORED (0053) → toujours cohérente
avec ce que filtrent les pages. Seuil = LOW_QUALITY_THRESHOLD (25) — GARDER EN
PHASE avec lib/venue/quality-score.ts.

Usage :
    python3 scripts/data_quality_report.py --self-test
    python3 scripts/data_quality_report.py                # rapport texte
    python3 scripts/data_quality_report.py --json /tmp/report.json

Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (lecture seule). Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "etl"))
from cleaning import misclassification_reason, _norm  # noqa: E402

_REPO_ROOT = Path(__file__).resolve().parent.parent

# Seuil de visibilité SEO — = LOW_QUALITY_THRESHOLD (lib/venue/quality-score.ts).
LOW_QUALITY_THRESHOLD = 25
# Sous ce nombre de venues fiables, une page sport×ville est « thin » (noindex).
THIN_PAGE_MIN = 5
# Plafonds crédibles de courts par famille — = lib/venue/courts-plausibility.ts.
FAMILY_MAX_COURTS = {
    "raquette": 40, "ballon": 30, "boules": 60, "baignade": 25, "combat": 20,
    "fitness": 30, "yoga": 30, "nautique": 30, "glisse": 20, "snow": 20,
    "hike": 20, "retraites": 20, "plus": 40,
}
DEFAULT_MAX_COURTS = 50


# ── Logique pure (testée) ───────────────────────────────────────────────────────
def parse_popular_combos(ts_source: str) -> list[tuple[str, str]]:
    """[(sport, citySlug)] extraits de lib/home-stats.ts — pas de liste dupliquée
    à maintenir ; si le fichier change de forme, on le voit (liste vide)."""
    return re.findall(
        r'sport:\s*"([a-z_]+)",\s*citySlug:\s*"([a-z0-9-]+)"', ts_source
    )


def build_report(
    venues: list[dict],
    city_slug_by_id: dict[str, str],
    popular_combos: list[tuple[str, str]],
) -> dict:
    """Agrège toutes les métriques (#589) à partir des venues publiées. Pur."""
    total = len(venues)
    visible = [v for v in venues if (v.get("quality_score") or 0) >= LOW_QUALITY_THRESHOLD]
    hidden = total - len(visible)

    # 2) mots suspects par sport (venues VISIBLES — celles qui polluent le SEO).
    suspicious: Counter[str] = Counter()
    suspicious_examples: list[str] = []
    for v in visible:
        reason = misclassification_reason(v.get("name") or "", v.get("primary_sport_slug"))
        if reason:
            term = reason.split("'")[1] if "'" in reason else "?"
            suspicious[f"{term}←{v.get('primary_sport_slug')}"] += 1
            if len(suspicious_examples) < 10:
                suspicious_examples.append(f"[{v.get('primary_sport_slug')}] {v.get('name')}")

    # 3-5) agrégats par page sport×ville (clé = sport + city_id).
    page_visible: dict[tuple[str, str], int] = defaultdict(int)
    page_total: dict[tuple[str, str], int] = defaultdict(int)
    page_dup_names: dict[tuple[str, str], Counter] = defaultdict(Counter)
    for v in venues:
        sport, cid = v.get("primary_sport_slug"), v.get("city_id")
        if not sport or not cid:
            continue
        key = (sport, cid)
        page_total[key] += 1
        if (v.get("quality_score") or 0) >= LOW_QUALITY_THRESHOLD:
            page_visible[key] += 1
            page_dup_names[key][_norm(v.get("name") or "")] += 1

    def page_label(key: tuple[str, str]) -> str:
        return f"{key[0]} × {city_slug_by_id.get(key[1], key[1])}"

    thin_pages = {k: n for k, n in page_visible.items() if 0 < n < THIN_PAGE_MIN}
    mismatch_pages = {
        k: page_total[k] for k in page_total
        if page_visible.get(k, 0) == 0 and page_total[k] > 0
    }
    dup_pages: dict[tuple[str, str], int] = {}
    for key, names in page_dup_names.items():
        extra = sum(n - 1 for n in names.values() if n > 1)
        if extra:
            dup_pages[key] = extra

    # Pires sports = ceux qui cumulent le plus de pages thin/mismatch.
    worst_sports: Counter[str] = Counter()
    for sport, _ in list(thin_pages) + list(mismatch_pages):
        worst_sports[sport] += 1

    # 6) courts implausibles (toutes venues publiées — la donnée est fausse même
    # si la fiche est masquée).
    implausible = [
        f"{v.get('name')} ({v.get('family_slug')}: {v.get('courts_count')})"
        for v in venues
        if (v.get("courts_count") or 0)
        > FAMILY_MAX_COURTS.get(v.get("family_slug") or "", DEFAULT_MAX_COURTS)
    ]

    # 7) popular searches sous le gate (≥ THIN_PAGE_MIN visibles).
    visible_by_sport_slug: dict[tuple[str, str], int] = defaultdict(int)
    for (sport, cid), n in page_visible.items():
        slug = city_slug_by_id.get(cid)
        if slug:
            visible_by_sport_slug[(sport, slug)] += n
    failing_popular = [
        f"{sport} × {slug} ({visible_by_sport_slug.get((sport, slug), 0)} visibles)"
        for sport, slug in popular_combos
        if visible_by_sport_slug.get((sport, slug), 0) < THIN_PAGE_MIN
    ]

    top = lambda d, n=15: [  # noqa: E731 — tri descendant, label lisible
        f"{page_label(k)} ({v})" for k, v in sorted(d.items(), key=lambda x: -x[1])[:n]
    ]
    return {
        "total_published": total,
        "seo_visible": len(visible),
        "hidden_by_quality": hidden,
        "suspicious_by_term": dict(suspicious.most_common(15)),
        "suspicious_examples": suspicious_examples,
        "thin_pages_count": len(thin_pages),
        "thin_pages_top": top(thin_pages),
        "mismatch_pages_count": len(mismatch_pages),
        "mismatch_pages_top": top(mismatch_pages),
        "duplicate_pages_count": len(dup_pages),
        "duplicate_pages_top": top(dup_pages),
        "implausible_courts_count": len(implausible),
        "implausible_courts_examples": implausible[:10],
        "failing_popular_searches": failing_popular,
        "worst_sports": dict(worst_sports.most_common(10)),
    }


# ── REST Supabase (lecture seule) ───────────────────────────────────────────────
def load_env() -> tuple[str, str]:
    env: dict[str, str] = {}
    f = _REPO_ROOT / ".env.local"
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


def req(url, key, path, timeout=120, retries=5):
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    last = None
    for attempt in range(retries):
        try:
            r = urllib.request.Request(url + "/rest/v1/" + path, headers=headers)
            with urllib.request.urlopen(r, timeout=timeout) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code not in (408, 429, 500, 502, 503, 504):
                raise
            last = e
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
        time.sleep(min(2 ** attempt, 20))
    raise last


def fetch_keyset(url, key, table, select, extra="", page=1000, label=""):
    rows, last_id = [], ""
    while True:
        path = f"{table}?select={select}{extra}&order=id.asc&limit={page}"
        if last_id:
            path += f"&id=gt.{last_id}"
        chunk = req(url, key, path)
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if label and len(rows) % 50000 < page:
            print(f"    … {len(rows):,} {label}", flush=True)
        if len(chunk) < page:
            break
    return rows


# ── Pipeline ────────────────────────────────────────────────────────────────────
def run(args: argparse.Namespace) -> int:
    url, key = load_env()
    print("▶ chargement des villes…")
    cities = fetch_keyset(url, key, "city", "id,slug")
    city_slug_by_id = {c["id"]: c.get("slug") for c in cities}
    print(f"  ✓ {len(cities):,} villes")

    print("▶ chargement des venues publiées…")
    venues = fetch_keyset(
        url, key, "venue",
        "id,name,primary_sport_slug,family_slug,city_id,courts_count,quality_score",
        "&is_published=eq.true&deleted_at=is.null", label="venues",
    )
    print(f"  ✓ {len(venues):,} venues publiées")

    ts = (_REPO_ROOT / "lib" / "home-stats.ts").read_text(encoding="utf-8")
    combos = parse_popular_combos(ts)
    report = build_report(venues, city_slug_by_id, combos)

    print("\n══ RAPPORT QUALITÉ DATA (#589) ══")
    print(f"  venues publiées        : {report['total_published']:,}")
    print(f"  SEO-visibles (≥{LOW_QUALITY_THRESHOLD})     : {report['seo_visible']:,}")
    print(f"  masquées par le filtre : {report['hidden_by_quality']:,}")
    print(f"\n  mots suspects (visibles) : {report['suspicious_by_term']}")
    for ex in report["suspicious_examples"]:
        print(f"     {ex[:70]}")
    print(f"\n  pages thin (<{THIN_PAGE_MIN} fiables) : {report['thin_pages_count']:,}")
    print(f"  pages mismatch (0 visible / total>0) : {report['mismatch_pages_count']:,}")
    print(f"  pages avec doublons : {report['duplicate_pages_count']:,}")
    for sec in ("thin_pages_top", "mismatch_pages_top", "duplicate_pages_top"):
        if report[sec]:
            print(f"\n  top {sec.replace('_', ' ')} :")
            for line in report[sec][:8]:
                print(f"     {line}")
    print(f"\n  courts implausibles : {report['implausible_courts_count']:,}")
    for ex in report["implausible_courts_examples"]:
        print(f"     {ex[:70]}")
    print(f"\n  popular searches sous le gate : {report['failing_popular_searches'] or 'aucune ✓'}")
    print(f"  pires sports (pages thin+mismatch) : {report['worst_sports']}")

    if args.json:
        Path(args.json).write_text(json.dumps(report, ensure_ascii=False, indent=2))
        print(f"\n  rapport JSON : {args.json}")
    return 0


def self_test() -> int:
    combos = parse_popular_combos(
        'x = [\n  { sport: "padel", citySlug: "paris", cityLabel: "Paris" },\n'
        '  { sport: "gym", citySlug: "toulouse", cityLabel: "T" },\n]'
    )
    assert combos == [("padel", "paris"), ("gym", "toulouse")], combos

    venues = [
        # page (tennis, c1) : 2 visibles dont 1 doublon de nom + 1 masquée.
        {"id": "1", "name": "TC Lyon", "primary_sport_slug": "tennis",
         "family_slug": "raquette", "city_id": "c1", "courts_count": 4, "quality_score": 60},
        {"id": "2", "name": "tc lyon", "primary_sport_slug": "tennis",
         "family_slug": "raquette", "city_id": "c1", "courts_count": 2, "quality_score": 30},
        {"id": "3", "name": "Squelette", "primary_sport_slug": "tennis",
         "family_slug": "raquette", "city_id": "c1", "courts_count": None, "quality_score": 0},
        # page (padel, c2) : 0 visible mais 1 publiée → mismatch ; courts absurdes.
        {"id": "4", "name": "Padel X", "primary_sport_slug": "padel",
         "family_slug": "raquette", "city_id": "c2", "courts_count": 200, "quality_score": 10},
        # nom suspect : « Piscine » classée tennis, visible.
        {"id": "5", "name": "Piscine municipale", "primary_sport_slug": "tennis",
         "family_slug": "raquette", "city_id": "c1", "courts_count": 1, "quality_score": 40},
    ]
    city = {"c1": "lyon", "c2": "paris"}
    r = build_report(venues, city, [("padel", "paris"), ("tennis", "lyon")])
    assert r["total_published"] == 5 and r["seo_visible"] == 3, r
    assert r["hidden_by_quality"] == 2
    # (tennis, c1) a 3 visibles (ids 1, 2, 5) < 5 → thin ; doublon "tc lyon" ×2.
    assert r["thin_pages_count"] == 1 and "tennis × lyon (3)" in r["thin_pages_top"][0], r
    assert r["duplicate_pages_count"] == 1 and "tennis × lyon (1)" in r["duplicate_pages_top"][0]
    assert r["mismatch_pages_count"] == 1 and "padel × paris" in r["mismatch_pages_top"][0]
    assert r["implausible_courts_count"] == 1 and "Padel X" in r["implausible_courts_examples"][0]
    # popular : padel×paris a 0 visible → en échec ; tennis×lyon a 3 (<5) → aussi.
    assert len(r["failing_popular_searches"]) == 2, r["failing_popular_searches"]
    assert any("Piscine" in e for e in r["suspicious_examples"]), r["suspicious_examples"]
    print("✓ data_quality_report self-test OK")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Rapport qualité data SEO (#589), lecture seule")
    p.add_argument("--json", default=None, help="Écrit aussi le rapport en JSON")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args(argv)
    if args.self_test:
        return self_test()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
