/** Browser-rendered checks. Each finding maps to a test id in the shared catalogue; nothing is reported that was not measured. */
import { checkUrl } from "./guard.mjs";

const VIEWPORTS = { mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1366, height: 800 } };

export async function inspectPage(browser, url, devices, opts = {}) {
  const findings = [];
  const add = (f) => findings.push(f);
  const blocked = [];
  for (const device of devices.length ? devices : ["mobile"]) {
    const vp = VIEWPORTS[device] ?? VIEWPORTS.mobile;
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: vp.deviceScaleFactor ?? 1, userAgent: "CINTEXA-NEXUS-WebsiteIntelligence/1.0 (browser worker; passive audit)", acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true });
    await context.route("**/*", async (route) => {
      const verdict = await checkUrl(route.request().url(), opts);
      if (!verdict.ok) { blocked.push(`${route.request().url()} (${verdict.reason})`); return route.abort("blockedbyclient"); }
      return route.continue();
    });
    const page = await context.newPage();
    const errors = [];
    const failed = [];
    page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 200)}`); });
    page.on("requestfailed", (r) => { const f = r.failure()?.errorText ?? "failed"; if (!/ERR_BLOCKED_BY_CLIENT|aborted/i.test(f)) failed.push(`${r.url().slice(0, 160)} (${f})`); });
    page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.url().slice(0, 160)} (HTTP ${r.status()})`); });
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30_000 });
      await page.waitForTimeout(1200);
    } catch (e) {
      for (const id of ["func.js_errors", "func.failed_requests", "ux.overflow", "ux.layout", "a11y.reflow", "a11y.target_size"]) add({ testId: id, status: "inconclusive", url, device, note: `The page did not finish loading in the browser: ${e.message.split("\n")[0]}` });
      await context.close();
      continue;
    }
    add({ testId: "func.js_errors", status: errors.length ? "failed" : "passed", url, device, actual: errors.length ? `${errors.length} error(s): ${errors.slice(0, 3).join(" | ")}` : "No uncaught exceptions or console errors during load", expected: "No JavaScript errors" });
    add({ testId: "func.failed_requests", status: failed.length ? "failed" : "passed", url, device, actual: failed.length ? `${failed.length} failed request(s): ${failed.slice(0, 3).join(" | ")}` : "All requests succeeded", expected: "No failed requests" });

    const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    add({ testId: "ux.overflow", status: overflow.sw > overflow.cw + 1 ? "failed" : "passed", url, device, actual: `scrollWidth ${overflow.sw}px vs viewport ${overflow.cw}px`, expected: "No horizontal scrolling" });

    const targets = await page.evaluate(() => {
      const els = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button]")];
      const small = [];
      let checked = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none") continue;
        checked++;
        if (r.width < 24 || r.height < 24) small.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return { checked, small: small.slice(0, 8), count: small.length };
    });
    add({ testId: "a11y.target_size", status: targets.count === 0 ? "passed" : targets.count > 3 ? "failed" : "warning", url, device, actual: targets.count ? `${targets.count} of ${targets.checked} targets under 24x24 CSS px: ${targets.small.join("; ")}` : `${targets.checked} targets checked`, expected: "At least 24x24 CSS px (WCAG 2.5.8)" });

    if (device === "mobile") {
      const nav = await page.evaluate(() => {
        const toggle = document.querySelector("[aria-label*=menu i], [aria-controls], .hamburger, .menu-toggle, button[aria-expanded]");
        const visibleLinks = [...document.querySelectorAll("nav a")].filter((a) => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
        return { hasToggle: Boolean(toggle), visibleLinks };
      });
      add({ testId: "ux.navigation.mobile", status: nav.hasToggle || nav.visibleLinks > 0 ? "passed" : "inconclusive", url, device, actual: nav.hasToggle ? "A menu control is present" : `${nav.visibleLinks} navigation link(s) visible without a toggle`, note: nav.hasToggle || nav.visibleLinks ? "The control's presence was detected; whether it opens correctly was not exercised." : "No navigation pattern could be recognised automatically." });
      const cta = await page.evaluate(() => {
        const els = [...document.querySelectorAll("a[href], button")].filter((e) => /contact|buy|book|start|get|call|quote|sign|subscribe|order|demo|trial/i.test(e.textContent || ""));
        return els.some((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top < window.innerHeight && r.bottom > 0; });
      });
      add({ testId: "biz.mobile_conversion", status: cta ? "passed" : "failed", url, device, actual: cta ? "A primary action is visible without scrolling" : "No call-to-action visible in the first mobile screen", expected: "A primary action above the fold on mobile" });
    }

    // reflow at 320px
    await page.setViewportSize({ width: 320, height: 800 });
    await page.waitForTimeout(300);
    const reflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    add({ testId: "a11y.reflow", status: reflow.sw > reflow.cw + 2 ? "failed" : "passed", url, device, actual: `scrollWidth ${reflow.sw}px at a 320px viewport`, expected: "No two-dimensional scrolling at 320 CSS px (WCAG 1.4.10)" });

    // layout across viewports
    const widths = [360, 768, 1280];
    const bad = [];
    for (const w of widths) { await page.setViewportSize({ width: w, height: 800 }); await page.waitForTimeout(150); const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 1) bad.push(`${w}px (+${o}px)`); }
    add({ testId: "ux.layout", status: bad.length ? "failed" : "passed", url, device, actual: bad.length ? `Horizontal overflow at ${bad.join(", ")}` : `No overflow at ${widths.join(", ")} px`, expected: "No overflow at common widths" });

    // keyboard + focus visibility (sampled, bounded)
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const seq = [];
    let invisible = 0;
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const outlined = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
        const shadow = cs.boxShadow && cs.boxShadow !== "none";
        return { tag: el.tagName.toLowerCase(), label: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30), visible: outlined || shadow };
      });
      if (!info) continue;
      seq.push(info);
      if (!info.visible) invisible++;
    }
    if (device === "mobile" && devices.includes("desktop")) { await context.close(); continue; }
    add({ testId: "a11y.keyboard", status: seq.length ? "inconclusive" : "failed", url, device, actual: seq.length ? `Tab reached ${seq.length} focusable element(s) in 25 presses` : "Tab did not move focus to any element", note: seq.length ? "Reachability by Tab was confirmed; full keyboard operability (menus, dialogs, custom widgets) requires manual testing." : undefined });
    if (seq.length) add({ testId: "a11y.focus.visible", status: invisible === 0 ? "passed" : invisible > seq.length / 2 ? "failed" : "warning", url, device, actual: `${seq.length - invisible} of ${seq.length} focused elements showed an outline or shadow`, expected: "A visible focus indicator on every focusable element", note: "Heuristic: checks outline and box-shadow only; custom indicators using other properties may be missed." });
    await context.close();
  }
  if (blocked.length) add({ testId: "func.failed_requests", status: "informational", url, actual: `${blocked.length} request(s) were refused by the worker's egress policy`, note: blocked.slice(0, 3).join(" | ") });
  return findings;
}
