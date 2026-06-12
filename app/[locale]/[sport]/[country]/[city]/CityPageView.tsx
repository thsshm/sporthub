import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSupabaseStaticClient } from "@/lib/supabase/server";
import { SPORTS_BY_SLUG } from "@/lib/sports";
import { FAMILIES_BY_SLUG, getRelatedSports } from "@/lib/families";
import {
  isLowQualityVenue,
  venueQualityScoreForSport,
  LOW_QUALITY_THRESHOLD,
  type ScorableVenue,
} from "@/lib/venue/quality-score";
import { getVisibleVenueCount } from "@/lib/venue/visible-count";
import { isSportMismatch, sinkMismatches } from "@/lib/venue/sport-mismatch";
import { groupCourtRecords } from "@/lib/venue/group-courts";
import { groupByClub } from "@/lib/venue/group-by-club";
import { dedupeRelatedVenues } from "@/lib/venue/related-dedup";
import { VenueCard } from "@/components/venue/VenueCard";
import { SportPageMap } from "@/app/[locale]/sports/[sport]/SportPageMap";
import type { VenuePin } from "@/lib/supabase/types";
import {
  buildBreadcrumbJsonLd,
  buildHreflangAlternates,
  buildItemListJsonLd,
  buildPlaceJsonLd,
  jsonLdHtml,
} from "@/lib/seo/metadata";
import { sportActionKey } from "@/lib/seo/sport-action";
import { cityPageHref } from "@/lib/seo/pagination";
import { formatCityName } from "@/lib/format-city";
import { chunk } from "@/lib/utils";

const PAGE_SIZE = 24;
const SITE_URL = "https://sporthubmap.com";
/** En-dessous de ce nombre de lieux *indexables* (≥ seuil qualité), la page
 * sport×ville est trop maigre → noindex (thin content, audit SEO #465). */
const NOINDEX_MIN_VENUES = 5;
/** Plafond de venues récupérées pour une paire sport×ville (scope borné : une
 * ville a au plus quelques centaines de lieux pour un sport). On récupère tout
 * le scope pour filtrer la qualité + paginer côté JS — #464. Au-delà, on
 * tronque (cas rarissime) ; la carte reste exhaustive via l'API, indépendante. */
const MAX_SCOPE_VENUES = 1000;

// Props de la vue partagée : la page courante est passée par la ROUTE (page 1
// pour `/[city]`, N pour `/[city]/page/[n]`) — JAMAIS lue depuis searchParams,
// qui forcerait le rendu dynamique et casserait l'ISR (#191). `revalidate` est
// exporté par les fichiers de route (un module non-route ne peut pas l'exporter).
export type CityPageParams = {
  locale: string;
  sport: string;
  country: string;
  city: string;
};
type ViewProps = CityPageParams & { page: number };

type Ctx = {
  sport: (typeof SPORTS_BY_SLUG)[string];
  city: { id: string; name: string; country_code: string; lat: number | null; lon: number | null };
  /** Nombre EXHAUSTIF de venues publiées du sport dans la ville. Alimente
   * l'overlay de la carte (qui reste exhaustive). */
  total: number;
  /** Venues *indexables* (publiées ET ≥ seuil qualité, #464). Pilotent le
   * noindex et le titre/meta indexé. */
  indexable: DisplayVenue[];
  /** Tout le scope publié (non filtré qualité, borné). Fallback d'affichage
   * quand `indexable` est vide mais que des venues existent (#551). */
  scope: DisplayVenue[];
  /** Suggestions « à proximité » (même sport, communes alentour, ≥ seuil
   * qualité) — uniquement quand `total === 0`, pour ne pas laisser une page
   * sport×ville vide sans alternative (#558). */
  nearby: { slug: string; name: string }[];
};

