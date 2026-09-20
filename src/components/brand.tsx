import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/"
      aria-label="Structor home"
      className={cn("brand", className)}
    >
      <Image
        src="/brand/structor-mark.png"
        alt=""
        width={40}
        height={40}
        className="brand-mark"
      />
      {!compact && (
        <span>
          structor<span className="brand-period">.</span>
        </span>
      )}
    </Link>
  );
}
