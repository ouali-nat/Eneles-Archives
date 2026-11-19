"use client";

import { Suspense, createContext, useContext, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { BrandMarks } from "@/components/BrandMarks";
import { ChevronUp, CreditCard, ExternalLink, FileStack, Globe, HardDrive, LayoutDashboard, LogOut, Mail, Monitor, Moon, ScrollText, Server, Sparkles, Sun, Users } from "@/components/icons";
import { Avatar } from "@/components/people/Avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AuthCard, authInput } from "@/components/essential/auth/AuthFrame";
import { VerificationModal } from "@/components/essential/auth/OTPModal";
import { ModeToggle } from "@/components/essential/layout/ModeToggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { API_URL, ApiError, apiFetch } from "@/lib/api";
import { adminAPI, type AdminMe } from "@/lib/api/admin";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { AdminLink, useAdminBase, useSiteHome } from "./parts";
import { LoadingScreen } from "@/components/essential/status/LoadingScreen";
import { StatusPage } from "@/components/essential/status/StatusPage";

const NAV: { to: string; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { to: "", label: "Overview", icon: LayoutDashboard },
  { to: "/users", label: "Users", icon: Users },
  { to: "/sessions", label: "Sessions", icon: Globe },
  { to: "/billing", label: "Billing", icon: CreditCard },
  { to: "/content", label: "Content", icon: FileStack },
  { to: "/storage", label: "Storage", icon: HardDrive },
  { to: "/ai", label: "AI usage", icon: Sparkles },
  { to: "/emails", label: "Email", icon: Mail },
  { to: "/audit", label: "Audit log", icon: ScrollText },
  { to: "/system", label: "System", icon: Server },
];

/** The frame around the sign-in card and the "not an administrator" card. */
function Stage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between px-5 @min-[40rem]:px-8">
        <span className="inline-flex items-center gap-3">
          <BrandMarks.logo className="h-5 w-auto fill-foreground" />
          <span className="type-small font-medium text-muted-foreground">Admin</span>
        </span>
        <ModeToggle />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">{children}</main>
    </div>
  );
}

const stay = () => {};

/**
 * The panel's front door: an email address, then the six-digit code sent to it. There are no passwords. Codes go only to administrators, and the server limits how often they are sent.
 */
function SignIn() {
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email) return;
    setBusy(true);
    try {
      const result = await adminAPI.requestCode(email);
      setCodeFor(result.email);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send a code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stage>
      <AuthCard title="Admin sign-in">
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="admin-email">Email</Label>
            <Input id="admin-email" name="email" type="email" autoComplete="username" autoFocus required disabled={busy} className={authInput} />
          </div>
          <Button size="lg" className="w-full" type="submit" disabled={busy}>
            {busy ? "Sending code" : "Send code"}
          </Button>
          <p className="type-small text-muted-foreground">We email a six-digit code to administrators.</p>
        </form>
      </AuthCard>
      {/* The gate re-renders into the panel as soon as the sign-in lands. The handler is still passed: without one the dialog sends people to the dashboard. */}
      {codeFor && <VerificationModal email={codeFor} isOpen onClose={() => setCodeFor(null)} onSuccess={stay} onResend={() => adminAPI.requestCode(codeFor)} />}
    </Stage>
  );
}

/** Ends the session and returns to the panel's front door. The site's own sign-out goes to /login, which the admin host does not have. */
async function signOut(base: string) {
  try {
    await apiFetch(`${API_URL}/auth/logout`, { method: "POST" });
  } catch {
    // Signing out anyway.
  }
  document.cookie = `texer_signed_in=; max-age=0; path=/; samesite=lax${window.location.protocol === "https:" ? "; secure" : ""}`;
  window.location.assign(base || "/");
}

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

const noop = () => () => {};

/**
 * The administrator's own row at the foot of the sidebar: face, name, and address, opening a menu with the theme, a way back to the site, and Sign out. On a narrow screen only the face shows, at the end of the top bar.
 */
