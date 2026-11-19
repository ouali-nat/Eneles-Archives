import type { MetadataRoute } from "next";
import { siteConfig } from "@/config/site";

// Served same-origin at /manifest.webmanifest and linked automatically. The old absolute the old upstream absolute site.webmanifest URL link pointed at a file that never existed, and on localhost the CSP blocked it.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: siteConfig.name,
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/branding/rounded/Dark_400.png", sizes: "400x400", type: "image/png" },
    ],
  };
}
