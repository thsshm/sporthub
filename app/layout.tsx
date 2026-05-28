// Root layout minimal — la vraie structure html/body est dans app/[locale]/layout.tsx
// (next-intl recommended setup with i18n routing).
// Ce root est utilisé uniquement pour /api/*, /auth/*, /sitemap.xml, /robots.txt
// qui ne passent pas par le middleware locale.

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
