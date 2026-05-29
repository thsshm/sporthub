/**
 * Cron Wikidata / Wikipedia refresh.
 *
 * Pour chaque venue qui a déjà `enrichments->>'wikipedia_url' IS NOT NULL`
 * (peuplé par PR #142 / scripts/import_enrichments_v1.py), on rafraîchit :
 *   - `enrichments.description`    : extract Wikipedia FR/EN (tronqué 400c)
 *   - `enrichments.photo_url`      : image Wikipedia (Page Image API)
 *   - `enrichments.wikidata_qid`   : Q-ID si présent dans la réponse
 *   - `enrichments.wikipedia_refreshed_at` : ISO timestamp du dernier refresh
 *
 * Pattern de PATCH : on POST /rest/v1/venue?id=eq.<id> avec un body
 * `{ "enrichments": { …merged } }`. Merge JSONB côté code (Node), pour ne
 * pas écraser les autres clés (google_rating, raw_tags, etc.). Cf. PR #142
 * (scripts/import_enrichments_v1.py) pour la justification.
 *
 * Source : Wikipedia REST API
 *   https://<lang>.wikipedia.org/api/rest_v1/page/summary/<title>
 * Choisi plutôt que `action=query&prop=extracts` parce que :
 *   - 1 call = 1 extract clé en main (titre, extract, thumbnail, wikibase_item)
 *   - rate limit ~200 req/s par IP (= largement suffisant pour ~quelques k venues)
 *
 * Schedule (Vercel cron, cf. `vercel.json`) : tous les lundis à 06:00 UTC.
 * Idempotence : on fait un PATCH ciblé par `id` UUID, jamais de SELECT/DELETE
 * destructif. Le merge JSONB préserve les clés non touchées.
 *
 * Pagination : Vercel timeout = 60s sur Hobby. On traite au plus N venues
 * par run (cf. `MAX_PER_RUN`), en priorisant ceux qu'on n'a pas refresh
 * depuis le plus longtemps (`wikipedia_refreshed_at` ASC). Sur ~quelques k
 * venues avec wikipedia_url, on les couvre tous en quelques semaines.
 *
 * Issue : https://github.com/thsshm/sporthub/issues/109
 */
import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { captureException } from "@/lib/monitoring";
import { verifyCronAuth } from "@/lib/cron/auth";
import { logCronCompleted } from "@/lib/cron/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const USER_AGENT =
  "SportHubMap/1.0 (+https://sporthubmap.com; admin@sporthubmap.com)";
const EVENT_NAME = "cron.refresh-wikidata.completed";

// On traite jusqu'à 300 venues par run. À ~150ms/call (réseau + Wikipedia),
// 300 × 150ms = 45s — confortable sous 60s avec une marge pour le PATCH.
const MAX_PER_RUN = 300;
// Concurrence par batch — Wikipedia tolère bien, on reste poli.
const FETCH_PARALLELISM = 8;
// Time budget pour la phase fetch (laisse ~10s pour les PATCH).
const FETCH_TIME_BUDGET_MS = 45_000;

const DESCRIPTION_MAX_LEN = 400;

type VenueRow = {
  id: string;
  enrichments: Record<string, unknown> | null;
};

type WikipediaSummary = {
  type?: string;
  title?: string;
  extract?: string;
  description?: string;
  wikibase_item?: string;
  originalimage?: { source?: string };
  thumbnail?: { source?: string };
};

function truncate(s: string, n: number): string {
  const t = (s ?? "").trim();
  if (t.length <= n) return t;
  // Coupe au dernier espace pour ne pas casser un mot.
  const cut = t.slice(0, n);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * Extrait { lang, title } d'une URL Wikipedia type
 *   https://fr.wikipedia.org/wiki/Parc_des_Princes
 *   https://en.wikipedia.org/wiki/Parc_des_Princes
 * Retourne null si l'URL n'est pas une URL Wikipedia valide.
 */
function parseWikipediaUrl(
  url: string | undefined,
): { lang: string; title: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z]{2,3})\.wikipedia\.org$/);
    if (!m) return null;
    const lang = m[1];
    const path = u.pathname.replace(/^\/wiki\//, "");
    if (!path) return null;
    // Decode (les URLs Wikipedia ont souvent des % escapes pour les accents).
    const title = decodeURIComponent(path);
    return { lang, title };
  } catch {
    return null;
  }
}

