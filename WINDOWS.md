# CINTEXA Nexus — Windows + npm Setup

## Requirements

- Windows 10/11
- Node.js 20.19+ (Node 22 LTS recommended)
- npm 10+
- Git

Command Prompt (cmd.exe) and PowerShell are supported.

## 1. Verify Node and npm

Open Command Prompt and run:

```cmd
node --version
npm --version
```

## 2. Clone the repository

```cmd
git clone https://github.com/kyleel2249/Cintexa-Nexus-CMS.git
cd Cintexa-Nexus-CMS
```

## 3. Install dependencies

From the repository root:

```cmd
npm install
```

npm workspaces are used throughout the project. Do not install pnpm or run pnpm commands.

## 4. Type-check

```cmd
npm run typecheck
```

## 5. Run the CINTEXA web application

```cmd
npm run dev
```

Vite will print the local URL. Open it in Chrome or Edge.

## 6. Run the API server

Open a second Command Prompt window:

```cmd
cd Cintexa-Nexus-CMS
npm run dev:api
```

## 7. Run web app and API together

```cmd
npm run dev:all
```

## 8. Build

Frontend:

```cmd
npm run build:app
```

Full application build:

```cmd
npm run build
```

## 9. Preview the production frontend

```cmd
npm run preview
```

## 10. Clean reinstall

From the repository root in Command Prompt:

```cmd
rmdir /s /q node_modules
npm install
```

If `node_modules` does not exist, the first command can be ignored.

## Windows compatibility policy

Development commands use npm workspaces and Node.js-based tooling. Do not introduce `pnpm`, `sh -c`, `bash`, `export NAME=value`, `rm -rf`, or Unix-only executable paths into package scripts.

The project intentionally avoids platform-specific package-manager configuration so a standard Windows Node.js + npm installation can clone, install, type-check, develop and build the application.
