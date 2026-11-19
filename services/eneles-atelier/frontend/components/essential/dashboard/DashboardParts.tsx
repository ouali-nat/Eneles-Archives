import Link from "next/link";
import { BookOpen, FileText, Plus, Upload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/ui/container";
import { PageHeader } from "@/components/essential/layout/PageHeader";
import { RecentSectionSkeleton } from "./RecentSection";

/** How many items each recent card lists at most; the skeleton draws as many rows. */
export const RECENT = 5;

/* Each action keeps its own hue, as on the original dashboard. Classes are written out for the scanner. */
const quickActions = [
  { title: "New project", description: "Blank, from a template, a ZIP, or arXiv", icon: Plus, href: "/projects?new=1", chip: "bg-accent/12 text-accent" },
  { title: "Upload image", description: "Handwriting or a screenshot to LaTeX", icon: Upload, href: "/snips", chip: "bg-hue-blue/12 text-hue-blue" },
  { title: "Upload PDF", description: "A paper's text, math, and tables as LaTeX", icon: FileText, href: "/pdfs", chip: "bg-hue-green/12 text-hue-green" },
  { title: "Browse library", description: "TikZ examples and document templates", icon: BookOpen, href: "/library", chip: "bg-hue-purple/12 text-hue-purple" },
];

/** The dashboard's title and its one action. Nothing in it waits for data, so the skeleton draws the real thing. */
export function DashboardHeader() {
  return (
    <PageHeader
      title="Dashboard"
      actions={
        <Button asChild>
          <Link href="/projects?new=1">
            <Plus aria-hidden />
            New project
          </Link>
        </Button>
      }
    />
  );
}

/** The four ways to start something, as cards. Static, so the skeleton draws them too. */
export function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
      {quickActions.map((action) => (
        <Link
          key={action.title}
          href={action.href}
          className="group flex flex-col gap-3 rounded-[var(--radius-surface)] border border-line bg-card p-4 shadow-lit-drop transition-[background-color,box-shadow] hover:bg-surface-hover hover:shadow-[var(--lit-drop-hover)]"
        >
          <span className={`flex size-9 items-center justify-center rounded-[var(--radius)] ${action.chip}`}>
            <action.icon aria-hidden className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block type-base font-medium">{action.title}</span>
            <span className="mt-0.5 block type-tiny text-muted-foreground">{action.description}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}

/** The dashboard before anything has loaded: the real header and quick actions, and the three recent cards with their rows in skeleton. The page itself shows the same cards in their loading state, so nothing moves between the two. */
export function DashboardSkeleton() {
  return (
    <Container>
      <div className="space-y-6">
        <DashboardHeader />
        <QuickActions />
        <RecentSectionSkeleton title="Recent projects" href="/projects" leading="icon" rows={RECENT} />
        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
          <RecentSectionSkeleton title="Recent snips" href="/snips" leading="thumb" rows={RECENT} />
          <RecentSectionSkeleton title="Recent PDFs" href="/pdfs" leading="page" rows={RECENT} />
        </div>
      </div>
    </Container>
  );
}
