import { lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { Switch, Route } from "wouter";
import { Button } from "@/components/ui/button";
import { Spinner, ErrorState, PermissionDenied, Field, Input, Select, Panel } from "@/components/sales/ui";
import NotFound from "@/pages/not-found";
import { FinanceProvider, useFinance } from "@/context/FinanceContext";
import { fin } from "@/lib/finance/api";
import { useFinanceMutation } from "@/lib/finance/hooks";

const Dashboard = lazy(() => import("./dashboard"));
const Accounts = lazy(() => import("./accounts"));
const Journals = lazy(() => import("./journals"));
const Ledger = lazy(() => import("./ledger"));
const TrialBalance = lazy(() => import("./trial-balance"));
const Periods = lazy(() => import("./periods"));
const Approvals = lazy(() => import("./approvals"));
const Audit = lazy(() => import("./audit"));
const Customers = lazy(() => import("./customers"));
const Suppliers = lazy(() => import("./suppliers"));
const Invoices = lazy(() => import("./invoices"));
const Bills = lazy(() => import("./bills"));
const Receivables = lazy(() => import("./receivables"));
const Payables = lazy(() => import("./payables"));
const Payments = lazy(() => import("./payments"));
const Banking = lazy(() => import("./banking"));
const BankDetail = lazy(() => import("./bank-detail"));
const Cashbook = lazy(() => import("./cashbook"));
const Expenses = lazy(() => import("./expenses"));
const Tax = lazy(() => import("./tax"));
const Settings = lazy(() => import("./settings"));

const spinner = <div className="flex min-h-[300px] items-center justify-center"><Spinner className="h-6 w-6" /></div>;

function Guard({ perm, component: C }: { perm: string; component: ComponentType }) {
  const { can } = useFinance();
  return can(perm) ? <C /> : <PermissionDenied message="Your Finance role does not include this permission. Ask an organisation owner if you need it." />;
}
const R = (path: string, component: ComponentType, perm: string) => <Route path={path} key={path}><Guard perm={perm} component={component} /></Route>;

function CreateOrganisation() {
  const { reload } = useFinance();
  const [v, setV] = useState({ legal_name: "", trading_name: "", tax_id: "", country: "GH", functional_currency: "GHS" });
  const create = useFinanceMutation(() => fin.post("/organisations", { ...v, trading_name: v.trading_name || undefined, tax_id: v.tax_id || undefined }), { success: "Organisation created with a Ghana SME chart of accounts and the current fiscal year", onSuccess: () => reload() });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const err = (p: string) => create.error?.issues.find((i) => i.path === p)?.message;
  return (
    <div className="mx-auto max-w-xl py-10">
      <Panel title="Set up CINTEXA FINANCE" description="Create your first organisation. It gets its own isolated books, a Ghana SME chart of accounts (editable) and the current fiscal year.">
        <div className="p-4">
          <Field label="Registered business name" required error={err("legal_name")}><Input value={v.legal_name} onChange={set("legal_name")} maxLength={200} /></Field>
          <Field label="Trading name"><Input value={v.trading_name} onChange={set("trading_name")} maxLength={200} /></Field>
          <Field label="Tax identification number"><Input value={v.tax_id} onChange={set("tax_id")} maxLength={80} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Country" error={err("country")}><Input value={v.country} onChange={set("country")} maxLength={2} /></Field>
            <Field label="Functional currency" error={err("functional_currency")}>
              <Select value={v.functional_currency} onChange={set("functional_currency")}>{["GHS", "USD", "GBP", "EUR", "NGN"].map((c) => <option key={c}>{c}</option>)}</Select>
            </Field>
          </div>
          {create.error && !create.error.issues.length && <p role="alert" className="mb-3 text-sm text-rose-500">{create.error.message}</p>}
          <Button disabled={create.pending || v.legal_name.trim().length < 2} onClick={() => void create.run()}>{create.pending ? "Creating…" : "Create organisation"}</Button>
          <p className="mt-3 text-xs text-muted-foreground">Only a platform administrator can create organisations. If you were invited to an existing one, ask its owner to add your e-mail address.</p>
        </div>
      </Panel>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const f = useFinance();
  if (f.status === "loading") return spinner;
  if (f.status === "error" && f.error) return <ErrorState error={f.error} onRetry={() => void f.reload()} />;
  if (f.status === "no_org") return <CreateOrganisation />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground">
        <span>CINTEXA FINANCE · <span className="font-medium text-foreground">{f.org?.trading_name || f.org?.legal_name}</span> · {f.currency} · role: {f.role?.replace(/_/g, " ")}</span>
        {f.orgs.length > 1 && (
          <label className="flex items-center gap-2">Organisation
            <Select aria-label="Switch organisation" className="h-8 w-56 py-1 text-xs" value={String(f.org?.id ?? "")} onChange={(e) => f.switchOrg(Number(e.target.value))}>{f.orgs.map((o) => <option key={o.id} value={o.id}>{o.trading_name || o.legal_name}</option>)}</Select>
          </label>
        )}
      </div>
      {children}
    </>
  );
}

/** All Finance routes, mounted at /finance/* inside the normal CMS layout. */
export function FinanceRoutes() {
  return (
    <FinanceProvider>
      <Gate>
        <Suspense fallback={spinner}>
          <Switch>
            {R("/finance", Dashboard, "ledger:read")}
            {R("/finance/accounts", Accounts, "finance:read")}
            {R("/finance/journals", Journals, "ledger:read")}
            {R("/finance/ledger", Ledger, "ledger:read")}
            {R("/finance/trial-balance", TrialBalance, "ledger:read")}
            {R("/finance/periods", Periods, "finance:read")}
            {R("/finance/customers", Customers, "finance:read")}
            {R("/finance/invoices", Invoices, "finance:read")}
            {R("/finance/receivables", Receivables, "ledger:read")}
            {R("/finance/suppliers", Suppliers, "finance:read")}
            {R("/finance/bills", Bills, "finance:read")}
            {R("/finance/payables", Payables, "ledger:read")}
            {R("/finance/payments", Payments, "finance:read")}
            {R("/finance/banking/:id", BankDetail, "ledger:read")}
            {R("/finance/banking", Banking, "finance:read")}
            {R("/finance/cashbook", Cashbook, "ledger:read")}
            {R("/finance/expenses", Expenses, "finance:read")}
            {R("/finance/tax", Tax, "finance:read")}
            {R("/finance/approvals", Approvals, "finance:approve")}
            {R("/finance/audit", Audit, "audit:read")}
            {R("/finance/settings", Settings, "finance:read")}
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Gate>
    </FinanceProvider>
  );
}
