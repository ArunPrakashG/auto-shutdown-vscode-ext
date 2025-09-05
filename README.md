# Auto Shutdown VS Code Extension and Windows Service

# Auto Shutdown Chat — VS Code extension + Windows service

[![CI](https://github.com/ArunPrakashG/auto-shutdown-vscode-ext/actions/workflows/ci.yml/badge.svg)](https://github.com/ArunPrakashG/auto-shutdown-vscode-ext/actions/workflows/ci.yml)

A safety-first VS Code chat participant that can trigger a clean Windows shutdown after a chat response finishes. It talks to a companion Windows service over a named pipe. Disabled by default and ships with dry-run on by default.

This repo contains two deliverables:

- VS Code extension “Auto Shutdown Chat” (TypeScript) that contributes a chat participant `@auto-shutdown` and a command to toggle the feature.
- Windows service (C#/.NET 8) that listens on a named pipe for `PING`, `DRYRUN`, and `SHUTDOWN` commands. Packaged via a WiX v4 MSI installer.

Note: This can power off your machine. Validate end-to-end with dry-run before enabling real shutdown.

## ✨ Features

- VS Code Chat participant: `@auto-shutdown` uses the Language Model API to answer, then optionally signals shutdown when streaming completes.
- Opt-in with guardrails: global enable/disable, dry-run mode, and confirmation dialog.
- Reliable IPC: newline-delimited request/response over Windows named pipes with timeout + small retry/backoff.
- Windows service executes a clean shutdown with `SeShutdownPrivilege` and logs to console and Windows Event Log (when available).

## 🧱 Architecture

- Extension (client) → Windows named pipe server (service). Default pipe: `\\.\pipe\AutoShutdownService`.
- Commands supported by the service:
  - `PING` → `PONG`
  - `DRYRUN` → `OK dryrun` (if enabled)
  - `SHUTDOWN` → `ACK shutdown` and then initiates system shutdown

Service settings are in `windows-service/src/AutoShutdownService/appsettings.json` and can be overridden via environment variables (see Configuration).

## 📦 Prerequisites

- Windows 10/11
- Node.js 20+
- .NET SDK 8.0+
- WiX Toolset v4 (to build the MSI)

## 🚀 Install and quick start

You can validate IPC locally without installing the service as a Windows Service.

1. Build the service (Debug) and run it as a console app

```powershell
dotnet build windows-service/src/AutoShutdownService/AutoShutdownService.csproj -c Debug
& "windows-service/src/AutoShutdownService/bin/Debug/net8.0-windows/AutoShutdownService.exe"
```

2. Test the named pipe

```powershell
node windows-service/tools/test-pipe.js PING
node windows-service/tools/test-pipe.js DRYRUN
# Expect: PONG, and OK dryrun
```

3. Build the extension and run tests

```powershell
npm ci
npm test
```

## 🛠️ MSI install (service)

Build and install the Windows service via the WiX v4 MSI:

1. Build the MSI

```powershell
dotnet build windows-service/installer/AutoShutdownService.Installer.wixproj -c Release
```

MSI output: `windows-service/installer/bin/Release/AutoShutdownService.Installer.msi`.

2. Install/start (requires elevated PowerShell)

```powershell
msiexec /i "windows-service/installer/bin/Release/AutoShutdownService.Installer.msi" /qn
Get-Service AutoShutdownService
```

Service should report `Status: Running`.

3. Manage the service

```powershell
Start-Service AutoShutdownService
Stop-Service AutoShutdownService
Get-Service AutoShutdownService
```

4. Uninstall

```powershell
msiexec /x "windows-service/installer/bin/Release/AutoShutdownService.Installer.msi" /qn
```

If MSI uninstall fails, you can remove the service manually (Administrator):

```powershell
sc.exe delete AutoShutdownService
```

## ⚙️ Configuration

### Extension settings (User/Window scope)

- `autoShutdown.enabled` (boolean, default `false`): Enable shutdown signaling after the response finishes.
- `autoShutdown.dryRun` (boolean, default `true`): Send `DRYRUN` instead of `SHUTDOWN`.
- `autoShutdown.confirmBeforeShutdown` (boolean, default `true`): Ask for confirmation before signaling.
- `autoShutdown.pipeName` (string, default `AutoShutdownService`): Named pipe name (server listens on `\\.\pipe\<name>`).
- `autoShutdown.timeoutMs` (number, default `3000`): IPC timeout.

### Service settings (appsettings.json or ENV)

File: `windows-service/src/AutoShutdownService/appsettings.json`

```json
{
  "Service": {
    "PipeName": "AutoShutdownService",
    "ReadTimeoutMs": 5000,
    "WriteTimeoutMs": 5000,
    "AllowDryRun": true
  }
}
```

Environment variable overrides use the `AUTOSHUTDOWN_` prefix and `__` for nesting, for example:

```powershell
$env:AUTOSHUTDOWN_Service__PipeName = "AutoShutdownService"
$env:AUTOSHUTDOWN_Service__AllowDryRun = "true"
```

## 🧑‍💻 Usage

- Open the Chat view and type `@auto-shutdown <your question>`.
- The extension will stream the model response. After it completes, and if enabled, it will confirm and then contact the service.
- Start with dry-run enabled to verify connectivity (`Service response: OK dryrun`). When confident, turn dry-run off.

Command palette: “Auto Shutdown: Toggle Enabled”.

## 🧪 Development

- Compile extension: `npm run compile`
- Watch: `npm run watch`
- Package VSIX (optional): `npm run package`
- Tests (Mocha): `npm test` (compiles TS, builds .NET service, runs tests)

Notes for packaging/publishing with `@vscode/vsce`:

- Install the CLI: `npm i -g @vscode/vsce` (or use `npx @vscode/vsce`).
- Update `publisher` in `package.json` to your Marketplace publisher ID.
- `vsce package` creates a `.vsix` you can install locally.
- `vsce publish` requires a publisher and a Personal Access Token (see VS Code docs).

## 🔍 Troubleshooting

- Pipe not found (ENOENT): Ensure the service is running and the pipe name matches. `Get-Service AutoShutdownService`.
- Permission/ACL issues: When running the service console app for dev, use an elevated PowerShell so the secure pipe ACL can be created.
- Timeouts: Increase `autoShutdown.timeoutMs` in the extension or `ReadTimeoutMs` in the service if your environment is slow.
- Event Log: Event Viewer → Windows Logs → Application → Source: `AutoShutdownService`.
- File lock on rebuild: `Get-Process AutoShutdownService -ErrorAction SilentlyContinue | Stop-Process -Force`.

## ⚠️ Limitations and notes

- Windows only. Requires Administrator rights to install the service and to initiate shutdown.
- Not a web extension; requires Node.js `net` and local Windows named pipes.
- Chat requires a language model selectable in VS Code Chat. If no model is available, the extension reports this in chat.

## 📁 Project layout

```
src/                    # Extension sources (TypeScript)
windows-service/        # .NET 8 Windows service + WiX v4 installer
  src/AutoShutdownService/
  installer/
test/                   # Mocha tests (Node)
```

## 📜 License

No license file is currently included. Consider adding a LICENSE (for example, MIT or Apache-2.0) before publishing.

## 🙌 Acknowledgments

- Uses VS Code Chat Participant and Language Model APIs.
- WiX Toolset v4 for MSI packaging.
