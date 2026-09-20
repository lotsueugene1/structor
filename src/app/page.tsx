import Link from "next/link";

import {
  ArrowRight,
  ArrowUpRight,
  Boxes,
  FileUp,
  GitBranch,
  Plus,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

import { FAQ } from "@/components/blocks/faq";
import { Hero } from "@/components/blocks/hero";
import { Integrations } from "@/components/blocks/integrations";
import { Navbar } from "@/components/blocks/navbar";
import { Brand } from "@/components/brand";

const architectureDetails = [
  {
    icon: Boxes,
    label: "Components",
    value: "Purpose, boundaries, and responsibilities.",
  },
  {
    icon: GitBranch,
    label: "Relationships",
    value: "Dependencies and data flow.",
  },
  {
    icon: ShieldCheck,
    label: "Requirements",
    value: "Business rules and security constraints.",
  },
  {
    icon: ScrollText,
    label: "Decisions",
    value: "Trade-offs, alternatives, and rationale.",
  },
];

export default function Home() {
  return (
    <div className="landing-page">
      <div className="landing-header-shell">
        <Navbar />
      </div>
      <main id="main-content">
        <div className="landing-hero">
          <Hero />
        </div>

        <section className="entry-section container" id="how-it-works">
          <div className="section-heading">
            <h2>Start new or import.</h2>
          </div>
          <div className="entry-grid">
            <Link className="entry-card" href="/start">
              <div className="entry-card-top">
                <span className="entry-icon">
                  <Plus size={21} />
                </span>
                <ArrowUpRight size={19} />
              </div>
              <h3>New project</h3>
              <p>Define a system from scratch.</p>
              <span className="entry-link">
                Start a project <ArrowRight size={16} />
              </span>
            </Link>
            <Link className="entry-card" href="/start?mode=repository">
              <div className="entry-card-top">
                <span className="entry-icon">
                  <FileUp size={21} />
                </span>
                <ArrowUpRight size={19} />
              </div>
              <h3>Import repository</h3>
              <p>Upload a repository ZIP and build an architecture draft.</p>
              <span className="entry-link">
                Import repository <ArrowRight size={16} />
              </span>
            </Link>
          </div>
        </section>

        <section className="architecture-section" id="architecture">
          <div className="architecture-section-grid container">
            <div>
              <h2>Architecture with its reasoning attached.</h2>
              <p>
                Map the system and keep its requirements, constraints, and
                decisions beside it.
              </p>
            </div>
            <div className="architecture-detail">
              {architectureDetails.map(({ icon: Icon, label, value }) => (
                <div className="detail-row" key={label}>
                  <span className="detail-icon">
                    <Icon size={18} strokeWidth={1.7} />
                  </span>
                  <div>
                    <span>{label}</span>
                    <p>{value}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <Integrations />
        <FAQ />
      </main>

      <footer className="site-footer container">
        <Brand />
        <div>
          <a
            href="https://github.com/lotsueugene1/structor"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <ArrowUpRight size={12} />
          </a>
          <span>© 2026 Structor</span>
        </div>
      </footer>
    </div>
  );
}
