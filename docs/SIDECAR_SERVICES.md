# Sidecar services

## CD Optimizer (Python)

Source: https://github.com/kyleel2249/CD-Optimizer

```bash
# Example
export CD_OPTIMIZER_SERVICE_URL=http://127.0.0.1:8090
# Run the Python API so Nexus can POST /compress with base64 payloads
```

Without this URL, Nexus uses the built-in gzip/brotli engine.

## Nexus Finance OCR / document processor

Source: https://github.com/kyleel2249/CINTEXA-Nexus-Finance (`packages/document-processor`)

Wire as:

```bash
export NEXUS_FINANCE_OCR_URL=http://127.0.0.1:8091
```

Current Nexus Finance UI accepts **manual statement fields**. OCR extraction should POST normalized figures into `POST /api/nexus/finance/analyze`.

## Auth enforcement

```bash
export AUTH_ENFORCE=true   # require auth + module permissions on tool routes
# or NODE_ENV=production
```

Pass `Authorization: Bearer <token>` and optional `X-Organization-Id: <org>`.
