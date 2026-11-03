-- Optional display precision metadata for monetary values (minor units remain authoritative)
ALTER TABLE fin_journal_lines ADD COLUMN debit_display TEXT;
ALTER TABLE fin_journal_lines ADD COLUMN credit_display TEXT;
ALTER TABLE fin_invoices ADD COLUMN amount_display TEXT;
ALTER TABLE fin_payments ADD COLUMN amount_display TEXT;
