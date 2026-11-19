/**
 * Eneles's design guard. Colors come from the theme's role tokens
 * (bg-surface, text-muted-foreground, border-line, text-hue-teal), so every
 * palette applies; visual styling lives in classes, not inline style objects.
 * Dynamic values (a position, a progress) go through custom properties:
 * style={{ "--x": value }} and a class that reads var(--x).
 */

/* Tailwind's own palette, which the theme turns off: bg-red-500, text-zinc-400/50. */
const paletteClass =
  /^(?:[a-z-]+:)*-?(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide|shadow|decoration|accent|caret|placeholder)(?:-[xytrblse])?-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?$/;
/* bg-white, text-black/60: literal ink that ignores the theme. */
const absoluteClass =
  /^(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|from|via|to|divide|shadow)-(?:white|black)(?:\/\d+)?$/;
/* An arbitrary value holding a literal color: bg-[#0b0b0b], text-[rgb(0_0_0)]. */
const arbitraryColor =
  /\[[^\]]*(?:#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\()[^\]]*\]/;

const visualProperties = new Set([
  "color",
  "background",
  "backgroundColor",
  "backgroundImage",
  "borderColor",
  "borderRadius",
  "boxShadow",
  "textShadow",
  "outlineColor",
  "fill",
  "stroke",
  "opacity",
  "animation",
  "transition",
]);

/* Object keys whose string values are data, not classes. */
const dataKeys = new Set(["id", "key", "value", "href", "src", "label", "name", "title"]);

/* The utility after its variants: `[&_[stroke='#ccc']]:stroke-line` selects a literal, it does not write one. */
function utilityOf(token) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const c = token[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth--;
    else if (c === ":" && depth === 0) start = i + 1;
  }
  return token.slice(start);
}

function classProblem(token) {
  const utility = utilityOf(token);
  if (utility.includes("var(")) return null;
  if (paletteClass.test(utility) || absoluteClass.test(utility) || arbitraryColor.test(utility)) return token;
  return null;
}

export default {
  rules: {
    "token-styles": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          color:
            "'{{value}}' is a literal color; use a role token (bg-surface, text-muted-foreground, border-line, text-hue-blue) so every theme applies.",
          property:
            "'{{value}}' in an inline style; write it as a class (or pass the dynamic part through a custom property).",
        },
      },
      create(context) {
        const check = (node, text) => {
          for (const token of text.split(/\s+/)) {
            const bad = token && classProblem(token);
            if (bad) context.report({ node, messageId: "color", data: { value: bad } });
          }
        };
        const isDataValue = (node) =>
          node.parent?.type === "Property" &&
          node.parent.value === node &&
          dataKeys.has(node.parent.key?.name ?? node.parent.key?.value);
        return {
          Literal(node) {
            if (typeof node.value !== "string") return;
            const parent = node.parent?.type;
            if (parent === "ImportDeclaration" || parent === "ExportNamedDeclaration" || parent === "ExportAllDeclaration") return;
            if (isDataValue(node)) return;
            check(node, node.value);
          },
          TemplateElement(node) {
            check(node, node.value.raw);
          },
          JSXAttribute(node) {
            if (node.name?.name !== "style") return;
            const expr = node.value?.expression;
            if (expr?.type !== "ObjectExpression") return;
            for (const prop of expr.properties) {
              const key = prop.key?.name ?? prop.key?.value;
              if (prop.type === "Property" && visualProperties.has(key))
                context.report({ node: prop, messageId: "property", data: { value: key } });
            }
          },
        };
      },
    },
  },
};