async function fetchSummary(
  lang: string,
  title: string,
): Promise<WikipediaSummary | null> {
  const encoded = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    cache: "no-store",
  });
  if (res.status === 404) return null; // page supprimée — on ne touche pas
  if (!res.ok) {
    throw new Error(`Wikipedia ${lang}/${title} → HTTP ${res.status}`);
  }
  return (await res.json()) as WikipediaSummary;
}

/**
 * Calcule un patch enrichments depuis la réponse Wikipedia.
 * Aucune clé sentinelle (`""`, `null`) n'est ajoutée — JSONB merge propre.
 */
function buildPatch(
  summary: WikipediaSummary,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    wikipedia_refreshed_at: new Date().toISOString(),
  };
  if (summary.title) patch.wikipedia_label = summary.title;
  if (summary.extract) patch.description = truncate(summary.extract, DESCRIPTION_MAX_LEN);
  const photo = summary.originalimage?.source ?? summary.thumbnail?.source;
  if (photo) patch.photo_url = photo;
  if (summary.wikibase_item) patch.wikidata_qid = summary.wikibase_item;
  return patch;
}

/**
 * JSONB merge idempotent (cf. import_enrichments_v1.py).
 * On n'écrase QUE si la nouvelle valeur diffère et est non-vide.
 */
function mergeEnrichments(
  existing: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

export async function GET(request: Request) {
  const authFailure = verifyCronAuth(request);
  if (authFailure) return authFailure.response;

  const startedAt = Date.now();
  let upserted = 0;
  let failed = 0;
  let skipped = 0;

  try {
    const sb = getSupabaseAdminClient();

    // Sélectionne les venues à rafraîchir : wikipedia_url présent.
    // L'ordre par `updated_at ASC` (proxy de "le plus ancien refresh") garantit
    // qu'on tourne sur tout le set sur plusieurs semaines de runs.
    // PostgREST : filtre JSONB via `enrichments->>wikipedia_url=not.is.null`
    const { data, error } = await sb
      .from("venue")
      .select("id, enrichments")
      .not("enrichments->>wikipedia_url", "is", null)
      .is("deleted_at", null)
      .order("updated_at", { ascending: true })
      .limit(MAX_PER_RUN);

    if (error) throw error;
    const venues = (data ?? []) as VenueRow[];

    // Traite par vagues parallèles avec budget temps.
    for (let i = 0; i < venues.length; i += FETCH_PARALLELISM) {
      if (Date.now() - startedAt > FETCH_TIME_BUDGET_MS) {
        skipped += venues.length - i;
        break;
      }
      const batch = venues.slice(i, i + FETCH_PARALLELISM);
      await Promise.all(
        batch.map(async (venue) => {
          const wpUrl = venue.enrichments?.["wikipedia_url"];
          const parsed = parseWikipediaUrl(
            typeof wpUrl === "string" ? wpUrl : undefined,
          );
          if (!parsed) {
            skipped++;
            return;
          }
          try {
            const summary = await fetchSummary(parsed.lang, parsed.title);
            if (!summary) {
              // Page 404'd → on ne touche pas à enrichments existant.
              skipped++;
              return;
            }
            const patch = buildPatch(summary);
            const merged = mergeEnrichments(venue.enrichments, patch);
            const { error: updErr } = await sb
              .from("venue")
              .update({ enrichments: merged })
              .eq("id", venue.id);
            if (updErr) {
              failed++;
              captureException(updErr, {
                route: "/api/cron/refresh-wikidata",
                venueId: venue.id,
              });
              return;
            }
            upserted++;
          } catch (err) {
            failed++;
            captureException(err, {
              route: "/api/cron/refresh-wikidata",
              venueId: venue.id,
              wikipediaUrl: wpUrl,
            });
          }
        }),
      );
    }
  } catch (err) {
    captureException(err, { route: "/api/cron/refresh-wikidata" });
    const duration_ms = Date.now() - startedAt;
    logCronCompleted({
      event: EVENT_NAME,
      upserted,
      failed,
      duration_ms,
      extra: { skipped, error: err instanceof Error ? err.message : "unknown" },
    });
    return NextResponse.json(
      { ok: false, upserted, failed, duration_ms, skipped },
      { status: 500 },
    );
  }

  const duration_ms = Date.now() - startedAt;
  logCronCompleted({
    event: EVENT_NAME,
    upserted,
    failed,
    duration_ms,
    extra: { skipped },
  });
  return NextResponse.json({
    ok: true,
    upserted,
    failed,
    duration_ms,
    skipped,
  });
}
