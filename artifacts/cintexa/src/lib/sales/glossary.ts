/**
 * Plain-language glossary for every term shown in Sales Management (sections, fields, statuses, metrics, AI and research terms).
 * Used by <Term>/<Hint> (info icons and dotted-underline clues on labels, table headers, tabs, KPI cards and badges) and by the
 * searchable Glossary page. To explain a new term, add it here - every screen that shows that exact word picks it up automatically.
 */
export interface GlossaryEntry { term: string; short: string; more?: string; category: Category; aliases?: string[] }
export type Category = "Sections" | "Leads & contacts" | "Accounts" | "Pipeline" | "Quotes & orders" | "Targets & forecast" | "People & pay" | "Retention & campaigns" | "Reports & automation" | "AI & agents" | "Research & evidence" | "SEO & AEO" | "Statuses";

const E = (category: Category, term: string, short: string, more?: string, aliases?: string[]): GlossaryEntry => ({ term, short, more, category, aliases });

export const GLOSSARY: GlossaryEntry[] = [
  // ───────── sections
  E("Sections", "Sales Overview", "Your starting page: key numbers, what needs attention today and links into every other section."),
  E("Sections", "Leads", "People or companies that have shown possible interest but are not yet confirmed customers or deals.", "A lead becomes an account, a contact and an opportunity when you convert it.", ["lead"]),
  E("Sections", "Accounts & Customers", "The companies or individuals you sell to, or want to sell to. Everything else (contacts, deals, orders) hangs off an account.", undefined, ["accounts", "account", "customers"]),
  E("Sections", "Contacts", "The people who work at an account. A contact is a person; an account is the organisation.", undefined, ["contact"]),
  E("Sections", "Opportunities & Pipeline", "Opportunities are specific deals you are trying to win. The pipeline is all open opportunities arranged by stage.", undefined, ["pipeline", "opportunities", "opportunity"]),
  E("Sections", "Activities & Follow-ups", "Calls, emails, meetings and tasks - what you did and what you must still do.", undefined, ["activities", "follow-ups", "follow ups"]),
  E("Sections", "Sales Targets & Quotas", "The goals set for the company, teams or people for a period, and progress against them.", undefined, ["targets"]),
  E("Sections", "Products & Price Books", "What you sell and the prices that apply. A price book is a named list of prices (e.g. Retail, Wholesale).", undefined, ["products", "price books", "price book"]),
  E("Sections", "Quotations & Proposals", "Priced offers you send to customers before an order. A quotation is binding only until its validity date.", undefined, ["quotations", "quotation", "proposals"]),
  E("Sections", "Sales Orders", "Confirmed purchases: what the customer ordered, delivery progress and payments.", undefined, ["orders", "order"]),
  E("Sections", "Sales Forecasting", "Estimates of how much you are likely to close in a period, based on your open deals and past results.", undefined, ["forecasting", "forecast"]),
  E("Sections", "Sales Performance", "How individuals and teams are doing against targets and against each other.", undefined, ["performance"]),
  E("Sections", "Sales Territories & Teams", "How sales people are grouped and which regions or segments each group covers.", undefined, ["teams", "territories", "team", "territory"]),
  E("Sections", "Commissions & Incentives", "Pay earned from sales under written rules. Calculation, approval and payment are separate steps.", undefined, ["commissions", "commission"]),
  E("Sections", "Customer Retention", "Keeping existing customers: health scores, renewals, complaints and surveys.", undefined, ["retention"]),
  E("Sections", "Sales Campaigns", "Organised pushes (email, events, ads) to create leads or sales, tracked by cost and result.", undefined, ["campaigns", "campaign"]),
  E("Sections", "Competitor Intelligence", "What you know about rival companies and how often you win or lose against them.", undefined, ["competitors", "competitor"]),
  E("Sections", "Sales Reports & Analytics", "Ready-made and custom reports on sales numbers.", undefined, ["reports"]),
  E("Sections", "Sales Automation", "Rules that do routine work for you when something happens (create a task, notify someone, ask for approval).", undefined, ["automation", "automations"]),
  E("Sections", "Sales Playbook & Training", "Your team's approved scripts, objection answers and training material.", undefined, ["playbook"]),
  E("Sections", "Sales Documents", "Files attached to sales records: contracts, proposals, meeting summaries.", undefined, ["documents"]),
  E("Sections", "Sales Settings", "Business rules: team, roles, currencies, approval limits, integrations and AI switches.", undefined, ["settings"]),
  E("Sections", "Sales AI Command Centre", "Where the AI agents are switched on, run and reviewed, and where their proposed actions wait for approval.", undefined, ["command centre", "command center"]),
  // ───────── leads & contacts
  E("Leads & contacts", "First name", "The person's given name."), E("Leads & contacts", "Last name", "The person's family name."),
  E("Leads & contacts", "Email", "A business email for this person or organisation. Only publicly listed addresses are ever suggested by research, and a shared mailbox such as info@ is not a person's own email."),
  E("Leads & contacts", "Phone", "A contact phone number, ideally with the country code (e.g. +233…). Email or phone is required on a lead so you can reach it."),
  E("Leads & contacts", "Company", "The organisation the lead works for or represents."),
  E("Leads & contacts", "Job title", "The person's position, e.g. Operations Manager. A title shows influence, but it does not prove they can sign a purchase."),
  E("Leads & contacts", "Source", "Where the lead came from (web form, referral, event…). Choose the real origin - reports on which channels work depend on it.", undefined, ["lead source"]),
  E("Leads & contacts", "Priority", "How urgently this should be handled: low, medium, high or urgent."),
  E("Leads & contacts", "Estimated value", "Your best guess of what this lead could be worth if it buys. A guess, not a quote."),
  E("Leads & contacts", "Budget", "The amount the customer says they can spend. Only enter what they told you."),
  E("Leads & contacts", "Industry", "The kind of business (e.g. Logistics, Retail). Research suggests one from the website text; treat it as an estimate until you confirm."),
  E("Leads & contacts", "Country", "The country where the organisation operates or is based."),
  E("Leads & contacts", "Product interest", "What the lead has asked about or seems to need."),
  E("Leads & contacts", "Contact consented to email", "The person agreed to receive sales emails. Without a tick, marketing emails must not be sent."),
  E("Leads & contacts", "Contact consented to WhatsApp", "The person agreed to be messaged on WhatsApp. Without a tick, do not send WhatsApp sales messages."),
  E("Leads & contacts", "Consented to email", "The person agreed to receive sales emails."), E("Leads & contacts", "Consented to WhatsApp", "The person agreed to be messaged on WhatsApp."),
  E("Leads & contacts", "Notes", "Free text for anything the structured fields do not cover. Do not put passwords or payment card numbers here."),
  E("Leads & contacts", "Lead score", "A number showing how promising a lead looks, calculated from recorded facts. Every point added or removed is listed so you can check it.", undefined, ["score"]),
  E("Leads & contacts", "Qualification", "Checking whether a lead is worth pursuing, usually against Budget, Authority, Need and Timing (BANT).", undefined, ["qualify", "qualified"]),
  E("Leads & contacts", "BANT", "A checklist for qualifying: Budget (can they pay?), Authority (can they decide?), Need (do they have a problem you solve?), Timing (when will they buy?)."),
  E("Leads & contacts", "ICP", "Ideal customer profile: the kind of company that buys most easily and stays longest.", undefined, ["ideal customer profile"]),
  E("Leads & contacts", "Convert", "Turn a qualified lead into an account, contact and opportunity in one step. Nothing is converted without you confirming.", undefined, ["conversion", "converted"]),
  E("Leads & contacts", "Duplicate", "Two records that appear to be the same person or company. Merge them to keep one clean history.", undefined, ["duplicates", "duplicate detection"]),
  E("Leads & contacts", "Role in decisions", "How this person influences a purchase: decision maker (signs), influencer, champion (supports you inside), billing or technical.", undefined, ["role"]),
  E("Leads & contacts", "Decision maker", "The person with the authority to approve the purchase."), E("Leads & contacts", "Champion", "An insider who wants you to win and helps you internally."),
  E("Leads & contacts", "Influencer", "Someone whose opinion shapes the decision but who cannot approve it alone."),
  E("Leads & contacts", "Primary contact for the account", "The main person you deal with at this account. Only one contact per account can be primary.", undefined, ["primary contact"]),
  E("Leads & contacts", "Web forms", "Public forms you can share or embed so visitors create leads directly, with their consent recorded.", undefined, ["web form", "lead forms"]),
  // ───────── accounts
  E("Accounts", "Account name", "The official or trading name of the company or person."),
  E("Accounts", "Type", "Whether the account is a company or an individual buyer.", undefined, ["kind"]),
  E("Accounts", "Status", "Where the account stands: prospect (not bought yet), active, inactive (quiet) or churned (lost)."),
  E("Accounts", "Website", "The organisation's official web address. Research reads this site (public pages only) to suggest facts."),
  E("Accounts", "Segment", "A group you place the account in for targeting, such as SME or Enterprise."),
  E("Accounts", "Company size", "Number of employees or a size band. Only enter it if it is published or told to you; research leaves it blank when unknown."),
  E("Accounts", "Classification", "Your own category for the account, e.g. Key account or Strategic."),
  E("Accounts", "Address", "Street address of the account's office.", undefined, ["address line"]),
  E("Accounts", "City", "Town or city of the address."), E("Accounts", "Region", "State, province or region of the address."), E("Accounts", "Postal code", "ZIP or postal code of the address."),
  E("Accounts", "Currency (ISO)", "The three-letter currency code used for this account's prices, e.g. GHS, USD, EUR.", undefined, ["currency"]),
  E("Accounts", "Payment terms (days)", "How many days the customer has to pay after an invoice, e.g. 30.", undefined, ["payment terms"]),
  E("Accounts", "Credit limit", "The most this customer may owe at one time before new orders need approval."),
  E("Accounts", "Expected reorder every (days)", "How often this customer normally buys again. The system flags them when they go quiet well past this rhythm.", undefined, ["reorder interval"]),
  E("Accounts", "Tags", "Short labels you can filter by, separated with commas (e.g. logistics, priority).", undefined, ["tag"]),
  E("Accounts", "Account health", "A rating (healthy, watch, at risk) from recorded orders, complaints and activity. Accounts with no history show 'unknown' rather than a guess.", undefined, ["health"]),
  E("Accounts", "Churn", "A customer who stopped buying or cancelled.", undefined, ["churned"]),
  E("Accounts", "Cross-sell", "Selling a different product to an existing customer."), E("Accounts", "Upsell", "Selling a bigger or better version to an existing customer."),
  // ───────── pipeline
  E("Pipeline", "Opportunity name", "A short title for the deal, e.g. 'Acme - fleet software'."),
  E("Pipeline", "Amount", "The expected value of the deal in the account's currency."),
  E("Pipeline", "Expected close", "The date you realistically expect the customer to decide.", undefined, ["expected close date", "close date"]),
  E("Pipeline", "Next action", "The single next step that moves this deal forward, with a date. Deals with no next step are flagged.", undefined, ["next step", "next steps"]),
  E("Pipeline", "Stage", "How far the deal has progressed (for example Qualify, Propose, Negotiate). Each stage has a win probability.", undefined, ["stages"]),
  E("Pipeline", "Probability", "How likely a deal at this stage is to be won, as a percentage. Calibrate it against your real history.", undefined, ["win probability"]),
  E("Pipeline", "Weighted pipeline", "Amount x probability for every open deal, added together - a more realistic total than the raw pipeline.", undefined, ["weighted"]),
  E("Pipeline", "Win rate", "Won deals divided by won plus lost deals. A small sample makes this unreliable."), E("Pipeline", "Won", "The customer said yes."), E("Pipeline", "Lost", "The customer said no, or chose someone else."),
  E("Pipeline", "Deal health", "A score for how likely the deal is to progress, with every deduction listed (no activity, overdue close date, single contact…).", undefined, ["deal risk"]),
  E("Pipeline", "Stalled", "A deal that has had no movement for longer than the allowed time in its stage.", undefined, ["stalled deals"]),
  E("Pipeline", "Forecast category", "Where you place the deal in your forecast: pipeline, best case, commit, closed or omitted.", undefined, ["forecast categories"]),
  E("Pipeline", "Commit", "Deals you are confident will close in the period."), E("Pipeline", "Best case", "Deals that could close if things go well, beyond your commit."), E("Pipeline", "Omitted", "Deals left out of the forecast."),
  E("Pipeline", "Loss reason", "Why a deal was lost. Recording it honestly is how the team learns."),
  E("Pipeline", "Stakeholder", "Anyone involved in or affected by the purchase decision."),
  // ───────── quotes & orders
  E("Quotes & orders", "Quotation number", "The unique reference of a quotation.", undefined, ["number"]),
  E("Quotes & orders", "Validity date", "The last day the quoted prices can be accepted.", undefined, ["valid until", "validity"]),
  E("Quotes & orders", "Discount", "A price reduction. Discounts above the approved limit need a manager's approval."),
  E("Quotes & orders", "Margin", "Profit as a share of the selling price after costs. Shown only to people allowed to see costs.", undefined, ["gross margin"]),
  E("Quotes & orders", "Subtotal", "The sum of lines before tax and discounts."), E("Quotes & orders", "Tax", "Sales tax such as VAT added to the total."), E("Quotes & orders", "Total", "The final amount payable."),
  E("Quotes & orders", "Line items", "The individual products or services on a quotation or order.", undefined, ["lines"]),
  E("Quotes & orders", "Superseded", "Replaced by a newer version of the quotation."),
  E("Quotes & orders", "Payment status", "Whether the order is unpaid, partly paid, paid, refunded or overpaid."),
  E("Quotes & orders", "Fulfilled", "All ordered items have been delivered."), E("Quotes & orders", "Partially fulfilled", "Some, but not all, items have been delivered."),
  E("Quotes & orders", "Booked", "Revenue counted when the order is confirmed, before invoicing or payment."),
  E("Quotes & orders", "Invoiced", "Revenue counted when an invoice has been issued."), E("Quotes & orders", "Collected", "Revenue counted only when the money has actually been received."),
  E("Quotes & orders", "SKU", "Stock-keeping unit: a unique code for a product."), E("Quotes & orders", "Unit price", "The price for one unit before discount and tax."),
  // ───────── targets & forecast
  E("Targets & forecast", "Target", "The amount or count a person, team or company aims to reach in a period."),
  E("Targets & forecast", "Quota", "A target a sales person is measured and often paid against."),
  E("Targets & forecast", "Attainment", "Actual result divided by target, as a percentage.", undefined, ["achievement"]),
  E("Targets & forecast", "Scope", "Who or what a target applies to: company, team, member, product, territory…", undefined, ["target scope"]),
  E("Targets & forecast", "Metric", "What is measured: revenue, units, gross profit, new customers or deals won.", undefined, ["target metric"]),
  E("Targets & forecast", "Basis", "Whether results count when booked, invoiced or collected. These are never mixed.", undefined, ["target basis"]),
  E("Targets & forecast", "Period", "The time window: month, quarter, year or a custom range.", undefined, ["period kind"]),
  E("Targets & forecast", "Worst case", "A cautious forecast: only the deals most certain to close."), E("Targets & forecast", "Expected", "The most likely forecast, using stage probabilities."),
  E("Targets & forecast", "Gap to target", "How far current results plus the forecast fall short of the target."),
  E("Targets & forecast", "Coverage", "Open pipeline value divided by what you still need to hit target. About 3x is a common rule of thumb; yours may differ.", undefined, ["pipeline coverage"]),
  E("Targets & forecast", "Sales velocity", "How fast deals move through the pipeline into revenue."),
  E("Targets & forecast", "Confidence interval", "A range expected to contain the true value. Shown only when there is enough data.", undefined, ["ci"]),
  // ───────── people & pay
  E("People & pay", "Sales role", "What a team member may see and do: admin, director, manager, rep or analyst.", undefined, ["roles"]),
  E("People & pay", "Record scope", "Which records a role can see: own, team or all."),
  E("People & pay", "Owner", "The sales person responsible for a record.", undefined, ["assigned to"]),
  E("People & pay", "Commission plan", "The written rule that says how sales turn into pay.", undefined, ["commission rule", "plan"]),
  E("People & pay", "Commission entry", "One calculated amount owed to one person for one sale."),
  E("People & pay", "Clawback", "Taking back commission, for example when a customer cancels or returns goods."),
  E("People & pay", "Approved", "A person with authority has checked and accepted it."), E("People & pay", "Calculated", "The amount was worked out but has not yet been approved or paid."),
  E("People & pay", "Reversed", "A previous entry was cancelled and offset."), E("People & pay", "Leaderboard", "A ranking of people by results in a period."),
  // ───────── retention & campaigns
  E("Retention & campaigns", "Renewal", "A customer's agreement coming up for renewal or repurchase."),
  E("Retention & campaigns", "Complaint", "A customer's expression of dissatisfaction that needs a response."),
  E("Retention & campaigns", "Survey", "A customer satisfaction rating (1-10) you recorded."), E("Retention & campaigns", "Service request", "A customer asking for support rather than a sale."),
  E("Retention & campaigns", "Cost per lead", "Campaign spend divided by leads produced. Shown only when spend has been entered."),
  E("Retention & campaigns", "ROI", "Return on investment: (revenue from the campaign - cost) divided by cost.", undefined, ["return on investment"]),
  E("Retention & campaigns", "UTM campaign", "A tag added to links so web analytics can tell which campaign brought a visitor.", undefined, ["utm"]),
  E("Retention & campaigns", "Target segment", "The group of customers a campaign is aimed at."), E("Retention & campaigns", "Objective", "What the campaign is meant to achieve."),
  E("Retention & campaigns", "Spend to date", "Money spent on the campaign so far."), E("Retention & campaigns", "Channel", "How the campaign reaches people (email, WhatsApp, events, paid ads…)."),
  E("Retention & campaigns", "Fatigue", "Audience response dropping because they have seen too much of the same message."),
  E("Retention & campaigns", "Positioning", "How a company presents itself against others in the market."), E("Retention & campaigns", "Value proposition", "The main reason a customer should choose one company's offer."),
  E("Retention & campaigns", "Strengths", "Things a competitor does well."), E("Retention & campaigns", "Weaknesses", "Things a competitor does poorly."),
  E("Retention & campaigns", "Verified", "Checked against a reliable source rather than only reported."),
  // ───────── reports & automation
  E("Reports & automation", "Trigger", "The event or schedule that starts an automation rule."), E("Reports & automation", "Condition", "A test that must be true for the rule's action to run."),
  E("Reports & automation", "Action", "What the rule does when triggered and its conditions are met."),
  E("Reports & automation", "Idempotent", "Safe to repeat: running it twice has the same effect as once, with no duplicates.", undefined, ["idempotency"]),
  E("Reports & automation", "Outbox", "A queue of messages waiting to be sent, so a failure never loses them."),
  E("Reports & automation", "Webhook", "An automatic message another system sends or receives when something happens."), E("Reports & automation", "Audit log", "A permanent record of who did what and when. It cannot be edited.", undefined, ["audit"]),
  E("Reports & automation", "Dashboard", "A page of key numbers and charts."), E("Reports & automation", "Export", "Download data as a file such as CSV. Exports are logged."), E("Reports & automation", "Import", "Bring data in from a CSV file, with a preview of problems before anything is saved."),
  E("Reports & automation", "Aggregation", "How numbers are combined (sum, count, average)."),
  // ───────── AI & agents
  E("AI & agents", "AI Autofill", "Researches the company on the public web and proposes values for empty fields. Nothing is saved until you review it and click Save."),
  E("AI & agents", "Agent", "A specialised helper that checks one area (for example stalled deals) using your records and proposes what to do.", undefined, ["agents"]),
  E("AI & agents", "Autonomy level", "How much an agent may do alone. L1 Observe: reports only. L2 Prepare: also drafts actions for approval. L3 Execute: may run safe internal actions.", undefined, ["level", "autonomy"]),
  E("AI & agents", "Observe", "Level 1: the agent only reports findings."), E("AI & agents", "Prepare", "Level 2: the agent also drafts actions that wait for approval."), E("AI & agents", "Execute", "Level 3: the agent may run internal actions that policy allows without approval."),
  E("AI & agents", "Approval", "A person's yes/no on an action an agent proposed. Protected actions (messages, prices, discounts) always need one.", undefined, ["approvals"]),
  E("AI & agents", "Four-eyes", "A second person must approve; nobody can approve their own request."),
  E("AI & agents", "Finding", "Something an agent noticed, with the evidence and a suggested action.", undefined, ["findings", "recommendation", "recommendations"]),
  E("AI & agents", "Severity", "How serious a finding is: info, low, medium, high or critical."),
  E("AI & agents", "Model tier", "Which class of AI model is used: economy (cheap), standard or reasoning (deepest).", undefined, ["model"]),
  E("AI & agents", "Deterministic", "Calculated by fixed rules from your data, so the same data always gives the same answer. Agents' numbers are deterministic; AI only words the explanation."),
  E("AI & agents", "Paused", "Switched off for now; it will not run until resumed."), E("AI & agents", "Briefing", "A short executive summary of the latest findings.", undefined, ["executive briefing"]),
  E("AI & agents", "Event bus", "The internal channel that tells agents when records change."), E("AI & agents", "Dead letter", "An event that failed repeatedly and was set aside for inspection.", undefined, ["dead-lettered"]),
  // ───────── research & evidence
  E("Research & evidence", "Research Company", "Reads the company's public website (and optionally search results) and lists what it found, with sources."),
  E("Research & evidence", "Evidence", "The page address, exact place and time a value came from, so you can check it yourself.", undefined, ["source", "sources", "view sources"]),
  E("Research & evidence", "Confidence", "A score from 0 to 100% for how well-supported a value is. It comes from a fixed formula (source type, agreement between pages, domain match, age) and is NOT a statistical probability.", undefined, ["confidence score"]),
  E("Research & evidence", "Verification", "How firmly a value is supported: verified, corroborated, single source, unverified or conflicting.", undefined, ["verification status"]),
  E("Research & evidence", "Single source", "Found on only one page. Plausible, but not cross-checked."), E("Research & evidence", "Corroborated", "Two or more pages agree."),
  E("Research & evidence", "Unverified", "Derived or inferred rather than read directly. Check it before relying on it."), E("Research & evidence", "Conflicting", "Sources disagree. Choose which is right."),
  E("Research & evidence", "Fact", "Read directly from an official source."), E("Research & evidence", "Estimate", "A reasoned guess from the evidence (for example an industry inferred from keywords)."),
  E("Research & evidence", "Hypothesis", "An idea to test with the customer, such as a possible need. Never a confirmed fact."),
  E("Research & evidence", "Apply selected", "Copies only the ticked suggestions into the form. You still review and save the form."), E("Research & evidence", "Accept all", "Ticks every safe suggestion for empty fields. It never overwrites what you already typed."),
  E("Research & evidence", "Clear AI drafts", "Throws away suggestions you have not applied."), E("Research & evidence", "Refresh research", "Reads the website again for newer information instead of reusing a recent result."),
  E("Research & evidence", "New", "A suggestion for a field that is currently empty."), E("Research & evidence", "Update", "A suggestion that differs from what is already in the field."), E("Research & evidence", "Same", "The suggestion matches what you already have."),
  E("Research & evidence", "robots.txt", "A public file where a website tells automated tools which pages not to read. Research obeys it.", undefined, ["robots"]),
  E("Research & evidence", "Public pages only", "Research never logs in, bypasses paywalls or CAPTCHAs, or reads private pages."),
  E("Research & evidence", "Search provider", "A paid or free web-search service (Brave, Serper or Tavily) the server uses to find a company's website from its name."),
  E("Research & evidence", "Awaiting review", "Research is finished and waiting for you to decide what to use."),
  E("Research & evidence", "Researching", "The system is reading the website now."), E("Research & evidence", "Extracting", "Pulling facts out of the pages that were read."), E("Research & evidence", "Validating", "Checking and scoring what was found."),
  // ───────── SEO & AEO
  E("SEO & AEO", "SEO", "Search engine optimisation: making a site easier for Google and others to find, read and rank."),
  E("SEO & AEO", "AEO", "Answer engine optimisation: making content easy for AI assistants and answer boxes to quote correctly."),
  E("SEO & AEO", "SEO title", "The headline shown for a page in search results. About 50-60 characters displays in full.", undefined, ["title tag", "title"]),
  E("SEO & AEO", "Meta description", "The summary shown under the title in search results. About 70-160 characters works well."),
  E("SEO & AEO", "Slug", "The readable last part of a page address, e.g. /fleet-tracking."), E("SEO & AEO", "Canonical", "A tag stating which web address is the preferred version of a page.", undefined, ["canonical url"]),
  E("SEO & AEO", "Sitemap", "A file listing a site's pages so search engines can find them all."), E("SEO & AEO", "noindex", "An instruction asking search engines not to list a page."),
  E("SEO & AEO", "Structured data", "Machine-readable facts added to a page (who the company is, its address). Often written as JSON-LD using schema.org vocabulary.", undefined, ["json-ld", "schema.org", "schema markup"]),
  E("SEO & AEO", "Alt text", "A short written description of an image for screen readers and search engines.", undefined, ["image alt text"]),
  E("SEO & AEO", "H1", "The main heading of a page. There should usually be exactly one.", undefined, ["heading", "headings"]),
  E("SEO & AEO", "FAQ", "A list of common questions with short answers. Good for answer engines when it matches real page content.", undefined, ["faqpage", "faq schema"]),
  E("SEO & AEO", "Entity", "A clearly named thing (a company, product or place) that search and AI systems can recognise consistently."),
  E("SEO & AEO", "Keyword", "A word or phrase people type into search. Keyword ideas here are suggestions, not measured search volumes.", undefined, ["keywords", "focus keyword"]),
  E("SEO & AEO", "Internal links", "Links from one page of a site to another; they help visitors and crawlers navigate."),
  E("SEO & AEO", "Viewport", "The tag that makes a page fit a phone screen properly."), E("SEO & AEO", "Thin content", "A page with too little text to answer a visitor's question."),
  E("SEO & AEO", "Observed", "Directly seen in the pages that were read, as opposed to guessed."), E("SEO & AEO", "AEO topics", "Questions customers are likely to ask, suggested from the site's own headings."),
  // ───────── statuses
  E("Statuses", "New", "Just created; nobody has worked on it yet."), E("Statuses", "Contacted", "Someone has reached out."), E("Statuses", "Nurturing", "Not ready to buy yet; kept warm with occasional contact."),
  E("Statuses", "Disqualified", "Judged not a fit, with a reason recorded."), E("Statuses", "Prospect", "Not yet a customer."), E("Statuses", "Inactive", "Has gone quiet but is not lost."),
  E("Statuses", "Draft", "Still being written; not yet used or sent."), E("Statuses", "Pending approval", "Waiting for someone with authority to approve."), E("Statuses", "Sent", "Delivered to the customer."),
  E("Statuses", "Viewed", "The customer opened it."), E("Statuses", "Accepted", "The customer agreed."), E("Statuses", "Rejected", "Declined."), E("Statuses", "Expired", "Passed its validity date."),
  E("Statuses", "Cancelled", "Stopped before completion."), E("Statuses", "Confirmed", "Accepted as a firm order."), E("Statuses", "Processing", "Being prepared for delivery."), E("Statuses", "Completed", "Finished."),
  E("Statuses", "Unpaid", "No payment received."), E("Statuses", "Partial", "Part of the amount received."), E("Statuses", "Paid", "Fully paid."), E("Statuses", "Refunded", "Money returned to the customer."), E("Statuses", "Overpaid", "More received than was due."),
  E("Statuses", "Healthy", "Buying regularly with no warning signs."), E("Statuses", "Watch", "Some warning signs; keep an eye on it."), E("Statuses", "At risk", "Likely to be lost without action."), E("Statuses", "Unknown", "Not enough history to judge."),
  E("Statuses", "Low", "Lower importance."), E("Statuses", "Medium", "Normal importance."), E("Statuses", "High", "Important."), E("Statuses", "Urgent", "Needs attention now."),
  E("Statuses", "Open", "Still active and unresolved."), E("Statuses", "Active", "In use or running."), E("Statuses", "Archived", "Hidden from normal lists but kept for history."),
];

