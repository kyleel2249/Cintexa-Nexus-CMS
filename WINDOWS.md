# CINTEXA Nexus — Windows Setup

## Requirements

- Windows 10/11
- Node.js 20.19+ (Node 22 LTS is recommended)
- pnpm 10+
- Git

PowerShell is supported. Command Prompt is also supported for the pnpm commands.

## 1. Install Node.js

Install Node.js LTS, then open a new PowerShell window and verify:

```powershell
node --version
npm --version
```

## 2. Install pnpm

```powershell
corepack enable
corepack prepare pnpm@10 --activate
pnpm --version
```

If Corepack is unavailable, install pnpm with npm:

```powershell
npm install --global pnpm
pnpm --version
```

## 3. Clone the repository

```powershell
git clone https://github.com/kyleel2249/Cintexa-Nexus-CMS.git
cd Cintexa-Nexus-CMS
git checkout feature/business-diagnostic-engine
```

## 4. Install dependencies

Use pnpm from the repository root:

```powershell
pnpm install
```

Do not use `npm install` or `yarn install` for this workspace.

The workspace no longer depends on POSIX `sh`, `export`, `bash`, or Unix-only cleanup commands for its normal development flow. Windows native esbuild/Vite optional packages are allowed to install.

If you are moving from an older checkout and pnpm reports a lockfile configuration mismatch, run:

```powershell
pnpm install
```

This regenerates `pnpm-lock.yaml` against the current cross-platform workspace configuration.

## 5. Type-check

```powershell
pnpm run typecheck
```

## 6. Run the CINTEXA web application

```powershell
pnpm run dev
```

Vite will print the local URL. Open it in Chrome or Edge.

## 7. Run the API server

In a second PowerShell window:

```powershell
cd Cintexa-Nexus-CMS
pnpm run dev:api
```

The API runner sets `NODE_ENV=development` through Node itself, so no Unix-style `export NODE_ENV=...` command is required.

## 8. Build

Frontend:

```powershell
pnpm run build:app
```

Full workspace:

```powershell
pnpm run build
```

## 9. Common Windows fixes

### PowerShell blocks scripts

If PowerShell reports an execution-policy error, use the current-user policy:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then reopen PowerShell.

### Port already in use

Find the process:

```powershell
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
```

Stop the relevant process if required:

```powershell
Stop-Process -Id <PID> -Force
```

### Clean dependency reinstall

From the repository root:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
pnpm install
```

For a workspace package only:

```powershell
pnpm --filter @workspace/cintexa install
```

## Windows compatibility policy

New development scripts must use Node.js APIs or cross-platform package runners. Avoid introducing `sh -c`, `bash`, `export NAME=value`, `rm -rf`, or Unix-specific executable paths into package scripts.
