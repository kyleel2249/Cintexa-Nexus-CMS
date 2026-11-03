# Backup and Recovery

Until FIN_DB / DIARY_DB are bound to D1:

1. Export via API list endpoints (journals, invoices, diary entries) as operational backups.
2. After D1 binding: use `wrangler d1 export` / scheduled backups to R2.

Never treat isolate memory as durable recovery media.
