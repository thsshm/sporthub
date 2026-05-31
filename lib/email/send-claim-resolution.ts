/**
 * Envoi d'email au requester d'une demande de claim après résolution
 * (approve / reject) par un admin — issue #90.
 *
 * STATUS : stub. Aucun provider d'email n'est configuré dans le projet
 * pour l'instant. Le contenu du mail est log via `console.log` (préfixe
 * `[email:claim]`) et l'interface est prête à brancher un provider réel
 * (Resend recommandé, Postmark alternatif).
 *
 * Comment plugger un provider (Resend) en 5-10 lignes :
 *   1. `pnpm add resend`
 *   2. Ajouter `RESEND_API_KEY` à `.env.local` + Vercel
 *   3. Dans `sendEmail()` ci-dessous, remplacer le `console.log` par :
 *        const { Resend } = await import("resend");
 *        const resend = new Resend(process.env.RESEND_API_KEY!);
 *        await resend.emails.send({
 *          from: process.env.EMAIL_FROM ?? "noreply@sporthubmap.com",
 *          to: payload.to,
 *          subject: payload.subject,
 *          html: payload.html,
 *          text: payload.text,
 *        });
 *   4. (Optionnel) garder le `console.log` derrière un flag `EMAIL_DEBUG=1`.
 */

export type ClaimResolutionType = "approve" | "reject";

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export type ClaimEmailVenue = {
  name: string;
  slug: string;
};

const FROM = process.env.EMAIL_FROM ?? "noreply@sporthubmap.com";
const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://sporthubmap.com";

function venueUrl(venue: ClaimEmailVenue): string {
  return `${SITE_URL}/venue/${venue.slug}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderAdminNoteHtml(adminNote: string | null): string {
  if (!adminNote || adminNote.trim().length === 0) return "";
  return `<p><strong>Note de l'équipe&nbsp;:</strong></p><blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#555;white-space:pre-line;">${escapeHtml(adminNote)}</blockquote>`;
}

function renderAdminNoteText(adminNote: string | null): string {
  if (!adminNote || adminNote.trim().length === 0) return "";
  return `\nNote de l'équipe :\n${adminNote}\n`;
}

/**
 * Construit l'email d'approbation pour le requester.
 * Exporté pour pouvoir le tester unitairement.
 */
export function buildApprovalEmail(
  venue: ClaimEmailVenue,
  adminNote: string | null,
): Omit<EmailPayload, "to"> {
  const subject = `Votre demande pour "${venue.name}" a été approuvée`;
  const url = venueUrl(venue);
  const html = `
<p>Bonjour,</p>
<p>Bonne nouvelle&nbsp;: votre demande de claim pour <strong>${escapeHtml(venue.name)}</strong> a été approuvée par l'équipe SportHub.</p>
<p>Vous pouvez désormais administrer cette fiche et la mettre à jour&nbsp;:<br/>
<a href="${url}">${url}</a></p>
${renderAdminNoteHtml(adminNote)}
<p>Bienvenue dans la communauté SportHub&nbsp;!</p>
<p>— L'équipe SportHub</p>
`.trim();

  const text = `Bonjour,

Bonne nouvelle : votre demande de claim pour "${venue.name}" a été approuvée par l'équipe SportHub.

Vous pouvez désormais administrer cette fiche et la mettre à jour :
${url}
${renderAdminNoteText(adminNote)}
Bienvenue dans la communauté SportHub !

— L'équipe SportHub`;

  return { subject, html, text };
}

/**
 * Construit l'email de rejet pour le requester.
 * Exporté pour pouvoir le tester unitairement.
 */
export function buildRejectionEmail(
  venue: ClaimEmailVenue,
  adminNote: string | null,
): Omit<EmailPayload, "to"> {
  const subject = `Votre demande pour "${venue.name}" n'a pas pu être validée`;
  const url = venueUrl(venue);
  const html = `
<p>Bonjour,</p>
<p>Merci d'avoir contacté SportHub au sujet de <strong>${escapeHtml(venue.name)}</strong>.</p>
<p>Après examen, nous n'avons pas pu valider votre demande de claim pour le moment.</p>
${renderAdminNoteHtml(adminNote)}
<p>Vous pouvez nous recontacter avec de nouveaux éléments si la situation évolue. Le spot reste accessible publiquement&nbsp;:<br/>
<a href="${url}">${url}</a></p>
<p>— L'équipe SportHub</p>
`.trim();

  const text = `Bonjour,

Merci d'avoir contacté SportHub au sujet de "${venue.name}".

Après examen, nous n'avons pas pu valider votre demande de claim pour le moment.
${renderAdminNoteText(adminNote)}
Vous pouvez nous recontacter avec de nouveaux éléments si la situation évolue. Le spot reste accessible publiquement :
${url}

— L'équipe SportHub`;

  return { subject, html, text };
}

/**
 * Stub d'envoi d'email. Log le payload en console (préfixe `[email:claim]`).
 *
 * À remplacer par un appel provider réel (Resend / Postmark). Voir le
 * commentaire en tête de fichier.
 */
async function sendEmail(payload: EmailPayload, type: ClaimResolutionType): Promise<void> {
  // TODO(#90 follow-up) : brancher Resend / Postmark.
  // Pour l'instant, on log le payload complet pour qu'il soit traçable
  // côté Vercel Logs / dev console.
  console.log("[email:claim]", JSON.stringify({
    from: FROM,
    to: payload.to,
    subject: payload.subject,
    body: payload.text,
    type,
  }));
}

/**
 * Envoie l'email de résolution au requester d'une demande de claim.
 *
 * Ne throw pas : les erreurs d'envoi ne doivent pas bloquer la transaction
 * admin (l'état DB est déjà cohérent à ce stade). Si l'envoi échoue, on
 * log côté monitoring et on continue.
 */
export async function sendClaimResolutionEmail(params: {
  to: string;
  type: ClaimResolutionType;
  venue: ClaimEmailVenue;
  adminNote: string | null;
}): Promise<void> {
  const { to, type, venue, adminNote } = params;
  const built =
    type === "approve"
      ? buildApprovalEmail(venue, adminNote)
      : buildRejectionEmail(venue, adminNote);

  try {
    await sendEmail({ to, ...built }, type);
  } catch (err) {
    // Pas de captureException ici pour ne pas créer une dépendance circulaire
    // monitoring → email. L'appelant log déjà via captureException si besoin.
    console.error("[email:claim] send failed", err);
  }
}
