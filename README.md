# Auto Shutdown VS Code Extension and Windows Service

This workspace contains:

- VS Code extension that owns a chat participant and, when enabled, signals a Windows service to initiate a clean shutdown after a completion.
- Windows service (net8.0-windows) listening on a named pipe for PING/DRYRUN/SHUTDOWN commands. Packaged by a WiX v4 MSI.

## Quick test of service IPC

- Build the service:
  - In VS Code terminal: dotnet build windows-service/src/AutoShutdownService/AutoShutdownService.csproj -c Debug
- Start the service as a console app (for dev):
  - Start-Process -FilePath windows-service/src/AutoShutdownService/bin/Debug/net8.0-windows/AutoShutdownService.exe -WindowStyle Hidden
  - Logs are written to windows-service/logs/ if started via the provided scripts.
- Test the pipe:
  - node windows-service/tools/test-pipe.js PING → expect "PONG"
  - node windows-service/tools/test-pipe.js DRYRUN → expect "OK dryrun"

## Run tests

- npm test
  - Builds the extension (TypeScript) and the .NET Windows service, then runs Mocha tests.
  - Includes a timeout test that spins a named-pipe server which deliberately never responds to verify client timeouts.

## CI status

- GitHub Actions workflow runs on Windows to lint and test changes (Node 20 + .NET 8). See `.github/workflows/ci.yml`.

## Manual SHUTDOWN validation (admin)

Warning: This powers off the machine. Keep dry-run on until you’re ready.

1. Install/start the service (MSI) as Administrator and confirm it’s running:

- `Get-Service AutoShutdownService` should show Status: Running.

2. In VS Code, ensure extension settings:

- `autoShutdown.enabled = true`
- `autoShutdown.confirmBeforeShutdown = true` (recommended)
- `autoShutdown.dryRun = true` (first)

3. Trigger a chat with `@auto-shutdown` and verify the service response in chat (OK dryrun).
4. When ready, set `autoShutdown.dryRun = false` and repeat. Confirm the modal. The system should initiate a clean shutdown.
5. If shutdown fails, check Windows Event Log: Application → Source `AutoShutdownService` for error details.

Default pipe name: AutoShutdownService (\\.\pipe\AutoShutdownService).

## Extension settings

- autoShutdown.enabled: boolean (default false)
- autoShutdown.dryRun: boolean (default true)
- autoShutdown.confirmBeforeShutdown: boolean (default true)
- autoShutdown.pipeName: string (default AutoShutdownService)
- autoShutdown.timeoutMs: number (default 3000)

## Installer

- WiX v4 MSI project installs and starts the service with required privileges.
- Build under windows-service/installer.

### Build MSI

- Requires WiX Toolset v4.
- Build from repo root:
  - dotnet build windows-service/installer/installer.wixproj -c Release
- MSI output will be in windows-service/installer/bin/Release/.

### Install/Start the service

- Install (UI): double-click the MSI.
- Install (silent, elevated PowerShell):
  - msiexec /i "path\to\AutoShutdownService.msi" /qn
- After install the service should be running:
  - Start: Start-Service AutoShutdownService
  - Stop: Stop-Service AutoShutdownService
  - Status: Get-Service AutoShutdownService
- Logs: Windows Event Log (when installed as service); console/log files when run directly.

### Troubleshooting

- Pipe not found (ENOENT): Ensure the service is running and listening on the configured pipe name (default AutoShutdownService). Check with Get-Service AutoShutdownService.
- Access denied on named pipe ACLs: When developing without MSI, run the service from an elevated PowerShell.
- Rebuild fails due to file lock: Stop the running dev executable: Get-Process AutoShutdownService -ErrorAction SilentlyContinue | Stop-Process -Force.
- Event Log visibility: Open Event Viewer → Windows Logs → Application, filter by source AutoShutdownService.
- Uninstall leaves service stopped but present: If MSI uninstall failed, you can remove manually: sc.exe delete AutoShutdownService (run as Administrator).

### Uninstall

- msiexec /x "path\to\AutoShutdownService.msi" /qn

## Notes

- Service requires SeShutdownPrivilege when executing SHUTDOWN. DRYRUN requires no special privileges.
- IPC uses newline-delimited one-line commands and responses.
- Server uses an async read timeout; WriteTimeout is not used (writes are flushed and drained explicitly).

# Auto Shutdown Chat (Extension)

A VS Code chat participant that, when enabled, signals a local Windows service to shut down the machine after the response finishes streaming.

Safety-first defaults: disabled by default and dry-run enabled.

## Settings

- autoShutdown.enabled: Enable shutdown trigger.
- autoShutdown.dryRun: Send DRYRUN instead of SHUTDOWN.
- autoShutdown.pipeName: Named pipe name (server must listen on \\.\pipe\<name>).
- autoShutdown.confirmBeforeShutdown: Ask for confirmation before signaling.
- autoShutdown.timeoutMs: Pipe command timeout.

## Commands

- Auto Shutdown: Toggle Enabled (auto-shutdown.toggle)

## Usage

- Type @auto-shutdown in chat and ask your question. When the response completes, the extension will signal the service per your settings.
- Toggle enable/disable via the command palette: Auto Shutdown: Toggle Enabled.
- Keep dry-run on initially (the service will respond with OK dryrun). Switch off dry-run only after full validation.

## Windows service

This extension expects a companion Windows service listening on a named pipe. See the service folder for implementation and installer.

## Disclaimer

This can power off your machine. Keep dry-run on until you’ve verified end-to-end behavior.
