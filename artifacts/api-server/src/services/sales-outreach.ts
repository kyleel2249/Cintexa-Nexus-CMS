/**
 * Sales outreach channel — email first.
 * Never sends without consent, opt-out check, autonomy level, and SMTP config.
 */

export type OutreachResult = {
  status: "sent" | "queued" | "blocked" | "not_configured" | "error";
  channel: "email";
  reason: string;
  messageId?: string;
};

export function buildOutreachCopy(input: {
  companyName: string;
  contactName?: string | null;
  industry?: string | null;
  theme?: string;
  agentName?: string;
}): { subject: string; body: string; evidence: string } {
  const name = input.contactName || "there";
  const theme = input.theme || "intro";
  const agent = input.agentName || "CINTEXA Sales";
  if (theme === "follow_up") {
    return {
      subject: `Quick follow-up — ${input.companyName}`,
      body: `Hi ${name},\n\nFollowing up in case my earlier note was buried. If improving how ${input.companyName} manages leads and follow-up is on your list, I’m happy to share a short checklist we use with similar teams${input.industry ? ` in ${input.industry}` : ""}.\n\nIf now isn’t the right time, just say so and I’ll close the loop.\n\nBest,\n${agent}\nCINTEXA Nexus`,
      evidence: "TEMPLATE",
    };
  }
  if (theme === "breakup") {
    return {
      subject: `Should I close your file, ${name}?`,
      body: `Hi ${name},\n\nI’ve reached out a few times and don’t want to clutter your inbox. I’ll assume the timing isn’t right and pause contact unless you reply.\n\nIf priorities change, I’m here.\n\n${agent}\nCINTEXA Nexus`,
      evidence: "TEMPLATE",
    };
  }
  return {
    subject: `${input.companyName} — quick question on sales follow-up`,
    body: `Hi ${name},\n\nI work with teams${input.industry ? ` in ${input.industry}` : ""} that lose deals in the gap between first contact and close. CINTEXA Nexus helps structure that process with clear ownership and follow-up.\n\nWorth a 15-minute look for ${input.companyName}?\n\nBest,\n${agent}\nCINTEXA Nexus\n\n—\nYou’re receiving this because someone at your organization was added as a sales lead with email consent. Reply STOP to opt out.`,
    evidence: "TEMPLATE",
  };
}

export async function sendSalesEmail(input: {
  to: string;
  subject: string;
  body: string;
  leadId?: number;
}): Promise<OutreachResult> {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM ?? smtpUser;

  if (!smtpHost || !smtpUser || !smtpPass) {
    return {
      status: "not_configured",
      channel: "email",
      reason: "SMTP_HOST / SMTP_USER / SMTP_PASS not configured. Message was not sent.",
    };
  }

  try {
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT ?? "587", 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: smtpUser, pass: smtpPass },
    });
    const info = await transporter.sendMail({
      from: smtpFrom,
      to: input.to,
      subject: input.subject,
      text: input.body,
    });
    return {
      status: "sent",
      channel: "email",
      reason: "Delivered via configured SMTP",
      messageId: info.messageId,
    };
  } catch (err: any) {
    return {
      status: "error",
      channel: "email",
      reason: err?.message || "SMTP send failed",
    };
  }
}

export function evaluateOutreachPermission(input: {
  optedOut?: boolean;
  consentEmail?: boolean;
  contactEmail?: string | null;
  agentAutonomyLevel?: number;
  agentCanOutreach?: boolean;
}): { allowed: boolean; reason: string } {
  if (input.optedOut) return { allowed: false, reason: "Lead opted out — contact suppressed." };
  if (!input.consentEmail) return { allowed: false, reason: "No email consent on file." };
  if (!input.contactEmail) return { allowed: false, reason: "No contact email." };
  if (input.agentCanOutreach === false) return { allowed: false, reason: "Agent not permitted to outreach." };
  const level = input.agentAutonomyLevel ?? 1;
  if (level < 3) {
    return { allowed: false, reason: `Autonomy level ${level} < 3 (EXECUTE). Prepare-only; human must approve or raise autonomy.` };
  }
  return { allowed: true, reason: "Consent, email, and autonomy level permit send." };
}