function AccountMenu({ admin, compact = false }: { admin: AdminMe; compact?: boolean }) {
  const { user } = useAuth();
  const base = useAdminBase();
  const site = useSiteHome();
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const current = THEMES.find((t) => t.value === (mounted ? theme : "system")) ?? THEMES[0];
  const person = { id: admin.id, name: admin.name, email: admin.email, avatarUrl: user?.id === admin.id ? user.avatarUrl : null };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button type="button" aria-label={`Account menu for ${admin.name}`} className="grid size-[var(--control-height)] place-items-center rounded-full transition-colors hover:bg-surface-hover data-[state=open]:bg-surface-hover">
            <Avatar person={person} size="md" decorative />
          </button>
        ) : (
          <button type="button" aria-label={`Account menu for ${admin.name}`} className="flex h-12 w-full items-center gap-2.5 rounded-[var(--radius)] px-2 text-start transition-colors hover:bg-surface-hover data-[state=open]:bg-surface-hover">
            <Avatar person={person} size="md" decorative />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate type-base font-medium">{admin.name}</span>
              <span className="truncate type-small text-muted-foreground">{admin.email}</span>
            </span>
            <ChevronUp aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={compact ? "bottom" : "top"} align={compact ? "end" : "start"} sideOffset={6} className={cn("min-w-60", !compact && "w-[var(--radix-dropdown-menu-trigger-width)]")}>
        <DropdownMenuLabel className="flex items-center gap-3 px-2 py-2">
          <Avatar person={person} size="lg" decorative />
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate type-base font-medium">{admin.name}</span>
            <span className="truncate type-small font-normal text-muted-foreground">{admin.email}</span>
            <span className="type-small font-normal text-muted-foreground">{admin.root ? "Root administrator" : "Administrator"}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="h-10">
            <current.icon className="size-4 text-muted-foreground" />
            <span className="flex-1">Theme</span>
            <span className="text-muted-foreground">{current.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-40">
            <DropdownMenuRadioGroup value={current.value} onValueChange={setTheme}>
              {THEMES.map((t) => (
                <DropdownMenuRadioItem key={t.value} value={t.value} className="h-10">
                  {t.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem asChild className="h-10">
          <a href={site}>
            <ExternalLink />
            Back to Eneles
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="h-10" onSelect={() => void signOut(base)}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const AdminMeContext = createContext<AdminMe | null>(null);

/** The administrator who is signed in, for a page that shows a control only to the root account. */
export function useAdminMe(): AdminMe | null {
  return useContext(AdminMeContext);
}

type Gate = { state: "checking" } | { state: "ok"; admin: AdminMe } | { state: "denied"; message: string } | { state: "error"; message: string; unreachable?: boolean };

/**
 * Everything under the admin panel renders inside this. It shows the sign-in when nobody is signed in, a refusal when the account is not an operator, and the panel otherwise. The check here is for the interface only: the API refuses every admin route on its own, whatever the page does.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { user, isInitialized, isAuthenticated } = useAuth();
  const base = useAdminBase();
  const site = useSiteHome();
  const pathname = usePathname() ?? "";
  const [gate, setGate] = useState<Gate>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);
  const signedIn = isInitialized && (isAuthenticated || !!user);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    adminAPI
      .me()
      .then((admin) => !cancelled && setGate({ state: "ok", admin }))
      .catch((err: unknown) => {
        if (cancelled) return;
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 403) setGate({ state: "denied", message: err instanceof Error ? err.message : "This account is not an administrator." });
        else if (status === 404) setGate({ state: "denied", message: "The admin panel is not available on this server." });
        else if (status === 401) setGate({ state: "error", message: "The API did not recognize this sign-in. Sign out, then sign in again." });
        else if (status === 0) setGate({ state: "error", unreachable: true, message: `Could not reach the API at ${API_URL}. Check that it is running.` });
        else setGate({ state: "error", message: `The API answered with an error (${status}). Try again in a moment.` });
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, user?.id, attempt]);

  // While the sign-in and the operator check are on their way: the quiet loading screen, since the panel's frame depends on who is signed in.
  if (!isInitialized) return <LoadingScreen label="Loading the admin panel" />;
  if (!signedIn) return <SignIn />;
  if (gate.state === "checking") return <LoadingScreen label="Loading the admin panel" />;

  if (gate.state !== "ok") {
    const retry = () => (setGate({ state: "checking" }), setAttempt((n) => n + 1));
    const signedInAs = user?.email && (
      <p className="mt-6 type-small text-muted-foreground">
        Signed in as <span className="text-foreground">{user.email}</span>.
      </p>
    );
    // The site's status pages, with the panel's own reason in place of the default sentence (the API's messages may end without a full stop).
    const reason = /[.!?]$/.test(gate.message.trim()) ? gate.message : `${gate.message.trim()}.`;
    if (gate.state === "denied") {
      return (
        <StatusPage kind="forbidden" sentence={reason} actions={[{ label: "Sign out", onClick: () => void signOut(base) }, { label: "Back to Eneles", href: site }]}>
          {signedInAs}
        </StatusPage>
      );
    }
    return (
      <StatusPage kind={gate.unreachable ? "offline" : "error"} sentence={reason} actions={[{ label: "Try again", onClick: retry }, { label: "Sign out", onClick: () => void signOut(base) }]}>
        {signedInAs}
      </StatusPage>
    );
  }

  const here = (pathname.startsWith("/admin") ? pathname.slice(6) : pathname).replace(/\/$/, "");
  const isActive = (to: string) => (to === "" ? here === "" : here === to || here.startsWith(`${to}/`));

  return (
    <AdminMeContext.Provider value={gate.admin}>
    <div className="flex min-h-dvh flex-col bg-background text-foreground @min-[56rem]:flex-row">
      <aside className="flex shrink-0 flex-col border-line @max-[56rem]:border-b @min-[56rem]:sticky @min-[56rem]:top-0 @min-[56rem]:h-dvh @min-[56rem]:w-60 @min-[56rem]:border-e">
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-4">
          <AdminLink to="" aria-label="Admin overview" className="inline-flex items-center gap-3">
            <BrandMarks.logo className="h-[18px] w-auto fill-foreground" />
            <span className="type-small font-medium text-muted-foreground">Admin</span>
          </AdminLink>
          <span className="@min-[56rem]:hidden">
            <AccountMenu admin={gate.admin} compact />
          </span>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-2 [scrollbar-width:none] @min-[56rem]:flex-1 @min-[56rem]:flex-col @min-[56rem]:overflow-visible @min-[56rem]:pt-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <AdminLink
              key={to}
              to={to}
              aria-current={isActive(to) ? "page" : undefined}
              className={cn(
                "flex h-10 shrink-0 items-center gap-2.5 rounded-[var(--radius-item)] px-3 type-base whitespace-nowrap text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground",
                isActive(to) && "bg-surface font-medium text-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </AdminLink>
          ))}
        </nav>
        <div className="hidden shrink-0 border-t border-line p-2 @min-[56rem]:block">
          <AccountMenu admin={gate.admin} />
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <div className="mx-auto flex w-full max-w-[84rem] flex-col gap-6 px-4 py-6 @min-[40rem]:px-8 @min-[40rem]:py-8">
          {/* Pages read their list state from the address, which needs a boundary to render on the server. */}
          <Suspense fallback={null}>{children}</Suspense>
        </div>
      </main>
    </div>
    </AdminMeContext.Provider>
  );
}
