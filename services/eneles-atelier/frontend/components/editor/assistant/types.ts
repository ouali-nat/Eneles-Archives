import type { AiChatEdit, AiChatTurn } from "@/lib/api";

/** One file the assistant read or changed while answering. */
export interface AssistantActivity {
  id: string;
  tool: string;
  path: string | null;
  state: "running" | "done" | "failed";
}

/** One turn of the conversation with the assistant, as the panel shows it. Only `role` and `content` are sent back to the server as history. */
export interface AssistantTurn extends AiChatTurn {
  /** The paths of the files the assistant read to answer (project files, and reference papers under references/). */
  read?: string[];
  /** What the person typed, when it differs from the prompt that was sent (a slash command such as "/fix"). */
  label?: string;
  /** Which model answered, as shown under the answer ("fake-large, OpenAI-compatible"). */
  model?: string;
  /** The answer failed: what to say, and whether trying again can help. What arrived before it failed is kept in `content`. */
  error?: { message: string; retryable: boolean; code?: string };
  /** The person stopped the answer; `content` is what had arrived. */
  stopped?: boolean;
  /** Lines the server sent with the answer (a model that cannot edit, for one). */
  notices?: string[];
  /** Older turns left out of what was sent, to fit the model's context. */
  trimmed?: { sent: number; total: number };
}

/** How a prompt is sent: with the last compile's errors, with the editor's selection, and how the person's message reads in the conversation. */
export interface AssistantSendOptions {
  withErrors?: boolean;
  /** Send the text selected in the editor as context. */
  withSelection?: boolean;
  /** What the person's message shows instead of the full prompt. */
  label?: string;
  /** Leave the open file out of what is sent. */
  withoutActiveFile?: boolean;
  /** Replace the last question and its answer (Regenerate, or an edited question) instead of adding to the conversation. */
  replaceLast?: boolean;
}

/** How a send ended, for the panel: `kept` means turns were added (an answer, a partial one, or an error), so nothing goes back into the field. */
export type AssistantSendResult = { kept: true } | { kept: false; reason: "stopped" | "refused" | "failed" };

/** What the editor tells the panel while an answer is written. */
export interface LiveSink {
  meta: (meta: { model: string; providerName: string; source: string; tools: boolean; trimmed: { sent: number; total: number } | null }) => void;
  text: (delta: string) => void;
  activity: (activity: AssistantActivity) => void;
  notice: (message: string) => void;
}

export interface AssistantProposal {
  edits: AiChatEdit[];
  message?: string;
}

/** The turns as history for the server: role and content only. A question whose answer failed with nothing written is left out with it, so the history alternates. */
export const toHistory = (turns: readonly AssistantTurn[]): AiChatTurn[] => {
  const out: AiChatTurn[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const next = turns[i + 1];
    if (turn.role === "user" && next?.role === "assistant" && next.error && !next.content.trim()) {
      i++;
      continue;
    }
    if (turn.role === "assistant" && !turn.content.trim()) continue;
    out.push({ role: turn.role, content: turn.content });
  }
  return out;
};
