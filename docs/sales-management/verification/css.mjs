import { compile } from "/opt/npm-tools/node_modules/tailwindcss/dist/lib.mjs";
import fs from "node:fs"; import path from "node:path";
const S = "/home/claude/cintexa-nexus-cms/artifacts/cintexa/src";
let css = fs.readFileSync(S + "/index.css", "utf8").replace(/@import "tw-animate-css";\n?/, "").replace(/@plugin "@tailwindcss\/typography";\n?/, "");
const compiler = await compile(css, { base: S, loadStylesheet: async (id, base) => {
  const p = id === "tailwindcss" ? "/opt/npm-tools/node_modules/tailwindcss/index.css" : id.startsWith("tailwindcss/") ? "/opt/npm-tools/node_modules/" + id + (id.endsWith(".css") ? "" : ".css") : path.resolve(base, id);
  return { path: p, base: path.dirname(p), content: fs.readFileSync(p, "utf8") };
} });
const cands = new Set();
const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(f.name)) for (const m of fs.readFileSync(p, "utf8").matchAll(/[^\s"'`<>{}()=;,]+/g)) cands.add(m[0]); } };
walk(S);
fs.writeFileSync("/tmp/claude-0/-home-claude/beabd5a2-f9c9-5b9b-a9c5-699ec8d55c22/scratchpad/e2e/dist/app.css", compiler.build([...cands]));
