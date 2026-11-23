import type { Metadata, Viewport } from "next";
import { Caveat, Petrona, Roboto } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: "AI Commerce OS",
  description: "Evidence-linked market research, competitor intelligence, sourcing and unit economics for product businesses.",
};

const petrona = Petrona({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"], variable: "--font-petrona", display: "swap" });
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: ["500", "600"], variable: "--font-caveat", display: "swap" });

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${petrona.variable} ${roboto.variable} ${caveat.variable}`}>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
