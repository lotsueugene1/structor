import Link from "next/link";

import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="hero-section">
      <div className="hero-grid container">
        <div className="hero-copy">
          <h1>Plan the system before you write the code.</h1>
          <p>
            Define components, relationships, requirements, and decisions in one
            architecture your coding tools can use.
          </p>
          <div className="hero-actions">
            <Button size="lg" asChild>
              <Link href="/start">
                Start a project <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
