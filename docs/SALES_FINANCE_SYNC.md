# Sales ↔ Finance Sync

| Event | Finance effect | Diary |
|-------|----------------|-------|
| Invoice via `/finance/invoices` or `/from-sales/invoice` | Dr AR / Cr Revenue (posted) | Activity note |
| Payment via `/finance/payments` | Dr Bank / Cr AR; allocate to invoice | (via sync if extended) |

Idempotency: `sourceModule` + `sourceId` on invoices and payments.
