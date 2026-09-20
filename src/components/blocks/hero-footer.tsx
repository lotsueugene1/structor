"use client";

import { Network } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { AnimatedWords } from "@/components/animated-words";

export function HeroFooter() {
  const reducedMotion = useReducedMotion();
  return (
    <footer className="hero-footer" aria-label="About Structor">
      <p className="hero-footer-description">
        <AnimatedWords
          text="Map your system before you build it. Keep requirements, dependencies, and decisions connected, so every component has a clear purpose and your development tools have the context they need."
          baseDelay={1.2}
        />
      </p>
      <motion.div
        className="hero-footer-pills landing-motion"
        initial={reducedMotion ? false : { opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          delay: reducedMotion ? 0 : 1.4,
          duration: reducedMotion ? 0 : 0.6,
        }}
      >
        <span className="hero-footer-pill">Clarity for complex systems</span>
        <div className="hero-footer-pill-row">
          <span className="hero-footer-square" aria-hidden="true">
            <Network size={23} strokeWidth={1.5} />
          </span>
          <span className="hero-footer-pill">Architecture &amp; intent</span>
        </div>
      </motion.div>
    </footer>
  );
}
