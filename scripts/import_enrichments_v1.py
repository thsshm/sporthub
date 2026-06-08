#!/usr/bin/env python3
# ════════════════════════════════════════════════════════════════════════════
# ⚠️ DEPRECATED / ARCHIVÉ — #227 (cutover ETL V2-natif, 2026-06-08).
# NE PLUS EXÉCUTER. Les enrichissements (Wikipédia/photos) sont déjà en DB
# (venue.enrichments) et leur rafraîchissement est désormais natif via la route
# cron Vercel `app/api/cron/refresh-wikidata`. Ce script dépend du SQLite V1
# (sportpin.sqlite), qui n'est plus requis. Conservé pour l'historique (#106).
# ════════════════════════════════════════════════════════════════════════════
"""
import_enrichments_v1.py — Migration des enrichissements Wikidata V1 (SQLite) → venue.enrichments Supabase (#106).

Lit la table `enrichments` du SQLite V1 (data-pipeline/data/sportpin.sqlite,
LECTURE SEULE ABSOLUE) et merge les URLs Wikipedia, photos Wikimedia Commons et
descriptions Wikipedia FR dans le JSONB `venue.enrichments`.

Stratégie de matching enrichment → venue Supabase
─────────────────────────────────────────────────
La table V1 `enrichments` référence `spots.id` (INTEGER local SQLite). Pour
mapper vers une venue V2 :
  1) On joint `enrichments.spot_id` → `spots.id` pour récupérer
     `spots.public_id` (ex "osm/way/53559935") et `spots.club_id` (ex
     "club-fr-75016-football-parc-des-princes").
  2) `scripts/import_v1.py` peut avoir tourné en --mode=clubs-only (par défaut)
     OU --mode=spots-only. On essaye les deux clés :
        - venue.external_id = clubs.club_id        (clubs-only)
        - venue.enrichments->>'v1_spot_id' = ...   (spots-only, fallback)
        - venue.external_id = spots.public_id      (spots-only direct)
  3) Si aucun match, on logge le `venue_id` introuvable (cas spot V1 qui n'a
     pas survécu à la dédup V2 ou venues importés en mode différent).

Kinds traités (depuis la SQLite V1)
────────────────────────────────────
  - kind='wikipedia'   → enrichments.wikipedia_url + enrichments.wikipedia_label
  - kind='photo'       → enrichments.photo_url (URL Wikimedia Commons brute,
                          PAS de ?width=…, le composant client gère le sizing)
  - spots.description  → enrichments.description (extrait Wikipedia FR,
                          tronqué à 400 chars). On ne migre la description que
                          si le spot a AUSSI un enrichment kind='wikipedia',
                          pour ne pas remonter des descriptions OSM/RES en tant
                          que "Wikipedia". L'issue parle de "wikipedia_extract"
                          mais en V1 cette colonne n'existe pas sous ce nom :
                          la valeur est stockée dans `spots.description`.

Idempotence (CRITIQUE)
──────────────────────
JSONB merge côté Postgres via UPDATE … SET enrichments = enrichments || patch.
Pas d'overwrite : si la venue a déjà un autre champ (raw_tags, google_*, etc.),
il est préservé. Le script peut être ré-exécuté sans dupliquer.

Sécurité
────────
- Lecture SQLite V1 en mode `ro` (URI immutable=1) — impossible d'écrire.
- Aucun DELETE/INSERT côté Supabase, seulement UPDATE via PATCH REST.
- Aucun credential hardcodé (args CLI ou env vars).

Usage
─────
  # Dry-run local (recommandé pour tester) :
  python3 scripts/import_enrichments_v1.py --dry-run --limit 10 \\
    --supabase-url https://xxx.supabase.co --supabase-key any

  # Production (Gautier) :
  export SUPABASE_URL=https://xxx.supabase.co
  export SUPABASE_SERVICE_ROLE_KEY=eyJ...    # service-role, PAS la anon key
  python3 scripts/import_enrichments_v1.py --limit 50      # smoke test
  python3 scripts/import_enrichments_v1.py                 # full run

Dépendances
───────────
Aucune externe — uniquement stdlib (sqlite3, urllib, json, argparse). On
attaque directement l'API REST Supabase (PostgREST) plutôt que `supabase-py`
pour rester deps-free (CLAUDE.md règle 3).

Issue : https://github.com/thsshm/sporthub/issues/106
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


# ─── Constants ───────────────────────────────────────────────────────────

DEFAULT_V1_DB = Path(
    os.path.expanduser(
        "~/Documents/Claude/Projects/SportHub/data-pipeline/data/sportpin.sqlite"
    )
)
DEFAULT_V1_DB_FALLBACK = Path(__file__).resolve().parent.parent.parent / "data-pipeline" / "data" / "sportpin.sqlite"

# Si la SQLite live a été remplacée par une version sans enrichments
# (cas réel constaté sur la machine de dev — voir issue #106), on retombe
# sur l'historique connu où elles existent.
KNOWN_FALLBACK_DBS = [
    DEFAULT_V1_DB,
    Path(
        os.path.expanduser(
            "~/Documents/Claude/Projects/SportHub/data-pipeline/data/sportpin.sqlite.corrupted-2026-05-27"
        )
    ),
]

DESCRIPTION_MAX_LEN = 400  # cf. acceptance #106


# ─── SQLite helpers (lecture seule absolue) ──────────────────────────────


def open_sqlite_readonly(path: Path) -> sqlite3.Connection:
    """Ouvre la SQLite V1 en mode read-only strict (immutable=1).

    Le flag `immutable=1` interdit toute écriture ET désactive le journaling
    WAL — aucune création de fichier auxiliaire. C'est la garantie que ce
    script ne peut PAS modifier la base V1.
    """
    uri = f"file:{path}?mode=ro&immutable=1"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def pick_sqlite_with_enrichments(explicit: Path | None) -> Path:
    """Trouve la SQLite V1 qui contient effectivement des enrichments.

    On préfère le chemin explicite (--sqlite ou V1_SQLITE_PATH) ; sinon on
    teste les candidats connus et on garde le premier non-vide.
    """
    candidates: list[Path] = []
    if explicit:
        candidates.append(explicit)
    candidates.extend(KNOWN_FALLBACK_DBS)

    for p in candidates:
        if not p.exists():
            continue
        try:
            with open_sqlite_readonly(p) as c:
                (n,) = c.execute("SELECT COUNT(*) FROM enrichments").fetchone()
            if n > 0:
                if explicit and p != explicit:
                    print(
                        f"⚠ SQLite explicite '{explicit}' ne contient pas d'enrichments — "
                        f"fallback sur '{p}'."
                    )
                return p
            print(f"⚠ {p} contient 0 enrichments — on essaie le suivant.")
        except sqlite3.Error as e:
            print(f"⚠ {p} illisible ({e}) — on essaie le suivant.")
    raise SystemExit(
        "❌ Aucune SQLite V1 avec enrichments trouvée. "
        "Précise --sqlite ou positionne V1_SQLITE_PATH."
    )


# ─── Patch building ──────────────────────────────────────────────────────


def truncate(s: str, n: int) -> str:
    s = (s or "").strip()
    if len(s) <= n:
        return s
    # Coupe au dernier espace pour ne pas couper un mot en plein milieu
    cut = s[:n].rsplit(" ", 1)[0]
    return f"{cut}…"


def build_patches(conn: sqlite3.Connection) -> dict[int, dict[str, Any]]:
    """Itère sur les enrichments V1 et construit un patch JSONB par spot_id.

    Retourne {spot_id: {wikipedia_url, wikipedia_label, photo_url, description}}
    Tous les champs sont optionnels — seuls les non-null sont inclus.
    """
    patches: dict[int, dict[str, Any]] = defaultdict(dict)

    # Wikipedia URLs + labels
    for r in conn.execute(
        "SELECT spot_id, label, url FROM enrichments "
        "WHERE kind = 'wikipedia' AND url IS NOT NULL AND url != ''"
    ):
        patches[r["spot_id"]]["wikipedia_url"] = r["url"]
        if r["label"]:
            patches[r["spot_id"]]["wikipedia_label"] = r["label"]

    # Photos Wikimedia Commons (URL brute, le composant client gère le sizing)
    for r in conn.execute(
        "SELECT spot_id, url FROM enrichments "
        "WHERE kind = 'photo' AND url IS NOT NULL AND url != ''"
    ):
        url = r["url"]
        # Nettoie un éventuel ?width=… (cf. acceptance #106)
        if "?" in url:
            url = url.split("?", 1)[0]
        patches[r["spot_id"]]["photo_url"] = url

    # Descriptions Wikipedia FR (héritées de spots.description quand
    # le spot a aussi un enrichment kind='wikipedia')
    for r in conn.execute(
        "SELECT s.id AS spot_id, s.description "
        "FROM spots s "
        "JOIN enrichments e ON e.spot_id = s.id AND e.kind = 'wikipedia' "
        "WHERE s.description IS NOT NULL AND s.description != ''"
    ):
        patches[r["spot_id"]]["description"] = truncate(
            r["description"], DESCRIPTION_MAX_LEN
        )

    return patches


# ─── Spot → venue mapping helper ─────────────────────────────────────────


def load_spot_metadata(conn: sqlite3.Connection, spot_ids: list[int]) -> dict[int, dict[str, Any]]:
    """Récupère public_id + club_id + name + city + country par spot_id."""
    if not spot_ids:
        return {}
    placeholders = ",".join("?" * len(spot_ids))
    rows = conn.execute(
        f"SELECT id, public_id, club_id, name, city, country "
        f"FROM spots WHERE id IN ({placeholders})",
        spot_ids,
    )
    return {
        r["id"]: {
            "public_id": r["public_id"],
            "club_id": r["club_id"],
            "name": r["name"],
            "city": r["city"],
            "country": r["country"],
        }
        for r in rows
    }


# ─── Supabase REST client (PostgREST) ────────────────────────────────────


class SupabaseRest:
    """Wrapper minimaliste autour de l'API REST Supabase (PostgREST).

    On n'utilise QUE des opérations SELECT et PATCH (UPDATE) — jamais
    DELETE/INSERT — pour respecter l'invariant de l'issue : "verrouillé en
    mode SQL UPDATE (jamais DELETE/INSERT)".
    """

    def __init__(self, base_url: str, service_key: str, dry_run: bool = False):
        self.base = base_url.rstrip("/")
        self.key = service_key
        self.dry_run = dry_run

    def _headers(self, prefer: str | None = None) -> dict[str, str]:
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
        }
        if prefer:
            h["Prefer"] = prefer
        return h

    def _req(self, method: str, path: str, body: Any | None = None, prefer: str | None = None) -> Any:
        url = f"{self.base}/rest/v1{path}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers=self._headers(prefer))
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else []
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")
            raise RuntimeError(f"Supabase {method} {path} → {e.code} {detail}") from e

    def find_venues_by_external_ids(
        self, external_ids: list[str], batch: int = 50
    ) -> dict[str, dict[str, Any]]:
        """Retourne {external_id: {id, enrichments}} pour les venues trouvées."""
        out: dict[str, dict[str, Any]] = {}
        for i in range(0, len(external_ids), batch):
            chunk = external_ids[i : i + batch]
            # PostgREST in.(…) : les valeurs avec virgule doivent être quotées
            quoted = ",".join(f'"{x}"' for x in chunk)
            qs = urllib.parse.urlencode(
                {"select": "id,external_id,enrichments", "external_id": f"in.({quoted})"}
            )
            for row in self._req("GET", f"/venue?{qs}"):
                out[row["external_id"]] = row
        return out

    def find_venues_by_v1_spot_id(
        self, spot_ids: list[int], batch: int = 50
    ) -> dict[int, dict[str, Any]]:
        """Retourne {v1_spot_id: venue_row} via enrichments->>v1_spot_id."""
        out: dict[int, dict[str, Any]] = {}
        for i in range(0, len(spot_ids), batch):
            chunk = spot_ids[i : i + batch]
            quoted = ",".join(str(x) for x in chunk)
            qs = urllib.parse.urlencode(
                {
                    "select": "id,external_id,enrichments",
                    "enrichments->>v1_spot_id": f"in.({quoted})",
                }
            )
            for row in self._req("GET", f"/venue?{qs}"):
                v = row.get("enrichments", {}).get("v1_spot_id")
                if v is None:
                    continue
                try:
                    out[int(v)] = row
                except (TypeError, ValueError):
                    continue
        return out

    def patch_venue_enrichments(self, venue_id: str, merged: dict[str, Any]) -> None:
        """UPDATE venue SET enrichments = <merged> WHERE id = venue_id.

        Le merge JSONB est calculé Python-side (idempotent : on ne touche pas
        aux clés existantes non liées à V1). En dry-run, on log et c'est tout.
        """
        if self.dry_run:
            print(
                f"  [dry-run] PATCH /venue?id=eq.{venue_id} "
                f"enrichments={json.dumps(merged, ensure_ascii=False)[:200]}…"
            )
            return
        qs = urllib.parse.urlencode({"id": f"eq.{venue_id}"})
        self._req(
            "PATCH",
            f"/venue?{qs}",
            body={"enrichments": merged},
            prefer="return=minimal",
        )


# ─── Main ────────────────────────────────────────────────────────────────


def merge_enrichments(existing: dict[str, Any] | None, patch: dict[str, Any]) -> dict[str, Any]:
    """JSONB merge idempotent.

    - On ne supprime aucune clé existante.
    - On n'écrase une clé V1 (wikipedia_url, photo_url, etc.) que si elle
      diffère réellement, pour générer le moins de churn possible côté DB.
    """
    base = dict(existing or {})
    for k, v in patch.items():
        if v in (None, "", [], {}):
            continue
        if base.get(k) != v:
            base[k] = v
    return base


def patch_differs(existing: dict[str, Any] | None, patch: dict[str, Any]) -> bool:
    existing = existing or {}
    for k, v in patch.items():
        if v in (None, "", [], {}):
            continue
        if existing.get(k) != v:
            return True
    return False


def run(args: argparse.Namespace) -> int:
    # 1) Source V1
    sqlite_path: Path | None = args.sqlite
    env_path = os.getenv("V1_SQLITE_PATH")
    if sqlite_path is None and env_path:
        sqlite_path = Path(env_path)
    if sqlite_path is not None and not sqlite_path.exists():
        print(f"⚠ --sqlite {sqlite_path} introuvable, fallback sur candidats connus.")
        sqlite_path = None
    chosen = pick_sqlite_with_enrichments(sqlite_path)
    print(f"📂 SQLite V1 (read-only) : {chosen}")
    conn = open_sqlite_readonly(chosen)

    # 2) Bâtit les patches par spot_id
    patches = build_patches(conn)
    print(f"📦 {len(patches):,} spots V1 avec au moins un champ Wikidata/Wikipedia.")

    # Counts par kind (pour acceptance #106)
    counts = Counter()
    for p in patches.values():
        for k in p:
            counts[k] += 1
    print("   ├─ wikipedia_url       :", counts.get("wikipedia_url", 0))
    print("   ├─ wikipedia_label     :", counts.get("wikipedia_label", 0))
    print("   ├─ photo_url           :", counts.get("photo_url", 0))
    print("   └─ description (≤400c) :", counts.get("description", 0))

    if args.limit:
        keep = sorted(patches.keys())[: args.limit]
        patches = {k: patches[k] for k in keep}
        print(f"🔢 --limit {args.limit} → on garde {len(patches)} spots pour ce run.")

    # 3) Charge meta V1 (public_id, club_id) pour pouvoir matcher côté V2
    spot_ids = sorted(patches.keys())
    meta = load_spot_metadata(conn, spot_ids)

    # 4) Connexion Supabase
    if not args.supabase_url or not args.supabase_key:
        print("❌ --supabase-url et --supabase-key obligatoires (ou SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).")
        return 2
    sb = SupabaseRest(args.supabase_url, args.supabase_key, dry_run=args.dry_run)

    # 5) Mappe spot V1 → venue V2 (3 stratégies en cascade)
    # Stratégie A : venue.external_id == clubs.club_id (mode clubs-only de import_v1.py)
    club_ids = sorted({m["club_id"] for m in meta.values() if m["club_id"]})
    # Stratégie B : venue.external_id == spots.public_id (mode spots-only)
    public_ids = sorted({m["public_id"] for m in meta.values() if m["public_id"]})

    print(f"\n🔎 Lookup venues V2 …")
    by_ext_club: dict[str, dict[str, Any]] = {}
    by_ext_public: dict[str, dict[str, Any]] = {}
    by_v1_spot: dict[int, dict[str, Any]] = {}

    is_dummy = args.dry_run and (
        args.supabase_url.startswith("https://dummy")
        or args.supabase_url == "https://dummy"
    )
    if is_dummy:
        print("   [dry-run dummy] skip réseau Supabase, on simule 0 match Supabase.")
        # On dump quand même un échantillon des patches construits localement,
        # pour montrer ce que SERAIT exécuté en prod (acceptance #106).
        sample_n = args.sample or 5
        print(f"\n📝 Échantillon de {min(sample_n, len(spot_ids))} patches (LOCAL, "
              "sans match Supabase) :")
        for sid in spot_ids[:sample_n]:
            m = meta.get(sid, {})
            ext_id_candidate = m.get("club_id") or m.get("public_id")
            print(
                f"  - spot_id={sid} would-target external_id={ext_id_candidate!r} "
                f"(name={m.get('name')!r})\n"
                f"      patch = {json.dumps(patches[sid], ensure_ascii=False)}"
            )
    else:
        try:
            if club_ids:
                by_ext_club = sb.find_venues_by_external_ids(club_ids)
                print(f"   ├─ via external_id=club_id        : {len(by_ext_club):,} hits")
            if public_ids:
                by_ext_public = sb.find_venues_by_external_ids(public_ids)
                print(f"   ├─ via external_id=public_id      : {len(by_ext_public):,} hits")
            by_v1_spot = sb.find_venues_by_v1_spot_id(spot_ids)
            print(f"   └─ via enrichments->>v1_spot_id : {len(by_v1_spot):,} hits")
        except RuntimeError as e:
            if args.dry_run:
                print(f"   ⚠ erreur réseau Supabase ignorée (dry-run) : {e}")
            else:
                raise

    # 6) Pour chaque spot, calcule le merge cible et le PATCH
    matched = 0
    skipped_same = 0
    not_found: list[int] = []
    samples_dumped = 0

    for spot_id in spot_ids:
        patch = patches[spot_id]
        m = meta.get(spot_id, {})

        venue: dict[str, Any] | None = None
        if m.get("club_id") and m["club_id"] in by_ext_club:
            venue = by_ext_club[m["club_id"]]
        elif spot_id in by_v1_spot:
            venue = by_v1_spot[spot_id]
        elif m.get("public_id") and m["public_id"] in by_ext_public:
            venue = by_ext_public[m["public_id"]]

        if venue is None:
            not_found.append(spot_id)
            if args.dry_run and samples_dumped < 5:
                print(
                    f"  [no-match] spot_id={spot_id} name={m.get('name')!r} "
                    f"city={m.get('city')!r} public_id={m.get('public_id')!r} "
                    f"club_id={m.get('club_id')!r} patch={json.dumps(patch, ensure_ascii=False)[:150]}"
                )
                samples_dumped += 1
            continue

        merged = merge_enrichments(venue.get("enrichments"), patch)
        if not patch_differs(venue.get("enrichments"), patch):
            skipped_same += 1
            continue

        if args.dry_run and matched < (args.sample or 5):
            print(
                f"  [would-update] venue.id={venue['id']} "
                f"name={m.get('name')!r} "
                f"external_id={venue['external_id']!r}\n"
                f"      before = {json.dumps(venue.get('enrichments') or {}, ensure_ascii=False)[:200]}\n"
                f"      patch  = {json.dumps(patch, ensure_ascii=False)}\n"
                f"      after  = {json.dumps(merged, ensure_ascii=False)[:300]}"
            )

        try:
            sb.patch_venue_enrichments(venue["id"], merged)
            matched += 1
        except RuntimeError as e:
            print(f"  ❌ PATCH venue {venue['id']} failed : {e}")

    # 7) Récap
    print(f"\n📊 Résumé :")
    print(f"   ├─ spots V1 traités       : {len(spot_ids):,}")
    print(f"   ├─ venues mis à jour      : {matched:,}")
    print(f"   ├─ déjà à jour (no-op)    : {skipped_same:,}")
    print(f"   └─ spots sans venue match : {len(not_found):,}")

    if not_found and args.log_unmatched:
        log_path = Path(args.log_unmatched)
        log_path.write_text(
            "\n".join(
                f"{sid}\t{meta.get(sid, {}).get('public_id', '')}\t"
                f"{meta.get(sid, {}).get('club_id', '')}\t"
                f"{meta.get(sid, {}).get('name', '')}"
                for sid in not_found
            )
        )
        print(f"   📝 Liste des unmatched écrite dans {log_path}")

    if args.dry_run:
        print("\n🟡 DRY-RUN — aucune écriture envoyée à Supabase.")
    else:
        print("\n✅ Import terminé.")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Migration des enrichissements Wikidata V1 → venue.enrichments Supabase (#106).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""\
Exemples
────────
  # Dry-run local complet (sans réseau Supabase) :
    python3 scripts/import_enrichments_v1.py --dry-run --limit 10 \\
      --supabase-url https://dummy --supabase-key dummy

  # Dry-run avec lookup réel Supabase (à privilégier avant tout run prod) :
    python3 scripts/import_enrichments_v1.py --dry-run \\
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"

  # Prod (Gautier) : full run, idempotent, ré-exécutable :
    python3 scripts/import_enrichments_v1.py \\
      --supabase-url "$SUPABASE_URL" --supabase-key "$SUPABASE_SERVICE_ROLE_KEY"
""",
    )
    p.add_argument(
        "--supabase-url",
        default=os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL"),
        help="URL projet Supabase (défaut: $SUPABASE_URL ou $NEXT_PUBLIC_SUPABASE_URL).",
    )
    p.add_argument(
        "--supabase-key",
        default=os.getenv("SUPABASE_SERVICE_ROLE_KEY"),
        help="Service-role key Supabase (défaut: $SUPABASE_SERVICE_ROLE_KEY). JAMAIS la anon key.",
    )
    p.add_argument(
        "--sqlite",
        type=Path,
        default=Path(os.getenv("V1_SQLITE_PATH")) if os.getenv("V1_SQLITE_PATH") else None,
        help="Chemin de la SQLite V1 (défaut: V1_SQLITE_PATH puis candidats connus).",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="N'écrit rien dans Supabase, log les PATCH qui SERAIENT exécutés.",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limite N spots V1 à traiter (utile pour tests).",
    )
    p.add_argument(
        "--sample",
        type=int,
        default=5,
        help="Nb de patches détaillés à dumper en dry-run (défaut: 5).",
    )
    p.add_argument(
        "--log-unmatched",
        default=None,
        help="Chemin d'un fichier TSV où dumper les spots V1 sans venue V2 correspondante.",
    )
    return p.parse_args(argv)


def main() -> int:
    args = parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
