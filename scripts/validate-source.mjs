#!/usr/bin/env node
/**
 * Pre-build guard: stops corrupted source or an out-of-sync workspace lockfile BEFORE they reach a deployment.
 *   1. Parses every .ts/.tsx/.js/.jsx/.mjs file with the TypeScript parser (syntax only, ~seconds).
 *   2. Greps for the corruption patterns seen in past incidents (split property names, escaped JSX attributes,
 *      malformed <Route>, hooks placed inside a destructured parameter list).
 *   3. Verifies every workspace package is present in package-lock.json (the cause of `npm ci` EUSAGE failures).
 * Exit code 1 with a file:line list on any finding. No dependencies beyond the repo's own typescript.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(join(root, "package.json"));
const ts = require("typescript");
const findings = [];
const add = (file, line, msg) => findings.push(`${relative(root, file).split(sep).join("/")}${line ? ":" + line : ""}  ${msg}`);

const SKIP = new Set(["node_modules", "dist", ".git", ".wrangler", "coverage", ".next", "build"]);
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (/\.(tsx?|jsx?|mjs|cjs)$/.test(name) && !name.endsWith(".d.ts")) yield p;
  }
}

const PATTERNS = [
  { re: /\b[A-Za-z]+\s+[a-z]+_(at|id|by)\s*:/, msg: "property name split by whitespace (e.g. `created extr_at:`)", ext: /\.(tsx?|jsx?)$/, lineOnly: /^\s+[A-Za-z]+\s+[a-z]+_(at|id|by)\s*:\s*\S/ },
  { re: /=\s*\\"/, msg: 'escaped quote in JSX attribute (e.g. className=\\"x\\")', ext: /\.(tsx|jsx)$/ },
  { re: /<Route\b[^>\n]*\}\s*<\//, msg: "malformed <Route> (missing `/>` before closing tag)", ext: /\.(tsx|jsx)$/ },
  { re: /\(\s*\{\s*\n?\s*use[A-Z]\w*\(\)\s*;/, msg: "hook call inside a destructured parameter list", ext: /\.(tsx|jsx)$/, multiline: true },
];

let files = 0;
for (const area of ["artifacts", "lib", "functions", "scripts", "tests"]) {
  const base = join(root, area);
  if (!existsSync(base)) continue;
  for (const file of walk(base)) {
    files++;
    const text = readFileSync(file, "utf8");
    // 1) syntax
    const kind = /\.tsx$/.test(file) ? ts.ScriptKind.TSX : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.tsx?$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
    for (const d of sf.parseDiagnostics ?? []) {
      const { line } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
      add(file, line + 1, `syntax error: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    }
    // 2) known corruption patterns
    for (const p of PATTERNS) {
      if (!p.ext.test(file)) continue;
      if (p.multiline) {
        const m = p.re.exec(text);
        if (m) add(file, text.slice(0, m.index).split("\n").length, p.msg);
        continue;
      }
      text.split("\n").forEach((ln, i) => {
        if (p.lineOnly ? p.lineOnly.test(ln) : p.re.test(ln)) {
          if (/^\s*(\/\/|\*)/.test(ln)) return;
          add(file, i + 1, p.msg);
        }
      });
    }
  }
}

// 3) workspace packages must be in the lockfile
try {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const dirs = [];
  for (const g of pkg.workspaces ?? []) {
    if (g.endsWith("/*")) { const b = join(root, g.slice(0, -2)); if (existsSync(b)) for (const n of readdirSync(b)) if (existsSync(join(b, n, "package.json"))) dirs.push(`${g.slice(0, -2)}/${n}`); }
    else if (existsSync(join(root, g, "package.json"))) dirs.push(g);
  }
  for (const d of dirs) {
    const name = JSON.parse(readFileSync(join(root, d, "package.json"), "utf8")).name;
    if (!lock.packages?.[d]) add(join(root, "package-lock.json"), 0, `workspace ${name} (${d}) missing from lockfile — run \`npm install --package-lock-only\` and commit it`);
    else if (name && !lock.packages?.[`node_modules/${name}`]) add(join(root, "package-lock.json"), 0, `workspace link node_modules/${name} missing from lockfile`);
  }
} catch (e) {
  add(join(root, "package-lock.json"), 0, `could not verify lockfile: ${e.message}`);
}

if (findings.length) {
  console.error(`\n✗ validate-source: ${findings.length} problem(s) in ${files} files\n`);
  for (const f of findings) console.error("  " + f);
  console.error("\nFix these before building. (These patterns caused earlier failed deployments.)\n");
  process.exit(1);
}
console.log(`✓ validate-source: ${files} files parsed, no corruption patterns, workspaces match lockfile`);
