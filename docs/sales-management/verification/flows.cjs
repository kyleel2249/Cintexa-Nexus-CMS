const { chromium } = require(process.env.PW || "playwright");
const B = "http://localhost:4577";
const api = async (m, p, body, user = "boss@example.com") => { const r = await fetch(B + "/api/sales" + p, { method: m, headers: { "content-type": "application/json", "x-test-user": user }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})) }; };
let fails = 0;
const check = (name, ok, extra = "") => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  " + extra)); if (!ok) fails++; };
(async () => {
  const seed = await (await fetch(B + "/__seed")).json();
  const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  // 1 create lead
  await page.goto(B + "/sales/leads", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /new lead/i }).click();
  await page.getByLabel(/first name/i).first().fill("Yaw");
  await page.getByLabel(/^email/i).first().fill("yaw@flow.test");
  await page.getByRole("button", { name: /^(save|create)/i }).last().click();
  await page.waitForTimeout(800);
  const list = await api("GET", "/leads?q=yaw");
  check("lead created through the modal", list.json.items?.some((l) => l.email === "yaw@flow.test"), JSON.stringify(list.json).slice(0, 200));
  // duplicate handling
  await page.goto(B + "/sales/leads", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /new lead/i }).click();
  await page.getByLabel(/first name/i).first().fill("Yaw2");
  await page.getByLabel(/^email/i).first().fill("yaw@flow.test");
  await page.getByRole("button", { name: /^(save|create)/i }).last().click();
  await page.waitForTimeout(800);
  check("duplicate shows possible-duplicate warning", /duplicate|similar|already/i.test(await page.locator("body").innerText()));
  await page.keyboard.press("Escape");
  // 2 global search
  await page.goto(B + "/sales", { waitUntil: "networkidle" });
  await page.click("#open-search");
  await page.getByPlaceholder(/search pages/i).fill("Acme");
  await page.waitForTimeout(900);
  const opt = page.getByRole("option").filter({ hasText: /Acme/ }).first();
  check("global search finds the account", await opt.count() > 0);
  if (await opt.count()) { await page.keyboard.press("Enter"); await page.waitForTimeout(500); check("search result navigates", /\/sales\/accounts\/\d+/.test(page.url()), page.url()); }
  // 3 notification bell
  await page.getByRole("button", { name: /notifications/i }).click();
  check("bell opens", await page.getByRole("region", { name: "Notifications" }).isVisible());
  // 4 public lead form
  const pub = await ctx.newPage();
  await pub.goto(`${B}/f/${seed.formToken}`, { waitUntil: "networkidle" });
  await pub.getByLabel(/first name/i).fill("Webby");
  await pub.getByLabel(/^email/i).fill("webby@form.test");
  await pub.getByLabel(/agree to be contacted/i).check();
  await pub.getByRole("button", { name: /^send/i }).click();
  await pub.waitForTimeout(800);
  check("public form shows thanks", /thank you/i.test(await pub.locator("body").innerText()));
  const w = await api("GET", "/leads?q=webby");
  check("public form created a lead", w.json.items?.some((l) => l.email === "webby@form.test"));
  // 5 public quotation accept
  const link = await api("POST", `/quotations/${seed.quote}/send`, { channel: "link" });
  let token = (link.json.link || link.json.url || "").split("/q/")[1];
  check("quotation share link generated", !!token, JSON.stringify(link.json).slice(0, 200));
  if (token) {
    const cq = await ctx.newPage();
    await cq.goto(`${B}/q/${token}`, { waitUntil: "networkidle" });
    check("customer sees quotation", /QT-/.test(await cq.locator("body").innerText()));
    await cq.getByLabel(/full name/i).fill("Ama Mensah");
    await cq.getByLabel(/I accept this quotation/i).check();
    await cq.getByRole("button", { name: /accept quotation/i }).click();
    await cq.waitForTimeout(800);
    check("customer acceptance recorded", /recorded|thank you/i.test(await cq.locator("body").innerText()), (await cq.locator("body").innerText()).slice(0, 200));
    const d = await api("GET", `/quotations/${seed.quote}`);
    check("server shows accepted", (d.json.quotation?.status ?? d.json.status) === "accepted", JSON.stringify(d.json).slice(0, 150));
  }
  // 6 settings save
  await page.goto(B + "/sales/settings?section=quotations", { waitUntil: "networkidle" });
  const v = page.getByLabel(/validity \(days\)/i);
  await v.fill("45");
  await page.getByRole("button", { name: /save changes/i }).click();
  await page.waitForTimeout(800);
  const s = await api("GET", "/settings");
  check("settings section saved", s.json.settings?.quotations?.validityDays === 45);
  // 7 permission-denied for non-admin rep on settings
  const rep = await ctx.newPage();
  await rep.route("**/api/sales/**", (r) => r.continue({ headers: { ...r.request().headers(), "x-test-user": "rep@example.com" } }));
  await rep.goto(B + "/sales/settings", { waitUntil: "networkidle" });
  check("rep is denied settings", /permission|not allowed|don.t have/i.test(await rep.locator("main").innerText()), (await rep.locator("main").innerText()).slice(0, 160));
  // 8 mobile overflow
  const mob = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const mp = await mob.newPage();
  for (const r of ["/sales/leads", "/sales/pipeline", `/sales/orders/${seed.order}`, "/sales/commissions", "/sales/reports", "/sales/settings"]) {
    await mp.goto(B + r, { waitUntil: "networkidle" });
    const o = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`no horizontal page scroll at 375px: ${r}`, o <= 1, `overflow ${o}px`);
  }
  check("no uncaught page errors", errs.length === 0, errs.join("; "));
  await browser.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
})();
