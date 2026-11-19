"use client";

import { useState } from "react";
import { Lock, Globe } from "@/components/icons";
import { CopyButton } from "@/components/ui/copy-button";
import { cn } from "@/lib/utils";

const methodStyles: Record<string, { bg: string; text: string }> = {
  GET: {
    bg: "bg-hue-green/10 dark:bg-hue-green/15",
    text: "text-hue-green dark:text-hue-green",
  },
  POST: {
    bg: "bg-hue-blue/10 dark:bg-hue-blue/15",
    text: "text-hue-blue dark:text-hue-blue",
  },
  PUT: {
    bg: "bg-hue-amber/10 dark:bg-hue-amber/15",
    text: "text-hue-amber dark:text-hue-amber",
  },
  DELETE: {
    bg: "bg-hue-red/10 dark:bg-hue-red/15",
    text: "text-hue-red dark:text-hue-red",
  },
};

function CopyBlock({ code, label }: { code: string; label: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
          {label}
        </span>
        <CopyButton text={code} />
      </div>
      <pre className="rounded-lg border bg-surface/50 p-4 overflow-x-auto">
        <code className="text-[13px] font-mono text-foreground leading-relaxed">
          {code}
        </code>
      </pre>
    </div>
  );
}

interface EndpointProps {
  method: string;
  path: string;
  description: string;
  auth?: string;
  request?: string;
  response?: string;
}

export function Endpoint({
  method,
  path,
  description,
  auth,
  request,
  response,
}: EndpointProps) {
  const style = methodStyles[method] || methodStyles.GET;

  return (
    <div className="py-8 first:pt-0">
      <div className="flex items-center gap-3 mb-3">
        <span
          className={cn(
            "px-2 py-0.5 rounded text-[11px] font-mono font-bold",
            style.bg,
            style.text,
          )}
        >
          {method}
        </span>
        <code className="text-[15px] font-mono font-semibold text-foreground">
          {path}
        </code>
      </div>

      <p className="text-[15px] text-muted-foreground leading-relaxed mb-4">
        {description}
      </p>

      {auth && (
        <div className="flex items-center gap-2 mb-5 text-[13px] text-muted-foreground">
          {auth === "None" || auth === "None required" ? (
            <Globe className="h-3.5 w-3.5" />
          ) : (
            <Lock className="h-3.5 w-3.5" />
          )}
          <span>
            {auth === "None" || auth === "None required"
              ? "No authentication required"
              : auth}
          </span>
        </div>
      )}

      <div className="space-y-4">
        {request && <CopyBlock code={request} label="Request" />}
        {response && <CopyBlock code={response} label="Response" />}
      </div>
    </div>
  );
}
