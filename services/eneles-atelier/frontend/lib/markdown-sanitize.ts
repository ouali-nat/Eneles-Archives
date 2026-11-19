import { defaultSchema, type Options } from "rehype-sanitize";

/**
 * What HTML may survive in rendered document text (PDF extractions, which
 * come from files people upload). The default schema already drops scripts,
 * styles, event handlers, and javascript: URLs; this adds only the classes the
 * math pipeline needs, so inline and display math still render.
 */
export const markdownSanitizeSchema: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", "language-math", "math-inline", "math-display"],
    ],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", "math", "math-inline"]],
    div: [...(defaultSchema.attributes?.div ?? []), ["className", "math", "math-display"]],
  },
};
