import type { ComponentType } from "react";

import type { LucideProps } from "lucide-react";

import { brandColor, findBrandMark } from "@/lib/architecture/brands";
import { cn } from "@/lib/utils";

export function ArchitectureMark({
  name,
  kind,
  fallback: Fallback,
  size = 16,
  className,
}: {
  name: string;
  kind: string;
  fallback: ComponentType<LucideProps>;
  size?: number;
  className?: string;
}) {
  const mark = findBrandMark(name);
  if (!mark)
    return (
      <span className={cn("node-icon", `node-icon-${kind}`, className)}>
        <Fallback size={size} strokeWidth={1.7} />
      </span>
    );
  return (
    <span
      className={cn("node-icon node-icon-brand", className)}
      style={{ color: brandColor(mark) }}
      title={mark.title}
    >
      <svg
        role="img"
        aria-label={`${mark.title} logo`}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="currentColor"
      >
        <path d={mark.path} />
      </svg>
    </span>
  );
}
