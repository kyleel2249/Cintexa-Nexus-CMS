/** Separate Download and Print actions for a generated report. */
import type { GeneratedReport } from "./report-pdf";

export function downloadReport(r: GeneratedReport): void {
  const url = URL.createObjectURL(r.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = r.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Opens the browser print dialog for the real PDF (not the dashboard). Falls back to a new tab when printing from a frame is blocked. */
export function printReport(r: GeneratedReport): void {
  const url = URL.createObjectURL(r.blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  let done = false;
  const cleanup = () => { setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60_000); };
  frame.onload = () => {
    if (done) return;
    done = true;
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, "_blank", "noopener");
    }
    cleanup();
  };
  frame.src = url;
  document.body.appendChild(frame);
  // Some browsers never fire onload for PDF documents in a hidden frame.
  setTimeout(() => { if (!done) { done = true; window.open(url, "_blank", "noopener"); cleanup(); } }, 4000);
}
