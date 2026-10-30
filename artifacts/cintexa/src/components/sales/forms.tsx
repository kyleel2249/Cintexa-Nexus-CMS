import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Hint } from "./Hint";
import { AiAutofillPanel, type AutofillKind } from "./AiAutofillPanel";
import { Modal, Field, Input, Select, Textarea, Checkbox, MoneyInput } from "./ui";
import { useSalesMutation } from "@/lib/sales/hooks";
import { fromLocalInput, toLocalInput } from "@/lib/sales/format";
import type { SalesApiError } from "@/lib/sales/api";

export type FieldType = "text" | "email" | "tel" | "url" | "number" | "money" | "date" | "datetime" | "textarea" | "select" | "checkbox" | "tags" | "password";

export interface FieldDef {
  name: string;
  label: string;
  type?: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  placeholder?: string;
  hint?: ReactNode;
  /** plain-language clue shown behind the (i) icon; defaults to the glossary entry for the label */
  explain?: ReactNode;
  rows?: number;
  /** span both columns of the form grid */
  wide?: boolean;
  /** hidden unless this returns true for the current values */
  when?: (values: Values) => boolean;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

export type Values = Record<string, string | boolean>;

function initialValues(fields: FieldDef[], initialObj?: object): Values {
  const initial = initialObj as Record<string, unknown> | undefined;
  const v: Values = {};
  for (const f of fields) {
    const raw = initial?.[f.name];
    if (f.type === "checkbox") v[f.name] = raw === true;
    else if (f.type === "tags") v[f.name] = Array.isArray(raw) ? raw.join(", ") : typeof raw === "string" ? raw : "";
    else if (f.type === "datetime") v[f.name] = typeof raw === "string" ? toLocalInput(raw) : "";
    else if (f.type === "date") v[f.name] = typeof raw === "string" ? raw.slice(0, 10) : "";
    else if (raw === null || raw === undefined) v[f.name] = f.type === "select" && f.options?.[0] && f.required ? f.options[0].value : "";
    else v[f.name] = String(raw);
  }
  return v;
}

/** Convert form strings to an API body. Empty optional values are omitted (or null with `nullEmpty`). */
export function toBody(fields: FieldDef[], values: Values, nullEmpty = false): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.when && !f.when(values)) continue;
    const raw = values[f.name];
    if (f.type === "checkbox") {
      body[f.name] = raw === true;
      continue;
    }
    const s = typeof raw === "string" ? raw.trim() : "";
    if (s === "") {
      if (nullEmpty && !f.required) body[f.name] = null;
      continue;
    }
    if (f.type === "number") body[f.name] = Number(s);
    else if (f.type === "tags") body[f.name] = s.split(",").map((t) => t.trim()).filter(Boolean);
    else if (f.type === "datetime") body[f.name] = fromLocalInput(s);
    else body[f.name] = s;
  }
  return body;
}

function issueFor(err: SalesApiError | null, name: string): string | undefined {
  if (!err) return undefined;
  const hit = err.issues.find((i) => i.path === name || i.path.endsWith(`.${name}`) || i.path.startsWith(`${name}.`) || i.path.startsWith(`${name}[`));
  return hit?.message;
}

