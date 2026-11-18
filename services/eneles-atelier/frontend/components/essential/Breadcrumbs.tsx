import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

export interface Crumb {
  label: string;
  /** Omit on the final crumb, which represents the current page. */
  href?: string;
  /** Render in the monospace face, for package and file names. */
  mono?: boolean;
}

/**
 * Shared breadcrumb trail.
 *
 * Both the docs and the library had hand-rolled versions, each with its own
 * markup, its own separator, and at least one segment rendered as inert text
 * where it should have been a link. This wraps the `ui/breadcrumb` primitive
 * (which was in the repo, unused) so every trail is navigable and announces
 * itself correctly: ancestors are links, the current page is
 * `aria-current="page"`, and separators are hidden from assistive tech.
 */
export function Breadcrumbs({
  items,
  className,
}: {
  items: Crumb[];
  className?: string;
}) {
  return (
    <Breadcrumb className={cn("mb-4", className)}>
      <BreadcrumbList className="gap-1.5 @min-[40rem]:gap-1.5">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <span key={`${item.label}-${i}`} className="contents">
              <BreadcrumbItem>
                {last || !item.href ? (
                  <BreadcrumbPage
                    className={cn(
                      "text-foreground",
                      item.mono && "font-mono",
                    )}
                  >
                    {item.label}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link
                      href={item.href}
                      className={cn(
                        "rounded-sm underline-offset-4 transition-colors hover:text-foreground hover:underline",
                        item.mono && "font-mono",
                      )}
                    >
                      {item.label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!last && <BreadcrumbSeparator />}
            </span>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
