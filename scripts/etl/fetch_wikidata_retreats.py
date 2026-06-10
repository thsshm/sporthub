#!/usr/bin/env python3
"""fetch_wikidata_retreats.py — produit le JSON d'entrée de import_wikidata_retreats.py (#97).

Le fetcher d'origine (un throwaway dans /tmp) avait été perdu. Celui-ci le
reconstruit proprement : il interroge le SPARQL de Wikidata pour les classes
réellement pertinentes à la famille « Retraites & camps » et écrit un JSON
[{qid, name, lat, lon, cls}, …] consommable tel quel par import_wikidata_retreats.py.

Choix des classes (vérifié contre le nombre d'items géolocalisés, 2026-06) :
  - ashram (Q466449)              → yoga_retreat
  - retreat center (Q106115017)   → wellness_retreat
  - meditation center (Q112262027)→ wellness_retreat
  - holiday camp (Q17006838)      → (défaut) wellness_retreat
  - health resort (Q70438722)     → (défaut) wellness_retreat
On EXCLUT volontairement « monastery » (~13k) et « spa town » (~287) : ce ne sont
pas des retraites/camps sportifs ou bien-être → cela fausserait la famille.

Zéro dépendance (urllib stdlib). Usage :
    python3 scripts/etl/fetch_wikidata_retreats.py --output /tmp/retreats_wikidata.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.parse
import urllib.request

ENDPOINT = "https://query.wikidata.org/sparql"
UA = "SportHub/1.0 (https://sporthubmap.com; contact@sporthubmap.com)"

# Classes Wikidata pertinentes (QID → label utilisé comme `cls` côté import).
CLASSES = {
    "Q466449": "ashram",
    "Q106115017": "retreat center",
    "Q112262027": "meditation center",
    "Q17006838": "holiday camp",
    "Q70438722": "health resort",
}

SPARQL = """
SELECT ?item ?itemLabel ?coord ?cls WHERE {
  VALUES ?cls { %s }
  ?item wdt:P31 ?cls ;
        wdt:P625 ?coord .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en,fr". }
}
""" % " ".join(f"wd:{q}" for q in CLASSES)

_POINT = re.compile(r"Point\(([-0-9.]+)\s+([-0-9.]+)\)")


def fetch(timeout: int = 60) -> list[dict]:
    url = ENDPOINT + "?" + urllib.parse.urlencode({"query": SPARQL, "format": "json"})
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/sparql-results+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = json.load(r)

    out: list[dict] = []
    for b in data["results"]["bindings"]:
        m = _POINT.match(b.get("coord", {}).get("value", ""))
        if not m:
            continue
        lon, lat = float(m.group(1)), float(m.group(2))
        qid = b["item"]["value"].rsplit("/", 1)[-1]
        name = b.get("itemLabel", {}).get("value", "").strip()
        cls = CLASSES.get(b["cls"]["value"].rsplit("/", 1)[-1], "retreat center")
        out.append({"qid": qid, "name": name, "lat": lat, "lon": lon, "cls": cls})
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Fetch retraites Wikidata → JSON (#97)")
    p.add_argument("--output", default="/tmp/retreats_wikidata.json")
    args = p.parse_args(argv)

    items = fetch()
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=1)

    from collections import Counter
    by_cls = Counter(it["cls"] for it in items)
    print(f"✓ {len(items)} retraites écrites → {args.output}")
    print(f"  par classe : {dict(by_cls)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
