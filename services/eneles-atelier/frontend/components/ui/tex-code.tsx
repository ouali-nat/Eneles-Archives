import { Fragment, useMemo } from "react";
import { tokenizeBibLine, tokenizeTex, tokenizeTexLine, type TexLanguage, type TexLineState, type TexToken, type TexTone } from "@/lib/tex-highlight";

/* The site's colors for TeX source outside the editor (see lib/tex-highlight.ts): commands, names, math, comments, and punctuation, in tokens that hold in both themes and on a diff's tinted rows. */
const TONES: Record<TexTone, string> = {
  command: "text-hue-blue",
  name: "text-hue-teal",
  math: "text-hue-orange",
  keyword: "text-hue-purple",
  align: "text-hue-amber",
  comment: "text-muted-foreground italic",
  punctuation: "text-muted-foreground",
};

export function TexTokens({ tokens }: { tokens: TexToken[] }) {
  return (
    <>
      {tokens.map((token, i) =>
        token.tone ? (
          <span key={i} className={TONES[token.tone]}>
            {token.text}
          </span>
        ) : (
          <Fragment key={i}>{token.text}</Fragment>
        ),
      )}
    </>
  );
}

/** One line of source, colored. `state` is what the line before left open (display math), for callers that color a diff row by row. */
export function TexLine({ text, language = "latex", state }: { text: string; language?: TexLanguage | null; state?: TexLineState }) {
  const tokens = useMemo(() => (language === "bibtex" ? tokenizeBibLine(text) : language === "latex" ? tokenizeTexLine(text, state).tokens : null), [text, language, state]);
  return tokens ? <TexTokens tokens={tokens} /> : <>{text}</>;
}

/** A block of source, colored. It draws only the text: the caller supplies the <pre> or <code> and its type. */
export function TexSource({ source, language = "latex" }: { source: string; language?: TexLanguage | null }) {
  const lines = useMemo(() => (language ? tokenizeTex(source, language) : null), [source, language]);
  if (!lines) return <>{source}</>;
  return (
    <>
      {lines.map((tokens, i) => (
        <Fragment key={i}>
          {i > 0 && "\n"}
          <TexTokens tokens={tokens} />
        </Fragment>
      ))}
    </>
  );
}

/** The tone classes, for callers that split tokens further (a diff marking the words that changed). */
export { TONES as TEX_TONES };
