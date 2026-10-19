import { existsSync } from "node:fs";
const S = "/home/claude/cintexa-nexus-cms/artifacts/cintexa/src";
const E = import.meta.dir;
const NM = "/opt/npm-tools/node_modules";
const over: Record<string, string> = { "wouter": E + "/stub-wouter.tsx", "lucide-react": E + "/stub-lucide.tsx", "@/hooks/use-toast": E + "/stub-misc.tsx", "@/lib/utils": E + "/stub-misc.tsx", "@/lib/firebase": E + "/stub-misc.tsx" };
const res = await Bun.build({
  entrypoints: [E + "/entry.tsx"], outdir: E + "/dist", target: "browser", minify: false, define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "alias", setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (over[a.path]) return { path: over[a.path] };
      if (a.path.startsWith("@/components/ui/") || a.path === "@/pages/not-found") return { path: E + "/stub-ui.tsx" };
      if (a.path.startsWith("@/")) {
        const base = S + "/" + a.path.slice(2);
        for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) if (existsSync(base + ext) && !(ext === "" && !/\.[a-z]+$/.test(base))) return { path: base + ext };
      }
      if (/^(react|react-dom)(\/|$)/.test(a.path)) return { path: Bun.resolveSync(a.path, NM) };
      return undefined;
    });
  } }],
});
if (!res.success) { for (const l of res.logs) console.error(l); process.exit(1); }
console.log("built", res.outputs.map((o) => o.path));
