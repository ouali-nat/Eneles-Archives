/**
 * Test script to compile a minimal TikZ example and print the full response.
 * Run: node test-compile.js
 * Use to debug compilation errors - shows full log and errors.
 */
const fs = require('fs');
const path = require('path');

const testLatex = `\\documentclass{article}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{tikz}
\\usepackage{tikz-cd}
\\begin{document}
\\centering
\\begin{tikzcd}
  A \\arrow[r, "f"] \\arrow[d, "g"'] & B \\arrow[d, "h"] \\\\
  C \\arrow[r, "k"'] & D
\\end{tikzcd}
\\end{document}`;

const url = 'http://localhost:3500/compile';
fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    files: [{ path: 'main.tex', content: testLatex }],
    mainFile: 'main.tex',
    engine: 'pdflatex',
    stopOnFirstError: true
  })
})
  .then(r => r.json())
  .then(data => {
    console.log('Success:', data.success);
    console.log('PDF length:', data.pdf ? data.pdf.length : 0);
    console.log('Errors:', JSON.stringify(data.errors, null, 2));
    if (data.log) {
      console.log('\n--- Last 1500 chars of log ---');
      console.log(data.log.slice(-1500));
    }
  })
  .catch(e => console.error('Request failed:', e.message));
