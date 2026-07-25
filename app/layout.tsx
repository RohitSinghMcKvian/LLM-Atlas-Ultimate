import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
// The highlight.js theme lives in components/markdown.tsx, next to the
// rehype-highlight plugin that needs it, so it ships only with the routes that
// actually render markdown rather than on every page including the landing.
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://llmatlas.xyz";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "LLM Atlas — The open ecosystem for everything LLM",
    template: "%s · LLM Atlas",
  },
  description:
    "The entire LLM universe, mapped and navigable from one open workspace. Learn, research, compare, cost, and build — with a shared agent runtime underneath.",
  keywords: [
    "LLM",
    "AI",
    "model leaderboard",
    "AI cost calculator",
    "multi-model compare",
    "agentic coding",
    "open source AI workspace",
  ],
  authors: [{ name: "LLM Atlas" }],
  openGraph: {
    title: "LLM Atlas — The open ecosystem for everything LLM",
    description:
      "The entire LLM universe, mapped and navigable from one open workspace.",
    url: siteUrl,
    siteName: "LLM Atlas",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "LLM Atlas",
    description:
      "The entire LLM universe, mapped and navigable from one open workspace.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0A0B0F" },
    { media: "(prefers-color-scheme: light)", color: "#F8F9FC" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(sans.variable, display.variable, mono.variable)}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen bg-background font-sans text-foreground"
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
