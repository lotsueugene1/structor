"use client";

import { useEffect, useRef, useState } from "react";

import Link from "next/link";

import { Menu, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/lib/architecture/store";

const entranceEase = [0.22, 1, 0.36, 1] as const;
const links = [
  { label: "Start", href: "#how-it-works", id: "how-it-works" },
  { label: "Architecture", href: "#architecture", id: "architecture" },
  { label: "Integrations", href: "#context", id: "context" },
  { label: "FAQ", href: "#questions", id: "questions" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const [hoveredHref, setHoveredHref] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const hasProject = useWorkspace((state) => state.project !== null);
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const highlightedHref = hoveredHref ?? activeHref;

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  useEffect(() => {
    const clearSectionAtTop = () => {
      if (window.scrollY > 8) return;
      setActiveHref(null);
      setHoveredHref(null);
    };
    clearSectionAtTop();
    window.addEventListener("scroll", clearSectionAtTop, { passive: true });
    return () => window.removeEventListener("scroll", clearSectionAtTop);
  }, []);

  useEffect(() => {
    const sections = links
      .map((link) => document.getElementById(link.id))
      .filter((section): section is HTMLElement => Boolean(section));
    const visibility = new Map(sections.map((section) => [section.id, 0]));
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visibility.set(
            entry.target.id,
            entry.isIntersecting ? entry.intersectionRatio : 0,
          );
        });
        const visible = sections
          .map((section) => ({
            id: section.id,
            ratio: visibility.get(section.id) ?? 0,
          }))
          .filter(({ ratio }) => ratio > 0)
          .sort((a, b) => b.ratio - a.ratio)[0];
        setActiveHref(visible ? `#${visible.id}` : null);
      },
      { rootMargin: "-30% 0px -55%", threshold: [0, 0.15, 0.4] },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <motion.header
      ref={headerRef}
      className="landing-header landing-motion"
      initial={reducedMotion ? false : { y: -18, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.65, ease: entranceEase }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Brand className="landing-brand" />

      <motion.nav
        aria-label="Main navigation"
        className="landing-desktop-nav landing-motion"
        initial={reducedMotion ? false : { opacity: 0, y: -12, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{
          duration: reducedMotion ? 0 : 0.55,
          delay: reducedMotion ? 0 : 0.12,
          ease: entranceEase,
        }}
        onMouseLeave={() => setHoveredHref(null)}
      >
        {links.map((link, index) => {
          const active = activeHref === link.href;
          return (
            <motion.div
              key={link.href}
              className="landing-nav-item"
              initial={reducedMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: reducedMotion ? 0 : 0.3,
                delay: reducedMotion ? 0 : 0.24 + index * 0.06,
                ease: "easeOut",
              }}
            >
              {highlightedHref === link.href && (
                <motion.span
                  aria-hidden="true"
                  className="landing-nav-indicator"
                  layoutId="landing-nav-indicator"
                  transition={{ type: "spring", stiffness: 360, damping: 32 }}
                />
              )}
              <a
                href={link.href}
                aria-current={active ? "location" : undefined}
                onMouseEnter={() => setHoveredHref(link.href)}
                onFocus={() => setHoveredHref(link.href)}
                onBlur={() => setHoveredHref(null)}
                onClick={() => setHoveredHref(null)}
              >
                {link.label}
              </a>
            </motion.div>
          );
        })}
      </motion.nav>

      {hasProject && (
        <div className="landing-header-action">
          <Button size="lg" asChild>
            <Link href="/workspace">Return to workspace</Link>
          </Button>
        </div>
      )}

      <Button
        ref={toggleRef}
        variant="outline"
        size="circle"
        className="landing-mobile-toggle"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-navigation"
        onClick={() => setOpen((value) => !value)}
      >
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={open ? "close" : "menu"}
            className="flex items-center justify-center"
            initial={
              reducedMotion
                ? false
                : { opacity: 0, scale: 0.5, filter: "blur(3px)" }
            }
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={
              reducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.5, filter: "blur(3px)" }
            }
            transition={{ duration: reducedMotion ? 0 : 0.15, ease: "easeOut" }}
          >
            {open ? <X /> : <Menu />}
          </motion.span>
        </AnimatePresence>
      </Button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="mobile-navigation"
            id="mobile-navigation"
            className="landing-mobile-dropdown"
            initial={reducedMotion ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}
          >
            <nav aria-label="Mobile navigation">
              {links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  aria-current={
                    activeHref === link.href ? "location" : undefined
                  }
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </a>
              ))}
              {hasProject && (
                <Button size="lg" asChild>
                  <Link href="/workspace" onClick={() => setOpen(false)}>
                    Return to workspace
                  </Link>
                </Button>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.header>
  );
}
