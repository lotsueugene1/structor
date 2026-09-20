import Link from "next/link";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
export default function NotFound() {
  return (
    <main id="main-content" className="not-found">
      <Brand />
      <span className="eyebrow">404 / UNCHARTED TERRITORY</span>
      <h1>This page isn’t on the map.</h1>
      <p>Head back to a clearer starting point.</p>
      <Button asChild>
        <Link href="/">Back to Structor</Link>
      </Button>
    </main>
  );
}
