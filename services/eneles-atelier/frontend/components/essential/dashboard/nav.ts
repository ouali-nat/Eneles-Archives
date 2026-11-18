import { BarChart3, BookOpen, FileCode, FileText, FolderOpen, Home, LayoutTemplate, ScrollText, Settings, UserCircle } from "@/components/icons";

export type NavItem = { title: string; url: string; icon: typeof Home };
export type NavGroup = { id: string; label: string; items: NavItem[] };

/** The signed-in navigation, in two groups: what you work on, and what you work from. */
export const navGroups: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: Home },
      { title: "Projects", url: "/projects", icon: FolderOpen },
      { title: "Snips", url: "/snips", icon: FileCode },
      { title: "PDFs", url: "/pdfs", icon: FileText },
      { title: "Statistics", url: "/statistics", icon: BarChart3 },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    items: [
      { title: "Templates", url: "/templates", icon: LayoutTemplate },
      { title: "Library", url: "/library", icon: BookOpen },
      { title: "Docs", url: "/docs", icon: ScrollText },
    ],
  },
];

/** Pages of the account, reached from the account menu rather than the navigation; search lists them too. */
export const accountPages = [
  { title: "Profile", href: "/profile", icon: UserCircle },
  { title: "Settings", href: "/settings", icon: Settings },
];

/** What the sidebar's account menu lists: the account's pages when signed in, and any pages that need no account when signed out (the site has none; the app has its own Settings). */
export const accountMenu: { signedIn: ("profile" | "settings" | "ai")[]; signedOut: ("settings")[] } = {
  signedIn: ["profile", "settings", "ai"],
  signedOut: [],
};

export const isActive = (pathname: string | null, url: string) => pathname === url || (url !== "/dashboard" && !!pathname?.startsWith(`${url}/`));
