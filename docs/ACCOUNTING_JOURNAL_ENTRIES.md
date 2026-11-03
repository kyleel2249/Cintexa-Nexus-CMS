# Journal Entries

- Create: `POST /api/finance/journals` with `lines[]` and optional `post: true`
- Unbalanced → HTTP 400 with difference
- Reverse: `POST /api/finance/journals/:id/reverse` creates opposite lines, posts them
- Trial balance / P&L / BS read posted journals only