const resolveContext = cache(async (sport: string, country: string, city: string): Promise<Ctx | null> => {
  const sportDef = SPORTS_BY_SLUG[sport];
  if (!sportDef) return null;

  // Client STATIQUE (service_role, pas de cookies()) : la page est publique
  // (reads is_published=true uniquement) et doit rester ISR-cacheable — le
  // client à cookies forçait `no-store` (#191) et le rôle anon avait un
  // statement_timeout court (cf. bug gym×ville). service_role lève les deux.
  const sb = getSupabaseStaticClient();
  const { data: cityRow } = await sb
    .from("city")
    .select("id, name, country_code, lat, lon")
    .eq("country_code", country.toUpperCase())
    .eq("slug", city)
    .maybeSingle();
  if (!cityRow) return null;

  // Normalise l'affichage (#559) : « PARIS » → « Paris ». Le slug/URL (qui passe
  // par `city`) n'est pas touché — uniquement le nom affiché (titre/H1/breadcrumb).
  const cityRaw = cityRow as Ctx["city"];
  const cityCtx: Ctx["city"] = { ...cityRaw, name: formatCityName(cityRaw.name) };
  // Compteur via la SOURCE COMMUNE (#556) : appartenance au sport ({primary} ∪
  // venue_sport, MV #476) — même logique que la page mondiale /sports/[sport],
  // sinon « Padel Paris : 8 » vs « page Padel » divergeaient. count=exact ICI
  // (borné par city_id, trivial) ; la page mondiale garde "planned" (#335).
  const count = await getVisibleVenueCount(sb, {
    sportSlug: sport,
    cityId: cityCtx.id,
    exact: true,
  });

  // Scope + sous-ensemble indexable (≥ seuil qualité, #464) — partagé entre
  // generateMetadata (noindex) et la page via le cache() (un seul fetch).
  const { indexable, scope } = await fetchScopeVenues(sb, sport, cityCtx);

  // Zéro résultat local → on prépare des suggestions « à proximité » (#558).
  // Calculé UNIQUEMENT dans ce cas (rare) pour ne pas alourdir les pages pleines.
  const nearby = (count ?? 0) === 0 ? await fetchNearbyVenues(sb, sport, cityCtx) : [];

  return {
    sport: sportDef,
    city: cityCtx,
    total: count,
    indexable,
    scope,
    nearby,
  };
});

type VenueRow = {
  id: string;
  slug: string;
  name: string;
  lat: number;
  lon: number;
  family_slug: string;
  primary_sport_slug: string | null;
  address: string | null;
  courts_count: number | null;
  country_code: string | null;
  // Champs du score qualité (#464) — pour exclure les fiches sous seuil de la
  // liste indexable (la même fonction pure isLowQualityVenue que le noindex).
  city_id: string | null;
  website_url: string | null;
  phone: string | null;
  description: string | null;
  claim_status: ScorableVenue["claim_status"];
  enrichments: ScorableVenue["enrichments"];
  source: string | null; // provenance — signal de confiance sur la carte (#607)
  club_id: string | null; // clustering géo (#696) — regroupe les fiches d'un club
};

type DisplayVenue = Omit<VenueRow, "country_code"> & {
  city_name: string;
  country_code?: string;
  sport_slugs: string[];
};

/**
 * Récupère les venues *indexables* du scope sport×ville : publiées, non
 * supprimées, ET passant le gate qualité `isLowQualityVenue` (#464). On
 * récupère tout le scope (borné par MAX_SCOPE_VENUES) puis on filtre + on
 * paginera côté JS — pas de `.range()` SQL, car le filtre qualité décalerait
 * sinon les compteurs/pagination. La carte n'utilise PAS ceci (elle fetche
 * l'API, exhaustive).
 */
