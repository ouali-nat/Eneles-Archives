/** Fired on the window when a key, a default model, or Platform AI changes, so the editor's assistant reads its status again at once. */
export const AI_STATUS_EVENT = "texer:ai-status-changed";

export function notifyAiStatusChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AI_STATUS_EVENT));
}
