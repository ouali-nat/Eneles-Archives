// Rasterize Branding/Eneles.svg group Dark (white wordmark) onto a dark plate.
// Run: npm run icons
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const svg = fs.readFileSync(path.join(__dirname, "logo.svg"));
const outDir = __dirname;
const sizes = [16, 32, 64, 80, 128];

for (const size of sizes) {
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "transparent",
  })
    .render()
    .asPng();
  fs.writeFileSync(path.join(outDir, `texer-dark-${size}.png`), png);
  console.log(`Wrote texer-dark-${size}.png (${png.length} bytes)`);
}

for (const size of sizes) {
  const legacy = path.join(outDir, `texer-${size}.png`);
  if (fs.existsSync(legacy)) fs.unlinkSync(legacy);
}