export function FormModal({ open, onClose, title, description, fields, initial, submitLabel = "Save", submit, onDone, success, invalidate, size = "md", nullEmpty, extra, errorExtra, autofill, entityId }: {
  /** show the AI Autofill research panel for this kind of record */
  autofill?: AutofillKind;
  entityId?: number;
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  fields: FieldDef[];
  initial?: object;
  submitLabel?: string;
  submit: (body: Record<string, unknown>) => Promise<unknown>;
  onDone?: (result: unknown) => void;
  success?: string;
  invalidate?: string[];
  size?: "sm" | "md" | "lg" | "xl";
  nullEmpty?: boolean;
  extra?: ReactNode;
  /** extra UI for a specific server error (e.g. duplicate candidates); `retryWith` resubmits the same values plus extra body fields */
  errorExtra?: (err: SalesApiError, retryWith: (more: Record<string, unknown>) => void) => ReactNode;
}) {
  const [values, setValues] = useState<Values>(() => initialValues(fields, initial));
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setValues(initialValues(fields, initial));
      setClientErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const m = useSalesMutation((body: Record<string, unknown>) => submit(body), {
    invalidate,
    success,
    silentError: true,
    onSuccess: undefined,
  });
  const set = (name: string, v: string | boolean) => setValues((s) => ({ ...s, [name]: v }));
  const visible = useMemo(() => fields.filter((f) => !f.when || f.when(values)), [fields, values]);
  const globalError = m.error && m.error.issues.length === 0 ? m.error.message : m.error && !visible.some((f) => issueFor(m.error, f.name)) ? m.error.message : undefined;

  async function retryWith(more: Record<string, unknown>) {
    const res = await m.run({ ...toBody(fields, values, nullEmpty), ...more });
    if (res !== undefined) {
      onDone?.(res);
      onClose();
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    for (const f of visible) {
      const v = values[f.name];
      if (f.required && f.type !== "checkbox" && (typeof v !== "string" || v.trim() === "")) errs[f.name] = `${f.label} is required`;
      if (f.type === "number" && typeof v === "string" && v.trim() !== "" && Number.isNaN(Number(v))) errs[f.name] = "Enter a number";
      if (f.type === "email" && typeof v === "string" && v.trim() !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) errs[f.name] = "Enter a valid email address";
    }
    setClientErrors(errs);
    if (Object.keys(errs).length) return;
    const res = await m.run(toBody(fields, values, nullEmpty));
    if (res !== undefined) {
      onDone?.(res);
      onClose();
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} description={description} size={size}
      footer={<><Button type="button" variant="outline" onClick={onClose} disabled={m.pending}>Cancel</Button><Button type="submit" form="sales-form" disabled={m.pending}>{m.pending ? "Saving…" : submitLabel}</Button></>}>
      <form id="sales-form" onSubmit={onSubmit} noValidate>
        {globalError && <p role="alert" className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{globalError}</p>}
        {m.error && errorExtra?.(m.error, (more) => void retryWith(more))}
        {autofill && <AiAutofillPanel kind={autofill} fields={fields} values={values} setValue={(n, val) => set(n, val)} entityId={entityId} />}
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
          {visible.map((f) => {
            const err = clientErrors[f.name] ?? issueFor(m.error, f.name);
            const v = values[f.name];
            const common = { disabled: f.disabled, placeholder: f.placeholder };
            let control: ReactNode;
            if (f.type === "checkbox") {
              return <div key={f.name} className="sm:col-span-2"><Checkbox label={<>{f.label}<Hint term={f.label} text={f.explain} /></>} checked={v === true} onChange={(e) => set(f.name, e.target.checked)} disabled={f.disabled} />{err && <p role="alert" className="-mt-2 mb-2 text-[11px] text-rose-500">{err}</p>}</div>;
            } else if (f.type === "textarea") control = <Textarea {...common} rows={f.rows ?? 3} value={String(v)} onChange={(e) => set(f.name, e.target.value)} />;
            else if (f.type === "select") control = <Select disabled={f.disabled} value={String(v)} onChange={(e) => set(f.name, e.target.value)}>{!f.required && <option value="">—</option>}{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>;
            else if (f.type === "money") control = <MoneyInput {...common} value={String(v)} onChange={(x) => set(f.name, x)} />;
            else if (f.type === "date") control = <Input {...common} type="date" value={String(v)} onChange={(e) => set(f.name, e.target.value)} invalid={!!err} />;
            else if (f.type === "datetime") control = <Input {...common} type="datetime-local" value={String(v)} onChange={(e) => set(f.name, e.target.value)} invalid={!!err} />;
            else if (f.type === "number") control = <Input {...common} type="number" min={f.min} max={f.max} step={f.step ?? "any"} value={String(v)} onChange={(e) => set(f.name, e.target.value)} invalid={!!err} />;
            else control = <Input {...common} type={f.type === "tags" || !f.type ? "text" : f.type} value={String(v)} onChange={(e) => set(f.name, e.target.value)} invalid={!!err} autoComplete="off" />;
            return <Field key={f.name} label={f.label} explain={f.explain} error={err} hint={f.hint ?? (f.type === "tags" ? "Separate with commas" : undefined)} required={f.required} className={f.wide || f.type === "textarea" ? "sm:col-span-2" : undefined}>{control}</Field>;
          })}
        </div>
        {extra}
      </form>
    </Modal>
  );
}
