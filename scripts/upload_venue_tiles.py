#!/usr/bin/env python3
"""
upload_venue_tiles.py — Upload des tuiles PMTiles vers Supabase Storage (#226).

Issue #226 (Roadmap scalabilité, Phase 1.A), étape 3 du pipeline vector tiles.
Suite directe de `generate_venue_tiles.py` (étapes 1-2 : Postgres → venues.pmtiles).

Pipeline complet (#226) :
  1. Export Postgres → GeoJSONL            ┐ generate_venue_tiles.py (#243)
  2. GeoJSONL → venues.pmtiles (tippecanoe)┘
  3. Upload venues.pmtiles → object storage + CDN   ← CE SCRIPT
  4. MapLibre lit pmtiles://<CDN>/venues.pmtiles    (frontend, suite #226)
  5. Régénération nightly (cron)                    (ops, suite #226)

Choix de l'object storage : **Supabase Storage** (déjà dans la stack — cf.
CLAUDE.md « Backend : Supabase Postgres + Auth + Storage »). Pas de nouveau
vendor (R2/S3) à brancher. Bucket public `tiles` (override via $TILES_BUCKET).
Supabase Storage sert les objets publics via un CDN avec support des
Range requests — exactement ce dont PMTiles a besoin (lecture par plages).

Idempotent : crée le bucket public s'il manque, upload en upsert (écrase
la tuile précédente), pose un Cache-Control long (les tuiles sont
versionnées par régénération, pas par URL).

Dépendances :
  pip install --break-system-packages supabase python-dotenv

Usage :
    python3 scripts/upload_venue_tiles.py --self-test       # valide les helpers purs (sans réseau)
    python3 scripts/upload_venue_tiles.py                   # upload ./venues.pmtiles → bucket 'tiles'
    python3 scripts/upload_venue_tiles.py --file out.pmtiles --bucket tiles --dest venues.pmtiles
    python3 scripts/upload_venue_tiles.py --dry-run         # affiche ce qui serait fait, sans réseau

Env (via .env.local, jamais committé) :
    NEXT_PUBLIC_SUPABASE_URL (ou SUPABASE_URL)
    SUPABASE_SERVICE_ROLE_KEY      # requis pour create_bucket + upload
    TILES_BUCKET (optionnel)       # défaut: tiles
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

DEFAULT_BUCKET = "tiles"
DEFAULT_FILE = "venues.pmtiles"
# 1 an, immutable : la tuile est remplacée en place (même URL) par la
# régénération nightly. MapLibre/PMTiles font des Range requests ; un cache
# CDN long minimise l'egress Postgres→tuiles. Acceptable car une régen peut
# tolérer quelques heures de propagation (données non temps-réel).
CACHE_CONTROL = "public, max-age=31536000, immutable"
# PMTiles n'a pas de type IANA officiel ; octet-stream garantit que le CDN
# ne ré-encode pas et préserve les Range requests.
CONTENT_TYPE = "application/octet-stream"


# ─── Helpers purs (testés sans réseau) ───────────────────────────────────


def public_url(base_url: str, bucket: str, dest: str) -> str:
    """URL publique Supabase Storage d'un objet d'un bucket public.

    Forme : {base}/storage/v1/object/public/{bucket}/{dest}
    Normalise les slashes (base sans trailing /, dest sans leading /).
    """
    base = base_url.rstrip("/")
    dest = dest.lstrip("/")
    return f"{base}/storage/v1/object/public/{bucket}/{dest}"


def upload_options() -> dict[str, str]:
    """Options d'upload Supabase Storage. `upsert=true` → écrase la tuile
    existante (régénération en place). Valeurs en str : l'API storage les
    passe tel quel en en-têtes HTTP."""
    return {
        "content-type": CONTENT_TYPE,
        "cache-control": CACHE_CONTROL,
        "upsert": "true",
    }


def resolve_supabase_env() -> tuple[str, str]:
    """Récupère (url, service_role_key) depuis l'environnement. Lève SystemExit
    avec un message actionnable si manquant."""
    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "❌ Définir NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY "
            "(.env.local).\n   La service_role key est requise pour créer le "
            "bucket et uploader.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return url, key


# ─── Upload (live) ───────────────────────────────────────────────────────


def ensure_bucket(sb, bucket: str) -> None:
    """Crée le bucket public s'il n'existe pas. No-op s'il existe déjà."""
    try:
        existing = {b.name for b in sb.storage.list_buckets()}
    except Exception as e:  # noqa: BLE001 — on dégrade proprement, l'upload retentera
        print(f"  ⚠ impossible de lister les buckets ({e}) — tentative de création directe.", file=sys.stderr)
        existing = set()
    if bucket in existing:
        print(f"  ✓ bucket '{bucket}' déjà présent")
        return
    print(f"  ▶ création du bucket public '{bucket}'")
    sb.storage.create_bucket(bucket, options={"public": True})


