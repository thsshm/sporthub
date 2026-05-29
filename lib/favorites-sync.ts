/**
 * Sync favoris localStorage → DB (issue #91).
 *
 * Au login (cf. components/FavoritesSyncOnLogin.tsx), on lit
 * `localStorage["sporthub-favorites"]` et on POST chaque entry à
 * /api/favorites (idempotent côté DB grâce à ON CONFLICT DO NOTHING).
 * En cas de succès total, on vide le localStorage.
 *
 * Compat shape : le localStorage actuel (MapClient.tsx) stocke des
 * `venue.slug`, alors que l'API DB attend des `venue.id` (uuid). Le helper
 * résout les slugs via Supabase. Slugs inconnus → skip.
 *
 * Best-effort, idempotent, sans retry/queue : si la coupure réseau est
 * partielle on garde le localStorage et la prochaine tentative termine.
 */

const FAVORITES_KEY = "sporthub-favorites";

type Logger = (msg: string, ctx?: Record<string, unknown>) => void;

export type SyncResult = {
  total: number;
  posted: number;
  skipped: number;
  failed: number;
  cleared: boolean;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function readLocalFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function clearLocalFavorites(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FAVORITES_KEY);
  } catch {
    /* silent */
  }
}

// Import dynamique : évite de tirer Supabase si le localStorage est déjà
// nettoyé (cas standard après la 1ère sync).
async function resolveSlugsToIds(slugs: string[]): Promise<Map<string, string>> {
  if (slugs.length === 0) return new Map();
  const { getSupabaseBrowserClient } = await import("@/lib/supabase/client");
  const sb = getSupabaseBrowserClient();
  const { data, error } = await sb
    .from("venue")
    .select("id, slug")
    .in("slug", slugs);
  if (error || !data) return new Map();
  return new Map(
    (data as Array<{ id: string; slug: string }>).map((v) => [v.slug, v.id]),
  );
}

/**
 * À appeler une fois la session Supabase établie côté client.
 * Retourne un récap utile pour instrumenter (PostHog) côté caller.
 */
export async function syncLocalFavoritesToServer(
  options: { logger?: Logger } = {},
): Promise<SyncResult> {
  const log = options.logger;
  const local = readLocalFavorites();
  const result: SyncResult = {
    total: local.length,
    posted: 0,
    skipped: 0,
    failed: 0,
    cleared: false,
  };

  if (local.length === 0) {
    log?.("favorites-sync:empty");
    return result;
  }

  const uuids = local.filter(isUuid);
  const slugs = local.filter((v) => !isUuid(v));

  const resolvedFromSlugs: string[] = [];
  if (slugs.length > 0) {
    const map = await resolveSlugsToIds(slugs);
    for (const slug of slugs) {
      const id = map.get(slug);
      if (id) {
        resolvedFromSlugs.push(id);
      } else {
        result.skipped += 1;
        log?.("favorites-sync:slug-unresolved", { slug });
      }
    }
  }

  const toPost = Array.from(new Set([...uuids, ...resolvedFromSlugs]));

  // Sequential pour éviter de saturer RLS (<= quelques dizaines de favoris).
  for (const venueId of toPost) {
    try {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue_id: venueId }),
      });
      if (res.ok) {
        result.posted += 1;
      } else {
        result.failed += 1;
        log?.("favorites-sync:post-failed", { venueId, status: res.status });
      }
    } catch (e) {
      result.failed += 1;
      log?.("favorites-sync:network-error", { venueId, error: String(e) });
    }
  }

  // Clear uniquement si zéro échec : évite de perdre des favoris en cas de
  // coupure partielle. Re-call idempotent côté DB.
  if (result.failed === 0) {
    clearLocalFavorites();
    result.cleared = true;
  }

  log?.("favorites-sync:done", { ...result });
  return result;
}
