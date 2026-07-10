// Bundle the demo into one self-contained HTML file (dist/agentropolis.html)
// so it can be opened from disk or hosted anywhere as a single file.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const engine = await readFile('src/engine.js', 'utf8');
const cityJs = await readFile('public/city.js', 'utf8');
const html = await readFile('public/index.html', 'utf8');

const inlined = cityJs.replace(/import\s*\{[^}]*\}\s*from\s*'\.\.\/src\/engine\.js';/, '');
const script = `<script type="module">\n${engine}\n${inlined}\n</script>`;
const out = html.replace('<script type="module" src="city.js"></script>', script);

await mkdir('dist', { recursive: true });
await writeFile('dist/agentropolis.html', out);
console.log(`Wrote dist/agentropolis.html (${(out.length / 1024).toFixed(0)} KB)`);