async function fetchScopeVenues(
  sb: ReturnType<typeof getSupabaseStaticClient>,
  sportSlug: string,
  city: Ctx["city"],
): Promise<{ indexable: DisplayVenue[]; scope: DisplayVenue[] }> {
  // 2 temps (#556) : ids par APPARTENANCE au sport ({primary} ∪ venue_sport,
  // MV #476 — même logique que la page mondiale, sinon un court de padel d'un
  // Tennis Club manquait sur « Padel Paris ») ; puis les champs riches du
  // scoring qualité depuis `venue` (absents de la MV). Scope ville = borné.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: mvRows, error: mvError } = await (sb as any)
    .from("mv_venue_sport_search")
    .select("venue_id")
    .eq("sport_slug", sportSlug)
    .eq("city_id", city.id)
    .order("venue_id")
    .limit(MAX_SCOPE_VENUES);
  if (mvError || !mvRows?.length) return { indexable: [], scope: [] };
  const ids = (mvRows as { venue_id: string }[]).map((r) => r.venue_id);

  // #633 — BATCHER le filtre `.in("id", ids)`. Une ville dense (gym×Paris ≈ 890
  // venues) produisait une URL GET de plusieurs dizaines de Ko → 414/erreur
  // PostgREST → `error` → scope vide → page « No address » alors que total > 0.
  // On émet une requête par lot d'IDs (URL bornée) en parallèle, puis on fusionne.
  // Résilient : un lot en échec est loggé sans vider toute la page. `source` =
  // signal de provenance affiché sur la carte (#607).
  const SELECT =
    "id, slug, name, lat, lon, family_slug, primary_sport_slug, address, courts_count, country_code, city_id, website_url, phone, description, claim_status, enrichments, source, club_id";
  const batches = await Promise.all(
    chunk(ids, 100).map((batch) =>
      sb
        .from("venue")
        .select(SELECT)
        .in("id", batch)
        // Garde de fraîcheur : la MV est rafraîchie hebdo — une venue dépubliée
        // entre-temps ne doit pas réapparaître.
        .eq("is_published", true)
        .is("deleted_at", null),
    ),
  );
  const rows: VenueRow[] = [];
  for (const b of batches) {
    if (b.error) {
      console.error(
        `[fetchScopeVenues] sport=${sportSlug} city=${city.id} batch error → ` +
          `${b.error.message ?? b.error.code ?? b.error}`,
      );
      continue;
    }
    if (b.data) rows.push(...(b.data as VenueRow[]));
  }
  if (rows.length === 0) return { indexable: [], scope: [] };

  // Noms de clubs (#696) pour regrouper par `club_id` : map club_id → nom, par
  // lots d'ids (URL bornée, RLS SELECT public sur `club`). Best-effort : sans
  // club, on retombe sur le seul regroupement court-level par nom.
  const clubIds = [...new Set(rows.map((r) => r.club_id).filter((c): c is string => !!c))];
  const clubNameById = new Map<string, string>();
  if (clubIds.length > 0) {
    const clubBatches = await Promise.all(
      chunk(clubIds, 100).map((batch) => sb.from("club").select("id, name").in("id", batch)),
    );
    for (const b of clubBatches) {
      for (const c of (b.data as { id: string; name: string }[] | null) ?? []) {
        if (c.id && c.name) clubNameById.set(c.id, c.name);
      }
    }
  }

  // Regroupement + dédup en passes, AVANT scoring/tri/pagination (la page liste
  // des CLUBS, pas des courts/surfaces isolés) :
  //  1. par CLUB (#696) : `groupByClub` — fiches d'un même club_id (clustering
  //     géo 50 m), y compris des SURFACES différentes (« terre battue », « green
  //     set »…) que le regroupement par nom ne réunit pas → UNE card au nom du
  //     club ;
  //  2. court-level (#635) : `groupCourtRecords` — « Court 1/2/3 », « Sportfield
  //     16 piste 1 »… des venues restantes (sans club_id) collapsées par nom+coords ;
  //  3. tri qualité (#637) AVANT dédup (#698 : garder le record le plus riche) ;
  //  4. dédup d'affichage (#698) : un même lieu en PLUSIEURS records (variantes de
  //     nom / sources, ≤ 250 m) ne figure qu'UNE fois. Display-only (#554/#657).
  const grouped = groupCourtRecords(groupByClub(rows, clubNameById)).sort(
    (a, b) =>
      venueQualityScoreForSport(b, sportSlug) - venueQualityScoreForSport(a, sportSlug) ||
      a.id.localeCompare(b.id),
  );
  const scope: DisplayVenue[] = dedupeRelatedVenues(grouped).map((v) => ({
    ...v,
    city_name: city.name,
    country_code: v.country_code ?? city.country_code ?? undefined,
    // Cette venue matche `sportSlug` par appartenance (primary ou venue_sport).
    sport_slugs: [sportSlug],
  }));
  // `indexable` = sous-ensemble ≥ seuil qualité (même fonction pure que le
  // noindex). `scope` = tout le scope publié (non filtré) → FALLBACK d'affichage
  // quand aucune venue n'atteint le seuil mais que des venues existent (#551 :
  // ne jamais montrer « No address » si total > 0 ; la page reste noindex car
  // thin, mais liste de vrais lieux au lieu d'une grille vide). `scope` est déjà
  // trié par qualité (le tri a précédé la dédup).
  // Exclusion des noms contradictoires (#553) : « piscine », « salle de
  // musculation du tennis club »… ne se listent pas sur une page mono-sport,
  // même bien notés (la carte reste exhaustive). Dans le fallback `scope`
  // (page thin #551), on ne supprime pas : on RELÈGUE en fin — la page reste
  // honnête/complète, les douteux ne sont plus des résultats prioritaires.
  const indexable = scope.filter(
    (v) => !isLowQualityVenue(v) && !isSportMismatch(v.name, sportSlug),
  );
  return { indexable, scope: sinkMismatches(scope, sportSlug) };
}

