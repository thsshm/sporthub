import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/layout/Nav";
import { Footer } from "@/components/layout/Footer";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2d7a3e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="flex min-h-screen flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
