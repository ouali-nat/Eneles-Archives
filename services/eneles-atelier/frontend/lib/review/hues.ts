/** The hues a comment's highlight can take: the interface's ten named hue tokens (--hue-* in app/globals.css), so a chosen color follows the theme. The server checks a color against the same list. */
export const COMMENT_HUES = ["amber", "orange", "red", "pink", "purple", "indigo", "blue", "teal", "green", "grey"] as const;

export type CommentHue = (typeof COMMENT_HUES)[number];

export const DEFAULT_COMMENT_HUE: CommentHue = "amber";

export function isCommentHue(value: unknown): value is CommentHue {
  return typeof value === "string" && (COMMENT_HUES as readonly string[]).includes(value);
}

/** A stored color as a hue, falling back to the default for null or anything unknown. */
export function commentHue(value: string | null | undefined): CommentHue {
  return isCommentHue(value) ? value : DEFAULT_COMMENT_HUE;
}

/** The CSS value of a hue: its token. */
export function hueVar(value: string | null | undefined): string {
  return `var(--hue-${commentHue(value)})`;
}

export function hueLabel(hue: CommentHue): string {
  return hue[0].toUpperCase() + hue.slice(1);
}