/** Demi-côté de la bbox « à proximité » (~0.7° ≈ 60-80 km selon latitude). */
const NEARBY_BBOX_DEG = 0.7;
const NEARBY_LIMIT = 12;

/**
 * Lieux du même sport À PROXIMITÉ d'une ville (autres communes alentour), pour
 * ne pas laisser une page sport×ville à ZÉRO résultat sans alternative utile
 * (#558, critère « proposer nearby »). Bbox carrée autour du centre-ville ;
 * on ne suggère que des fiches ≥ seuil qualité (pas de squelettes). Liste
 * légère (slug + nom) → simples liens, pas de VenueCard.
 */
async function fetchNearbyVenues(
  sb: ReturnType<typeof getSupabaseStaticClient>,
  sportSlug: string,
  city: Ctx["city"],
): Promise<{ slug: string; name: string }[]> {
  if (city.lat == null || city.lon == null) return [];
  const { data, error } = await sb
    .from("venue")
    .select("slug, name")
    .eq("primary_sport_slug", sportSlug)
    .eq("is_published", true)
    .is("deleted_at", null)
    .gte("quality_score", LOW_QUALITY_THRESHOLD)
    .neq("city_id", city.id)
    .gte("lat", city.lat - NEARBY_BBOX_DEG)
    .lte("lat", city.lat + NEARBY_BBOX_DEG)
    .gte("lon", city.lon - NEARBY_BBOX_DEG)
    .lte("lon", city.lon + NEARBY_BBOX_DEG)
    .limit(NEARBY_LIMIT);
  if (error || !data) return [];
  return (data as { slug: string; name: string }[]).map((v) => ({
    slug: v.slug,
    name: v.name,
  }));
}

/**
 * Top villes pour CE sport (hors ville courante) → maillage interne SEO + UX
 * « changer de ville facilement » (#608). Réutilise la RPC `top_cities_for_sport`
 * (#604, qualité ≥ 25) déjà servie sur /sports/[sport]. Lien vers
 * /[sport]/[pays]/[ville] de chaque ville. Page cachée (force-static) → l'appel
 * RPC est mutualisé pour `revalidate`.
 */
async function fetchOtherCities(
  sportSlug: string,
  currentCitySlug: string,
): Promise<{ slug: string; name: string; country: string; count: number }[]> {
  const sb = getSupabaseStaticClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (sb as any).rpc("top_cities_for_sport", {
    p_sport_slug: sportSlug,
    p_limit: 9,
  });
  const rows =
    (data as { city_name: string; city_slug: string; country_code: string; venue_count: number }[]) ??
    [];
  return rows
    .filter((c) => c.city_slug !== currentCitySlug)
    .slice(0, 6)
    .map((c) => ({
      slug: c.city_slug,
      name: formatCityName(c.city_name),
      country: c.country_code.toLowerCase(),
      count: Number(c.venue_count),
    }));
}

