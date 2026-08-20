import { jsPDF } from "jspdf";

export type ProposalPdfInput = {
  title: string;
  companyName: string;
  contactName?: string | null;
  body: {
    executiveSummary?: string;
    customerProblem?: string;
    proposedSolution?: string;
    scope?: string[];
    deliverables?: string[];
    timeline?: string;
    pricing?: { amount?: number | null; currency?: string; note?: string };
    nextSteps?: string[];
  };
  generatedAt?: string;
};

export function downloadProposalPdf(input: ProposalPdfInput) {
  const doc = new jsPDF();
  const margin = 16;
  let y = 20;
  const line = (text: string, size = 11, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, 210 - margin * 2);
    for (const ln of lines) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }
      doc.text(ln, margin, y);
      y += size * 0.45 + 4;
    }
  };

  line(input.title || "Proposal", 16, true);
  line(`${input.companyName}${input.contactName ? ` · ${input.contactName}` : ""}`, 11);
  line(`Generated: ${input.generatedAt || new Date().toISOString()}`, 9);
  y += 4;
  line("Executive summary", 13, true);
  line(input.body.executiveSummary || "—");
  line("Customer problem", 13, true);
  line(input.body.customerProblem || "—");
  line("Proposed solution", 13, true);
  line(input.body.proposedSolution || "—");
  if (input.body.scope?.length) {
    line("Scope", 13, true);
    input.body.scope.forEach((s) => line(`• ${s}`));
  }
  if (input.body.deliverables?.length) {
    line("Deliverables", 13, true);
    input.body.deliverables.forEach((s) => line(`• ${s}`));
  }
  line("Timeline", 13, true);
  line(input.body.timeline || "To be confirmed");
  line("Pricing", 13, true);
  const p = input.body.pricing;
  line(
    p?.amount != null
      ? `${p.currency || "GHS"} ${p.amount} — ${p.note || ""}`
      : p?.note || "Pricing requires authorized quote data",
  );
  if (input.body.nextSteps?.length) {
    line("Next steps", 13, true);
    input.body.nextSteps.forEach((s) => line(`• ${s}`));
  }
  y += 8;
  line("© Cintexa Technologies · cintexa.com — Proposal subject to approved terms.", 8);
  const safe = input.companyName.replace(/[^a-z0-9]+/gi, "-") || "Customer";
  doc.save(`CINTEXA-Proposal-${safe}.pdf`);
}
