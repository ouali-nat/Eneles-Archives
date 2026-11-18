import { cn } from "@/lib/utils"

interface CalloutProps {
  type?: "tip" | "note" | "warning"
  title?: string
  children: React.ReactNode
}

const styles = {
  tip: "border-hue-green/50 bg-hue-green/5",
  note: "border-hue-blue/50 bg-hue-blue/5",
  warning: "border-hue-amber/50 bg-hue-amber/5",
}

const titles = {
  tip: "Tip",
  note: "Note",
  warning: "Warning",
}

const titleColors = {
  tip: "text-hue-green dark:text-hue-green",
  note: "text-hue-blue dark:text-hue-blue",
  warning: "text-hue-amber dark:text-hue-amber",
}

export function Callout({ type = "note", title, children }: CalloutProps) {
  return (
    <div className={cn("border-s-2 rounded-e-lg ps-4 pe-4 py-3 my-5", styles[type])}>
      <p className={cn("text-[12px] font-semibold uppercase tracking-wider mb-1", titleColors[type])}>
        {title || titles[type]}
      </p>
      <div className="text-[14px] text-muted-foreground [&>p]:mb-0">{children}</div>
    </div>
  )
}
