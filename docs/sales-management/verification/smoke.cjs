const { chromium } = require(process.env.PW || "playwright");
(async () => {
  const seed = await (await fetch("http://localhost:4577/__seed")).json();
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  let current = "";
  page.on("pageerror", (e) => problems.push(`${current}: PAGEERROR ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") problems.push(`${current}: console.error ${m.text().slice(0, 200)}`); });
  page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400 && r.status() !== 404) problems.push(`${current}: HTTP ${r.status()} ${r.url().replace("http://localhost:4577", "")}`); });
  const routes = ["/sales", "/sales/leads", `/sales/leads/${seed.lead}`, "/sales/accounts", `/sales/accounts/${seed.acc}`, "/sales/contacts", "/sales/pipeline", "/sales/activities", "/sales/targets", "/sales/products", "/sales/quotations", `/sales/quotations/${seed.quote}`, "/sales/orders", `/sales/orders/${seed.order}`, "/sales/forecasting", "/sales/performance", "/sales/teams", "/sales/teams?tab=members", "/sales/teams?tab=territories", "/sales/commissions", "/sales/commissions?tab=plans", "/sales/commissions?tab=statement", "/sales/retention", "/sales/retention?tab=feedback", "/sales/retention?tab=renewals", "/sales/retention?tab=referrals", "/sales/retention?tab=plans", "/sales/campaigns", "/sales/campaigns?tab=attribution", "/sales/campaigns?id=1", "/sales/competitors", "/sales/competitors?id=1", "/sales/reports", "/sales/reports?tab=schedules", "/sales/automation", "/sales/automation?tab=runs", "/sales/playbook", "/sales/playbook/1", "/sales/playbook?tab=training", "/sales/documents", `/sales/documents?entity_type=account&entity_id=${seed.acc}`, "/sales/documents?tab=templates", "/sales/settings", "/sales/settings?tab=integrations", "/sales/settings?tab=audit", "/sales/settings?tab=ai", "/sales/nope", `/q/badtoken0000000000000000`, `/f/${seed.formToken}`];
  for (const r of routes) {
    current = r;
    await page.goto("http://localhost:4577" + r, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const text = (await page.locator("main").first().innerText().catch(() => page.locator("#root").innerText())).replace(/\s+/g, " ").slice(0, 140);
    const full = await page.locator("#root").innerText(); const mm = /something went wrong|cannot read|undefined|\bNaN\b|\[object/i.exec(full); const bad = !!mm; if (mm) console.log("   match:", JSON.stringify(full.slice(Math.max(0, mm.index - 60), mm.index + 60)));
    console.log((bad ? "BAD  " : "ok   ") + r.padEnd(48) + text);
    if (bad) problems.push(`${r}: suspicious text`);
  }
  console.log("\nPROBLEMS", problems.length); problems.forEach((p) => console.log(" -", p));
  await browser.close();
})();
