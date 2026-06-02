#!/usr/bin/env python3
"""Backfill #312 palier 2 — reclasse les venues `family_slug='autre'` +
`primary_sport_slug IS NULL` (≈887) hors du bucket 'autre'.

Source de vérité : le `sport_type` de la base V1 (SQLite, lecture seule),
retrouvé par `enrichments->>v1_spot_id`. On en dérive :
  - un primary_sport_slug V2 quand un sport canonique correspond ;
  - sinon la seule famille canonique (au pire 'plus', mais plus jamais 'autre',
    ce qui résout le bug UI #312 : invisible dans le FamilySwitcher).
Fallback heuristique sur le nom quand le v1_spot_id manque/est introuvable.

Pattern repris de scripts/backfill_courts_count_rest.py :
  - keyset pagination (id=gt.<last>), JAMAIS de OFFSET ;
  - écritures par lots PATCH id=in.(...), Prefer return=minimal ;
  - retries + backoff, timeout 120s.
Aucun agrégat (les COUNT sur ce dataset se font couper, 57014).

DRY-RUN par défaut : affiche le plan + la distribution des cibles, n'écrit RIEN.
Ajouter --apply pour écrire. --limit N pour tester petit. --chunk pour la taille de lot.

  python3 scripts/backfill_family_null_sport.py                 # dry-run complet
  python3 scripts/backfill_family_null_sport.py --limit 50 --apply
  python3 scripts/backfill_family_null_sport.py --apply
"""
from __future__ import annotations
import argparse, json, re, sqlite3, time, urllib.error, urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env.local"
V1_DEFAULT = Path.home() / "Documents/Claude/Projects/SportHub/data-pipeline/data/sportpin.sqlite"

CANON = {"raquette","ballon","fitness","combat","yoga","baignade","boules",
         "nautique","glisse","snow","hike","escalade","retraites","plus"}

# V1 sport_type → (sport_slug V2 | None, family_slug). family DOIT être canonique.
# None = pas de sport V2 fiable → on ne pose que la famille.
MAPPING = {
    "climbing": ("climbing_indoor", "escalade"),
    "climbing_adventure": ("climbing_indoor", "escalade"),
    "swimming": ("pool", "baignade"),
    "sailing": (None, "nautique"),
    "canoe": (None, "nautique"),
    "rowing": (None, "nautique"),
    "scuba_diving": ("diving", "nautique"),
    "water_ski": (None, "nautique"),
    "skiing": ("skiing", "snow"),
    "ski": ("skiing", "snow"),
    "cross_country_skiing": ("cross_country", "snow"),
    "snowshoes": (None, "snow"),
    "cycling": ("cycling", "hike"),
    "running": ("running", "hike"),
    "athletics": (None, "hike"),
    "weightlifting": ("gym", "fitness"),
    "ems": ("gym", "fitness"),
    "parkour": (None, "fitness"),
    "fencing": (None, "combat"),
    "aikido": (None, "combat"),
    "golf": ("golf", "plus"),
    "equestrian": ("equestrian", "plus"),
    "horse_racing": ("equestrian", "plus"),
    "archery": ("archery", "plus"),
    "free_flying": ("paragliding", "plus"),
    "ultralight_aviation": (None, "plus"),
    "parachuting": (None, "plus"),
    "model_aerodrome": (None, "plus"),
    "shooting": (None, "plus"),
    "laser_tag": (None, "plus"),
    "paintball": (None, "plus"),
    "karting": (None, "plus"),
    "motor": (None, "plus"),
    "motocross": (None, "plus"),
    "rc_car": (None, "plus"),
    "bmx": (None, "plus"),
    "skateboard": (None, "plus"),
    "billiards": (None, "plus"),
    "10pin": (None, "plus"),
    "9pin": (None, "plus"),
    "ice_skating": (None, "plus"),
    "multi": (None, "plus"),
}
DEFAULT = (None, "plus")

# Fallback nom (seulement si pas de sport_type V1 exploitable).
NAME_HEURISTICS = [
    (re.compile(r"climb|escalad|boulder|\bbloc\b|arkose", re.I), ("climbing_indoor", "escalade")),
    (re.compile(r"piscin|swim|natation|\bpool\b|baths|nautisme", re.I), ("pool", "baignade")),
    (re.compile(r"fitness|\bgym\b|musculation|crossfit|basic-?fit|keep ?cool", re.I), ("gym", "fitness")),
    (re.compile(r"voile|nautique|sailing|yacht|aviron|rowing|cano[eë]|kayak", re.I), (None, "nautique")),
    (re.compile(r"\bgolf\b", re.I), ("golf", "plus")),
    (re.compile(r"equestr|[ée]quitation|hippodrome|man[èe]ge|poney", re.I), ("equestrian", "plus")),
]


def load_env():
    env = {}
    for line in ENV.read_text().splitlines():
        s = line.strip()
        if s and not s.startswith("#") and "=" in s:
            k, v = s.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    v1 = Path(env.get("V1_SQLITE_PATH") or V1_DEFAULT)
    return url, key, v1


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
                return resp.headers, resp.read()
        except urllib.error.HTTPError as e:
            if e.code not in (408, 429, 500, 502, 503, 504):
                raise RuntimeError(f"{e.code} {e.read().decode(errors='replace')[:300]}")
            last = e
        except urllib.error.URLError as e:
            last = e
        time.sleep(min(2 ** attempt, 20))
    raise RuntimeError(f"échec après {retries} tentatives: {last}")