export const norm = (s: string) => s.toLowerCase().replace(/\s*\*\s*$/, "").replace(/[_\-–—:()]/g, " ").replace(/[^a-z0-9+ ]/g, "").replace(/\s+/g, " ").trim();
import { GLOSSARY_EXTRA } from "./glossary-extra";
GLOSSARY.push(...GLOSSARY_EXTRA);
const INDEX = new Map<string, GlossaryEntry>();
for (const e of GLOSSARY) { for (const k of [e.term, ...(e.aliases ?? [])]) { const n = norm(k); if (n && !INDEX.has(n)) INDEX.set(n, e); } }

/** Find the explanation for a label such as "Lead score", "lead_score", "Estimated value *" or a status key like "at_risk". */
export function lookupTerm(text: string | null | undefined): GlossaryEntry | null {
  if (!text) return null;
  const n = norm(text);
  if (!n || n.length > 60) return null;
  return INDEX.get(n) ?? (n.endsWith("s") ? INDEX.get(n.slice(0, -1)) ?? null : INDEX.get(n + "s") ?? null) ?? byPattern(text, n);
}

/** Families of labels that share one meaning ("Points: has email", "Quotation prefix", "Email: enabled"…). */
function byPattern(raw: string, n: string): GlossaryEntry | null {
  const mk = (short: string, category: Category = "Reports & automation"): GlossaryEntry => ({ term: raw.replace(/\s*\*$/, ""), short, category });
  let m: RegExpMatchArray | null;
  if ((m = n.match(/^points (.+)$/))) return mk(`Points added to a lead's score when ${m[1]}. Every point is listed on the lead so you can check it.`, "Leads & contacts");
  if ((m = n.match(/^(.+) prefix$/))) return mk(`The letters at the start of automatically numbered ${m[1]} references (for example ${m[1].slice(0, 3).toUpperCase()}-2026-0001).`);
  if ((m = n.match(/^(email|whatsapp|calendar|e signature|finance|inventory)( provider| enabled)?$/)) && m[2]) return mk(m[2].trim() === "enabled" ? `Switch the ${m[1]} connection on or off. It also needs a provider installed on the server.` : `Which service handles ${m[1]}. It must be installed and configured on the server.`);
  if ((m = n.match(/^duplicate check (.+)$/))) return mk(`When on, new records with the same ${m[1]} as an existing one are flagged as possible duplicates.`, "Leads & contacts");
  if ((m = n.match(/^(.+) max discount$/))) return mk(`The biggest discount a ${m[1]} may give without needing approval.`, "Quotes & orders");
  if ((m = n.match(/^enable (.+)$/))) return mk(`Turn ${m[1]} on or off.`);
  return null;
}
export const CATEGORIES: Category[] = ["Sections", "Leads & contacts", "Accounts", "Pipeline", "Quotes & orders", "Targets & forecast", "People & pay", "Retention & campaigns", "Reports & automation", "AI & agents", "Research & evidence", "SEO & AEO", "Statuses"];
