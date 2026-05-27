import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "SportHub — Carte mondiale des spots sportifs",
    template: "%s · SportHub",
  },
  description:
    "Trouve où pratiquer ton sport partout dans le monde : tennis, padel, surf, yoga, foot, pétanque et plus de 50 disciplines.",
  metadataBase: new URL("https://sporthubmap.com"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