// Métadonnées partagées entre la route page 1 (`/[city]`) et la route paginée
// (`/[city]/page/[n]`). `page` pilote le canonical (auto-canonical par page).
export async function buildCityMetadata({
  locale,
  sport,
  country,
  city,
  page,
}: CityPageParams & { page: number }): Promise<Metadata> {
  const ctx = await resolveContext(sport, country, city);
  const t = await getTranslations({ locale, namespace: "programmatic" });
  const tSports = await getTranslations({ locale, namespace: "sports" });

  if (!ctx) {
    const tVenue = await getTranslations({ locale, namespace: "venue" });
    return { title: tVenue("notFoundTitle") };
  }

  const sportName = tSports.has(ctx.sport.slug)
    ? tSports(ctx.sport.slug)
    : ctx.sport.name_fr;
  // Compteur = venues INDEXABLES (≥ seuil qualité), pas le total exhaustif :
  // le titre/meta doit refléter ce qui est réellement listé/indexé (#464).
  const indexableCount = ctx.indexable.length;
  // Titre sans le compteur quand 0 résultat indexable : évite « … (0 adresses) »
  // indexé (audit SEO #465). Pour ≥ 1, on garde le compteur (chiffre réel utile).
  // Verbe adapté au sport (#560) : « où s'entraîner » pour la gym, « où pratiquer »
  // pour le yoga, « où se détendre » pour spa/sauna… au lieu de « où jouer » partout.
  const actionKey = sportActionKey(ctx.sport.family_slug, ctx.sport.slug);
  const title =
    indexableCount === 0
      ? t("titleNoCount", {
          sport: sportName,
          city: ctx.city.name,
          action: t(`action.${actionKey}`),
        })
      : t("title", { sport: sportName, city: ctx.city.name, count: indexableCount });
  const description = t("description", {
    sport: sportName.toLowerCase(),
    city: ctx.city.name,
    count: indexableCount,
  }).slice(0, 160);
  // noindex des pages trop maigres (< seuil de lieux indexables) : thin content
  // (#465). follow:true → on laisse Google suivre les liens internes.
  const lowQuality = indexableCount < NOINDEX_MIN_VENUES;
  // Auto-canonical par page : page 1 = chemin de base, pages 2+ = /page/N
  // (même URL que les liens de pagination → pas de duplicate-content).
  const path = cityPageHref(`/${sport}/${country}/${city}`, page);
  // hreflang : page programmatique sport×ville déclinée en FR/EN/ZH (#108).
  const hreflang = buildHreflangAlternates(path, locale);

  return {
    title,
    description,
    ...(lowQuality ? { robots: { index: false, follow: true } } : {}),
    alternates: {
      canonical: hreflang.canonical,
      languages: hreflang.languages,
    },
    openGraph: { type: "website", url: `${SITE_URL}${path}`, title, description },
  };
}

