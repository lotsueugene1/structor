export function requireSession(sessionId: string | null) {
  if (!sessionId) throw new Error("A session is required.");
  return sessionId;
}
