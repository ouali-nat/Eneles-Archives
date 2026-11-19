import "@/app/globals.css";
import Script from "next/script";
import { Metadata, Viewport } from "next";
import { siteConfig } from "@/config/site";
import { fontSans, fontMono } from "@/lib/fonts";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "@/components/essential/layout/ThemeProvider";
import { SiteFooter } from "@/components/essential/layout/SiteFooter";
import { SiteHeader } from "@/components/essential/layout/SiteHeader";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/lib/auth-context";
import { motionBootScript } from "@/lib/appearance";
import { MotionProvider } from "@/components/essential/layout/MotionProvider";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f2f2" },
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
  ],
};

export const metadata: Metadata = {
  // Relative addresses in any page's metadata (canonical links, Open Graph images) resolve against the public site, never the server's own address.
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s - ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [
    "LaTeX",
    "LaTeX editor",
    "Collaborative LaTeX",
    "Track changes",
    "Overleaf alternative",
    "TikZ",
  ],
  authors: [
    {
      name: "Eneles",
      url: "https://aurore-section-archivescom.vercel.app",
    },
  ],
  creator: "Eneles",
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteConfig.url,
    title: siteConfig.name,
    description: siteConfig.description,
    siteName: siteConfig.name,
    images: [
      {
        url: siteConfig.ogImage,
        width: 1200,
        height: 630,
        alt: siteConfig.name,
      },
    ],
  },
  icons: {
    icon: "/favicon.ico",
    // shortcut: "/favicon-16x16.png",
    // apple: "/apple-touch-icon.png",
  },
};

interface RootLayoutProps {
  children: React.ReactNode;
}

/** Umami's settings. `UMAMI_WEBSITE_ID` is the old name of the site's id, still read. */
const UMAMI = {
  script: process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL?.trim() || "",
  recorder: process.env.NEXT_PUBLIC_UMAMI_RECORDER_URL?.trim().replace(/\/+$/, "") || "",
  websiteId: process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID?.trim() || process.env.UMAMI_WEBSITE_ID?.trim() || "",
};

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <>
      <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
        <head>
          <meta name="darkreader-lock" />
          {/* The motion level applies before first paint; see lib/appearance.ts. */}
          <script dangerouslySetInnerHTML={{ __html: motionBootScript }} />
        </head>

        <body
          suppressHydrationWarning
          className={cn(
            "min-h-screen bg-background font-sans text-foreground antialiased",
            "flex flex-col",
            fontSans.variable,
            fontMono.variable,
          )}
        >
          <ThemeProvider
            attribute="data-mode"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <MotionProvider>
              <AuthProvider>
                {/* Pages size from this container, never the window; panes inside declare their own. */}
                <div className="@container flex w-full min-w-0 flex-1 flex-col">{children}</div>
              </AuthProvider>
            </MotionProvider>
          </ThemeProvider>
          <Toaster />
          {/* Umami, self-hosted: on only when the script and the site's id are set. The recorder is where it sends events (its own host when unset). */}
          {UMAMI.script && UMAMI.websiteId && <Script defer src={UMAMI.script} data-website-id={UMAMI.websiteId} {...(UMAMI.recorder ? { "data-host-url": UMAMI.recorder } : {})} strategy="afterInteractive" />}
        </body>
      </html>
    </>
  );
}