def upload_tile(file_path: Path, bucket: str, dest: str) -> str:
    """Upload `file_path` → bucket/dest. Retourne l'URL publique."""
    try:
        from supabase import create_client
        from dotenv import load_dotenv
    except ImportError:
        print("❌ pip install --break-system-packages supabase python-dotenv", file=sys.stderr)
        raise SystemExit(1)

    load_dotenv(Path(__file__).resolve().parent.parent / ".env.local")
    load_dotenv()
    url, key = resolve_supabase_env()
    sb = create_client(url, key)

    ensure_bucket(sb, bucket)

    size_mb = file_path.stat().st_size / 1e6
    print(f"  ▶ upload {file_path} ({size_mb:.1f} Mo) → {bucket}/{dest}")
    with file_path.open("rb") as fh:
        sb.storage.from_(bucket).upload(dest, fh, upload_options())

    pub = public_url(url, bucket, dest)
    print(f"  ✓ en ligne : {pub}")
    return pub


# ─── Self-test (sans réseau ni deps) ─────────────────────────────────────


def self_test() -> int:
    # URL publique bien formée + normalisation des slashes
    assert (
        public_url("https://x.supabase.co", "tiles", "venues.pmtiles")
        == "https://x.supabase.co/storage/v1/object/public/tiles/venues.pmtiles"
    )
    assert (
        public_url("https://x.supabase.co/", "tiles", "/venues.pmtiles")
        == "https://x.supabase.co/storage/v1/object/public/tiles/venues.pmtiles"
    )
    assert (
        public_url("https://x.supabase.co", "tiles", "sub/dir/v.pmtiles")
        == "https://x.supabase.co/storage/v1/object/public/tiles/sub/dir/v.pmtiles"
    )
    # Options d'upload : upsert + cache long + octet-stream
    opts = upload_options()
    assert opts["upsert"] == "true", opts
    assert opts["content-type"] == "application/octet-stream", opts
    assert "immutable" in opts["cache-control"] and "max-age=31536000" in opts["cache-control"], opts
    # resolve_supabase_env : présent → renvoie, absent → SystemExit
    prev = {k: os.environ.get(k) for k in ("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")}
    try:
        os.environ["NEXT_PUBLIC_SUPABASE_URL"] = "https://x.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "k"
        os.environ.pop("SUPABASE_URL", None)
        assert resolve_supabase_env() == ("https://x.supabase.co", "k")
        os.environ.pop("NEXT_PUBLIC_SUPABASE_URL")
        os.environ.pop("SUPABASE_SERVICE_ROLE_KEY")
        # Branche négative attendue : on étouffe le message stderr du SystemExit
        # pour ne pas polluer les logs du self-test avec une fausse alerte.
        import contextlib
        import io
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                resolve_supabase_env()
            assert False, "attendu SystemExit quand env manquant"
        except SystemExit:
            pass
    finally:
        for k, v in prev.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    print("✅ self-test OK (public_url, upload_options, resolve_supabase_env)")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Upload des tuiles PMTiles vers Supabase Storage (#226)")
    p.add_argument("--self-test", action="store_true", help="Valide les helpers purs sans réseau")
    p.add_argument("--file", default=DEFAULT_FILE, help="Fichier .pmtiles à uploader (défaut: venues.pmtiles)")
    p.add_argument("--bucket", default=os.getenv("TILES_BUCKET", DEFAULT_BUCKET), help="Bucket Storage (défaut: tiles)")
    p.add_argument("--dest", default=None, help="Nom de l'objet dans le bucket (défaut: basename du --file)")
    p.add_argument("--dry-run", action="store_true", help="Affiche le plan sans réseau")
    args = p.parse_args(list(argv) if argv is not None else None)

    if args.self_test:
        return self_test()

    file_path = Path(args.file)
    dest = args.dest or file_path.name

    if args.dry_run:
        url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL") or "https://<PROJECT>.supabase.co"
        print(f"[dry-run] upload {file_path} → bucket '{args.bucket}' objet '{dest}'")
        print(f"[dry-run] options: {upload_options()}")
        print(f"[dry-run] URL publique cible: {public_url(url, args.bucket, dest)}")
        return 0

    if not file_path.exists():
        print(
            f"❌ {file_path} introuvable. Générer d'abord les tuiles :\n"
            f"   python3 scripts/generate_venue_tiles.py",
            file=sys.stderr,
        )
        return 1

    pub = upload_tile(file_path, args.bucket, dest)
    print(
        "\n── Suite (#226, étape 4 — frontend, refactor à valider) ──────────\n"
        "  npm i pmtiles\n"
        "  import { Protocol } from 'pmtiles';\n"
        "  maplibregl.addProtocol('pmtiles', new Protocol().tile);\n"
        f"  source: {{ type:'vector', url:'pmtiles://{pub}' }}\n"
        "  → remplace le fetch /api/venues pour l'affichage des pins.\n"
        "  (Exposer l'URL via NEXT_PUBLIC_TILES_URL dans lib/env.ts.)\n"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
