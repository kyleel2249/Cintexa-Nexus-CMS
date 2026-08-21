# CINTEXA Nexus — CD Optimizer & Nexus Finance Integration

## Architecture

```
CINTEXA Nexus (React + Express)
├── Core: auth, nav, theme, media, diagnostics, sales-force
├── /nexus/cd-optimizer  → Node compression engine (+ optional Python service)
└── /nexus/finance       → Financial health/ratios/distress/survival engine
```

## Source repositories

- https://github.com/kyleel2249/CD-Optimizer (Python core) — optional via `CD_OPTIMIZER_SERVICE_URL`
- https://github.com/kyleel2249/CINTEXA-Nexus-Finance — concepts ported into `nexus-finance-engine.ts`

## API

- `POST/GET /api/nexus/cd-optimizer/*`
- `POST/GET /api/nexus/finance/*`

## Feature flags

- `CD_OPTIMIZER_ENABLED` (default true)
- `CD_OPTIMIZER_SERVICE_URL` (optional external worker)
- `CD_OPTIMIZER_MAX_FILE_SIZE`
- `NEXUS_FINANCE_ENABLED` (default true)

## Limitations

- In-process job/analysis maps until DB persistence is fully wired.
- Neural/GPU CD modes require external CD-Optimizer service.
- Finance OCR from Finance monorepo not fully ported — statement form entry is primary path.