// Vue partagée (rendue par les 2 routes). `page` vient de la ROUTE, pas de
// searchParams → la page reste statique/ISR. `setRequestLocale` est appelé par
// la route AVANT ce composant.
export async function CityPageView({ locale, sport, country, city, page }: ViewProps) {
  const ctx = await resolveContext(sport, country, city);
  if (!ctx) notFound();

  const t = await getTranslations("programmatic");
  const tSport = await getTranslations("sport");
  const tFamilies = await getTranslations("families");
  const tSports = await getTranslations("sports");

  // Autres villes pour ce sport (#608) — maillage interne + « changer de ville ».
  const otherCities = await fetchOtherCities(sport, city);

  // Liste affichée : venues indexables (≥ qualité) si présentes, SINON fallback
  // sur tout le scope publié (#551 — ne jamais afficher « No address » / une
  // grille vide quand des venues existent ; la page reste noindex car thin via
  // `indexableCount`). La carte reste exhaustive (fetch API indépendant) — #464.
  const indexableCount = ctx.indexable.length;
  const display = indexableCount > 0 ? ctx.indexable : ctx.scope;
  const displayCount = display.length;
  const totalPages = Math.max(1, Math.ceil(displayCount / PAGE_SIZE));
  // Page hors plage (au-delà de la dernière) → 404 : on n'indexe pas d'URL
  // paginée vide. Page 1 reste toujours valide (page canonique, même si liste
  // vide → message "emptyMessage").
  if (page > totalPages) notFound();
  const offset = (page - 1) * PAGE_SIZE;
  const venues = display.slice(offset, offset + PAGE_SIZE);
  const family = FAMILIES_BY_SLUG[ctx.sport.family_slug];
  const basePath = `/${sport}/${country}/${city}`;
  const sportName = tSports.has(ctx.sport.slug) ? tSports(ctx.sport.slug) : ctx.sport.name_fr;

  // Sports voisins (même famille) → maillage interne SEO « sports proches
  // à {ville} » (#465). On lie la même ville pour chaque sport voisin.
  const relatedSports = getRelatedSports(ctx.sport.slug).filter((s) =>
    tSports.has(s),
  );

  // ── Schema.org JSON-LD : BreadcrumbList + Place (ville) + ItemList (venues).
  //    Trois marqueurs distincts pour aider Google à comprendre que la page
  //    parle d'un sport ET d'un lieu géographique ET liste des venues.
  const cityUrl = `${SITE_URL}/${locale}${basePath}`;
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Sport Hub", url: SITE_URL },
    {
      name: sportName,
      url: `${SITE_URL}/${locale}/sports/${ctx.sport.slug}`,
    },
    { name: ctx.city.name, url: cityUrl },
  ]);
  const placeJsonLd = buildPlaceJsonLd({
    name: ctx.city.name,
    country_code: ctx.city.country_code,
    url: cityUrl,
  });
  const itemListJsonLd = buildItemListJsonLd(
    `${sportName} · ${ctx.city.name}`,
    venues.map((v) => ({
      name: v.name,
      url: `${SITE_URL}/${locale}/venue/${v.slug}`,
    })),
  );

  return (
    <main className="container mx-auto max-w-6xl px-6 py-12">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(breadcrumbJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(placeJsonLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: jsonLdHtml(itemListJsonLd) }}
      />
      <header className="border-b pb-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Sport Hub
          </Link>
          <span aria-hidden="true">/</span>
          <Link href={`/sports/${sport}`} className="hover:text-foreground">
            {tFamilies(ctx.sport.family_slug)}
          </Link>
          <span aria-hidden="true">/</span>
          <span>{ctx.city.name}</span>
        </div>
        <h1 className="mt-2 flex items-center gap-3 text-3xl font-bold tracking-tight">
          <span aria-hidden="true">{ctx.sport.emoji || family?.emoji}</span>
          {t("h1", { sport: sportName, city: ctx.city.name })}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t("addresses", { count: displayCount })}
          {totalPages > 1 && (
            <span className="text-sm">
              {" "}
              · {tSport("page", { current: page, total: totalPages })}
            </span>
          )}
        </p>
      </header>

      {/* Contenu local : court paragraphe descriptif pour donner du texte
          indexable à la page (au-delà de la simple liste), audit SEO #465. */}
      <p className="mt-6 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        {t("localIntro", { sport: sportName.toLowerCase(), city: ctx.city.name })}
      </p>

      {/* Sports proches dans la même ville → maillage interne (#465). */}
      {relatedSports.length > 0 && (
        <nav
          className="mt-4 flex flex-wrap items-center gap-2 text-sm"
          aria-label={t("relatedTitle", { city: ctx.city.name })}
        >
          <span className="font-medium text-foreground">
            {t("relatedTitle", { city: ctx.city.name })} :
          </span>
          {relatedSports.map((s) => (
            <Link
              key={s}
              href={`/${s}/${country}/${city}`}
              className="rounded-full border px-3 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {tSports(s)}
            </Link>
          ))}
        </nav>
      )}

      {ctx.total === 0 ? (
        <div className="mt-12 text-center text-muted-foreground">
          <p>
            {t("emptyMessage", { sport: sportName, city: ctx.city.name })}{" "}
            <Link
              href={`/sports/${sport}`}
              className="underline hover:text-foreground"
            >
              {t("seeOtherCities")}
            </Link>
          </p>
          {/* Suggestions « à proximité » (#558) : on ne laisse pas la page vide
              quand le sport n'a aucun lieu dans CETTE ville mais existe alentour. */}
          {ctx.nearby.length > 0 && (
            <div className="mt-6">
              <p className="text-sm font-medium text-foreground">
                {t("nearbyTitle", { sport: sportName.toLowerCase(), city: ctx.city.name })}
              </p>
              <ul className="mt-3 flex flex-wrap justify-center gap-2">
                {ctx.nearby.map((v) => (
                  <li key={v.slug}>
                    <Link
                      href={`/venue/${v.slug}`}
                      className="inline-flex rounded-full border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
                    >
                      {v.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-6 text-sm">
            {t("addVenuePrompt")}{" "}
            <Link href="/contribute" className="underline hover:text-foreground">
              {t("addVenueCta")}
            </Link>
          </p>
        </div>
      ) : (
        <>
          {/* Carte TOUJOURS exhaustive : rendue dès qu'il existe ≥ 1 spot
              (ctx.total), même si la liste indexable filtrée est vide (#464).
              SportPageMap refetche l'API → la carte ignore le filtre qualité. */}
          <div className="mt-6">
            <SportPageMap
              sportSlug={sport}
              initialVenues={
                venues.map((v) => ({
                  id: v.id,
                  slug: v.slug,
                  name: v.name,
                  lat: v.lat,
                  lon: v.lon,
                  family_slug: v.family_slug,
                  primary_sport_slug: v.primary_sport_slug,
                })) as VenuePin[]
              }
              totalSportVenues={ctx.total}
              cityCenter={
                ctx.city.lat != null && ctx.city.lon != null
                  ? { lat: ctx.city.lat, lon: ctx.city.lon }
                  : undefined
              }
            />
          </div>

          {venues.length === 0 ? (
            /* Des spots existent (carte) mais aucun n'atteint le seuil qualité
               pour être listé/indexé (#464). On invite à enrichir/contribuer. */
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t("addVenuePrompt")}{" "}
              <Link href="/contribute" className="underline hover:text-foreground">
                {t("addVenueCta")}
              </Link>
            </p>
          ) : (
            <>
              <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {venues.map((v) => (
                  <VenueCard key={v.id} venue={v} />
                ))}
              </section>

              {totalPages > 1 && (
            <nav
              className="mt-12 flex items-center justify-center gap-4 text-sm"
              aria-label="Pagination"
            >
              {page > 1 ? (
                <Link
                  href={cityPageHref(basePath, page - 1)}
                  className="rounded-md border px-3 py-2 hover:bg-accent"
                >
                  {tSport("previous")}
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">
                  {tSport("previous")}
                </span>
              )}
              <span className="text-muted-foreground">
                {tSport("page", { current: page, total: totalPages })}
              </span>
              {page < totalPages ? (
                <Link
                  href={cityPageHref(basePath, page + 1)}
                  className="rounded-md border px-3 py-2 hover:bg-accent"
                >
                  {tSport("next")}
                </Link>
              ) : (
                <span className="rounded-md border px-3 py-2 opacity-40">
                  {tSport("next")}
                </span>
              )}
            </nav>
              )}
            </>
          )}
        </>
      )}

      {/* Autres villes pour ce sport (#608) — maillage interne SEO + UX
          « changer de ville ». Toujours rendu (utile même si la ville courante
          est vide : « pas ici, mais essayez ces villes »). */}
      {otherCities.length > 0 && (
        <section className="mt-12 border-t pt-6">
          <h2 className="text-sm font-medium text-foreground">
            {t("otherCitiesTitle", { sport: sportName })}
          </h2>
          <nav
            className="mt-3 flex flex-wrap gap-2"
            aria-label={t("otherCitiesTitle", { sport: sportName })}
          >
            {otherCities.map((c) => (
              <Link
                key={`${c.country}-${c.slug}`}
                href={`/${sport}/${c.country}/${c.slug}`}
                className="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {c.name}
                <span className="text-xs opacity-60">({c.count})</span>
              </Link>
            ))}
          </nav>
        </section>
      )}
    </main>
  );
}
