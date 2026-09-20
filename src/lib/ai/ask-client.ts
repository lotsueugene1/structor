"use client";

import { architectureAskResponseSchema } from "@/lib/ai/schema";

export async function askArchitecture(input: {
  prompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  context: unknown;
}) {
  const response = await fetch("/api/architecture/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new Error("Structor AI could not answer. Try again.");
  }
  const parsed = architectureAskResponseSchema.safeParse(json);
  if (!parsed.success)
    throw new Error("Structor AI could not answer. Try again.");
  if (!parsed.data.ok) throw new Error(parsed.data.error.message);
  return parsed.data.reply;
}
