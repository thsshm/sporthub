"use client";

import type { ClubPin } from "@/lib/supabase/types";
import { getFamilyColor, getFamilyEmoji } from "@/lib/families";

/**
 * Pin "club" affiché au zoom < 16 (cf. #130 vue club V1).
 *
 * Différences avec le pin venue individuel :
 *   - 42px de diamètre (vs 12px du pin venue) — un club représente N courts,
 *     donc visuellement plus marquant.
 *   - Icône emoji de la famille au centre (au lieu d'un point coloré simple).
 *   - Badge top-right avec `courts_count` (compteur "[N] courts" en V1 spec).
 *   - Click → zoom +3 (passage à la vue venues individuels à zoom ≥ 16).
 *
 * Ce composant ne dépend PAS de react-map-gl directement — il rend uniquement
 * son contenu visuel. Le wrapping dans <Marker latitude lon> et le branchement
 * fetch reste dans MapClient.tsx (à brancher dans une issue follow-up, cf.
 * #130 acceptance : "Si tu peux pas faire ça sans toucher significativement
 * MapClient.tsx → laisse le branchement en TODO doc"). Un agent #132 est
 * actuellement sur MapClient.tsx — on évite le conflit en livrant la base
 * isolée (DB + API + ClubMarker) et le branchement viendra ensuite.
 *
 * Usage typique côté MapClient une fois branché :
 * ```tsx
 * <Marker latitude={club.lat} longitude={club.lon} anchor="center"
 *         onClick={(e) => { e.originalEvent.stopPropagation(); onZoomIn(); }}>
 *   <ClubMarker club={club} onClick={() => zoomTo(club.lat, club.lon, currentZoom + 3)} />
 * </Marker>
 * ```
 */
export type ClubMarkerProps = {
  club: ClubPin;
  /** Callback déclenché au clic — typiquement zoom +3 vers le club. */
  onClick?: () => void;
};

/** Diamètre fixe du pin club (V1). Plus grand qu'un pin venue (~12px) pour
 *  différencier visuellement "agrégat" vs "spot individuel". */
const CLUB_PIN_SIZE_PX = 42;

export default function ClubMarker({ club, onClick }: ClubMarkerProps) {
  const color = getFamilyColor(club.family_slug);
  const emoji = getFamilyEmoji(club.family_slug);
  // Badge affiché uniquement si > 1 court — sinon l'agrégat n'apporte rien
  // visuellement (et on devrait techniquement afficher le venue direct, mais
  // c'est au caller de décider). On cap à "99+" pour ne pas casser le layout.
  const showBadge = club.courts_count > 1;
  const badgeLabel = club.courts_count > 99 ? "99+" : String(club.courts_count);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      aria-label={`${club.name} — ${club.courts_count} courts`}
      title={club.name}
      className="relative flex cursor-pointer items-center justify-center rounded-full border-2 border-white text-white shadow-lg transition-transform hover:scale-110"
      style={{
        backgroundColor: color,
        width: CLUB_PIN_SIZE_PX,
        height: CLUB_PIN_SIZE_PX,
        fontSize: 22,
        lineHeight: 1,
      }}
    >
      <span aria-hidden="true">{emoji}</span>

      {showBadge && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white bg-gray-900 px-1 text-[11px] font-semibold leading-none text-white"
        >
          {badgeLabel}
        </span>
      )}
    </button>
  );
}