def fetch_cohort(url, key, limit=None):
    """Keyset sur family_slug=eq.autre (indexé) + primary_sport_slug IS NULL."""
    rows, last_id, page = [], "", 1000
    while True:
        n = page if limit is None else min(page, limit - len(rows))
        if n <= 0:
            break
        path = ("venue?select=id,name,enrichments"
                "&family_slug=eq.autre&primary_sport_slug=is.null&deleted_at=is.null"
                f"&order=id.asc&limit={n}")
        if last_id:
            path += f"&id=gt.{last_id}"
        _, raw = req(url, key, path=path)
        chunk = json.loads(raw)
        if not chunk:
            break
        rows.extend(chunk)
        last_id = chunk[-1]["id"]
        if len(chunk) < n:
            break
    return rows


def v1_sport_types(v1_path, spot_ids):
    """id v1 → sport_type, en lecture seule (immutable)."""
    if not spot_ids or not v1_path.exists():
        return {}
    con = sqlite3.connect(f"file:{v1_path}?immutable=1", uri=True)
    try:
        out = {}
        ids = sorted(spot_ids)
        for i in range(0, len(ids), 900):  # limite SQLite ~999 paramètres
            batch = ids[i:i + 900]
            q = "SELECT id, sport_type FROM spots WHERE id IN (%s)" % ",".join("?" * len(batch))
            for sid, stype in con.execute(q, batch):
                out[sid] = (stype or "").strip()
        return out
    finally:
        con.close()


def classify(venue, sport_type):
    """→ (sport_slug|None, family_slug, raison)."""
    if sport_type and sport_type in MAPPING:
        s, f = MAPPING[sport_type]
        return s, f, f"v1:{sport_type}"
    name = venue.get("name") or ""
    for rx, (s, f) in NAME_HEURISTICS:
        if rx.search(name):
            return s, f, "name"
    if sport_type:  # sport_type V1 connu mais non mappé → plus
        return DEFAULT[0], DEFAULT[1], f"v1-unmapped:{sport_type}"
    return DEFAULT[0], DEFAULT[1], "default"


def patch_batch(url, key, ids, fam, sport):
    body = {"family_slug": fam}
    if sport is not None:
        body["primary_sport_slug"] = sport
    path = "venue?id=in.(%s)" % ",".join(ids)
    req(url, key, method="PATCH", path=path, body=body, prefer="return=minimal")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="écrit en base (défaut: dry-run)")
    ap.add_argument("--limit", type=int, default=None, help="ne traiter que N venues (test)")
    ap.add_argument("--chunk", type=int, default=100, help="taille de lot PATCH")
    args = ap.parse_args()

    url, key, v1 = load_env()
    print(f"V1 SQLite : {v1} ({'OK' if v1.exists() else 'INTROUVABLE'})")
    print(f"Mode      : {'APPLY (écriture)' if args.apply else 'DRY-RUN (lecture seule)'}")

    cohort = fetch_cohort(url, key, args.limit)
    print(f"\nCohorte autre+sport_null récupérée : {len(cohort)} venues")

    spot_ids = set()
    for v in cohort:
        enr = v.get("enrichments") or {}
        sid = enr.get("v1_spot_id") if isinstance(enr, dict) else None
        if isinstance(sid, int):
            spot_ids.add(sid)
    types = v1_sport_types(v1, spot_ids)
    print(f"v1_spot_id présents : {len(spot_ids)} | retrouvés en V1 : {len(types)}")

    # classer + grouper par (famille, sport)
    groups = defaultdict(list)
    by_family = Counter()
    by_reason = Counter()
    for v in cohort:
        enr = v.get("enrichments") or {}
        sid = enr.get("v1_spot_id") if isinstance(enr, dict) else None
        st = types.get(sid) if isinstance(sid, int) else None
        sport, fam, reason = classify(v, st)
        assert fam in CANON, f"famille non canonique produite: {fam}"
        groups[(fam, sport)].append(v["id"])
        by_family[fam] += 1
        by_reason[reason.split(":")[0]] += 1

    print("\n— Cibles par famille —")
    for fam, n in by_family.most_common():
        print(f"  {fam:10} {n}")
    print("\n— Origine de la décision —")
    for r, n in by_reason.most_common():
        print(f"  {r:14} {n}")
    print("\n— Détail (famille, sport) → n —")
    for (fam, sport), ids in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        print(f"  {fam:10} {str(sport):16} {len(ids)}")

    total = sum(len(v) for v in groups.values())
    if not args.apply:
        print(f"\nDRY-RUN : {total} venues seraient mises à jour. Rien écrit. "
              f"Relancer avec --apply pour exécuter.")
        return

    print(f"\nApplication sur {total} venues…")
    t0, written = time.time(), 0
    for (fam, sport), ids in groups.items():
        for i in range(0, len(ids), args.chunk):
            batch = ids[i:i + args.chunk]
            patch_batch(url, key, batch, fam, sport)
            written += len(batch)
            if written % 500 < args.chunk:
                rate = written / max(time.time() - t0, 1e-9)
                print(f"    … {written}/{total} écrites ({rate:.0f}/s)")
    print(f"Terminé : {written} venues reclassées en {time.time() - t0:.1f}s.")


if __name__ == "__main__":
    main()
