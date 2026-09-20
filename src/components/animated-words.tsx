"use client";

import { motion, useReducedMotion } from "motion/react";

/** Keep the sentence intact for assistive technology while its visual words enter. */
export function AnimatedWords({
  text,
  baseDelay = 1.2,
}: {
  text: string;
  baseDelay?: number;
}) {
  const reducedMotion = useReducedMotion();
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {text.split(" ").map((word, index) => (
          <motion.span
            key={`${index}-${word}`}
            className="landing-motion mr-[0.25em] inline-block"
            initial={reducedMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: reducedMotion ? 0 : baseDelay + index * 0.045,
              duration: reducedMotion ? 0 : 0.5,
              ease: "easeOut",
            }}
          >
            {word}
          </motion.span>
        ))}
      </span>
    </>
  );
}
