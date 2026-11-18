"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { manualHref, type Manual } from "@/lib/manuals";
import { cn } from "@/lib/utils";

const methodColor: Record<string, string> = {
  GET: "text-hue-green dark:text-hue-green",
  POST: "text-hue-blue dark:text-hue-blue",
  PUT: "text-hue-amber dark:text-hue-amber",
  PATCH: "text-hue-indigo dark:text-hue-indigo",
  DELETE: "text-hue-red dark:text-hue-red",
};

/**
 * Docs navigation tree. Rendered twice: as the desktop sidebar, and inside the
 * mobile drawer. Keeping it in one component is the only way the two stay in
 * step, which they previously did not.
 */
export function DocsSidebar({ manual, onNavigate }: { manual: Manual; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav aria-label={manual.title}>
      {manual.groups.map((group, i) => (
        <div key={group.title} className={i > 0 ? "mt-7" : ""}>
          {/* The group's title starts where its line does. */}
          <p className="mb-2 type-small font-medium text-muted-foreground">{group.title}</p>
          <ul className="border-s border-line">
            {group.items.map((item) => {
              const href = manualHref(manual, item.slug);
              const active = pathname === href;
              return (
                <li key={item.slug || "overview"}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "-ms-px flex min-h-9 items-center gap-2 border-s-2 py-1.5 ps-3 type-base transition-colors",
                      active
                        ? "border-foreground font-medium text-foreground"
                        : "border-transparent text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                    )}
                  >
                    {item.method && (
                      <span
                        className={cn(
                          "shrink-0 font-mono type-micro font-bold",
                          methodColor[item.method],
                        )}
                      >
                        {item.method}
                      </span>
                    )}
                    <span className="truncate">{item.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
