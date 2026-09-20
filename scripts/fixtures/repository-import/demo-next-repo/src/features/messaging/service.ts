import type { Conversation } from "./types";

export function canSendMessage(conversation: Conversation) {
  return conversation.matchConfirmed;
}
