"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const items = [
  [
    "Is Structor a coding agent?",
    "No. Structor records your architecture and exports it as structured context for your development tools.",
  ],
  [
    "What can I import?",
    "A repository ZIP or a Structor architecture JSON export. Repository imports skip dependencies, generated output, known secret files, binaries, and large media.",
  ],
  [
    "Who controls architecture changes?",
    "You do. Structor shows proposed rule changes before you apply them and does not infer changes to other components.",
  ],
  [
    "How is this different from a diagram?",
    "Structor keeps purpose, requirements, constraints, decisions, and implementation references attached to each component.",
  ],
];

export function FAQ() {
  return (
    <section className="faq-section container" id="questions">
      <h2>Frequently asked questions.</h2>
      <Accordion type="single" collapsible>
        {items.map(([question, answer], index) => (
          <AccordionItem key={question} value={`question-${index}`}>
            <AccordionTrigger>{question}</AccordionTrigger>
            <AccordionContent>{answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
