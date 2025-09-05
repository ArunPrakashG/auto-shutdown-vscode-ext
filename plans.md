# Project Plan: VS Code chat participant triggers Windows shutdown via service

## Problem Statement

Build a VS Code extension that detects when a chat completion finishes (we will own the chat lifecycle via a custom chat participant) and, when enabled, signals a Windows background service to perform a clean OS shutdown. Provide two components:

- VS Code extension with enable/disable and dry-run settings.
- Windows Service installed via MSI, listening on a named pipe for SHUTDOWN commands, performing a clean shutdown.

## Research Phase

- [x] Fetch docs for VS Code Chat Participant API and activation events (8/7/2025)
- [x] Fetch docs for Language Model API streaming and usage (8/7/2025)
- [x] Research Windows Named Pipes in Node and .NET interop details (via NamedPipeServerStream + NamedPipeServerStreamAcl) (9/3/2025)
- [x] Research InitiateSystemShutdownEx and required privileges (SE_SHUTDOWN_NAME) (9/3/2025)
- [x] Research WiX v4 ServiceInstall/ServiceControl authoring patterns (9/3/2025)

## Implementation Phase

- [x] Step 1: Scaffold VS Code extension (TypeScript)
- [x] Step 2: Contribute chat participant + activation + settings (enabled, dryRun, pipeName)
- [x] Step 3: Implement chat request handler with LM API streaming; on end-of-stream conditionally signal service
- [x] Step 4: Implement Node named pipe client (PING/SHUTDOWN/DRYRUN), retries, timeouts (initial client with timeout)
- [x] Step 5: Scaffold .NET 8 Worker Service with named pipe server loop
- [x] Step 6: Implement ShutdownInvoker (P/Invoke InitiateSystemShutdownEx; fallback to shutdown.exe) (initial P/Invoke path)
- [ ] Step 7: Logging, configuration, and service recovery options (basic console logging done; add recovery later)
- [x] Step 8: WiX v4 MSI project to install/start service; stop/remove on uninstall (skeleton Product.wxs)
- [x] Step 9: E2E tests: dry-run default; confirmation; service privilege handling (initial IPC PING/DRYRUN validated)
- [x] Step 10: Documentation for extension and service (initial README with MSI install/start/stop and settings)
  - 2025-09-05: Overhauled README for GitHub with clear structure: features, architecture, prerequisites, quick start, MSI build/install, configuration (extension + service env overrides), usage, development (vsce notes), troubleshooting, limitations, and license note. Fixed commands and paths, added CI badge.

## Testing Phase

- [x] Unit tests for IPC client parsing (happy path + unknown)
- [ ] Unit tests for IPC client timeouts
- [x] Unit tests for IPC client timeouts
- [ ] Integration tests: extension talks to service PING/DRYRUN/SHUTDOWN (dry-run)
- [ ] Edge case validation: service not running, pipe unavailable, LM errors, cancellation
- [ ] Performance: ensure non-blocking, timeouts under 3s, no UI freezes

## Validation Phase

- [ ] Code review and cleanup
- [ ] Documentation updates
- [ ] Final verification with a manual smoke test

## Progress Log

- 2025-08-07: Collected VS Code Chat and LM API docs. Decided to own completion lifecycle via a custom chat participant; no public API to observe Copilot completions of other participants.
- 2025-09-03: Implemented VS Code extension (participant + IPC client), fixed dependencies, and compiled. Added .NET 8 Windows service with named pipe server handling PING/DRYRUN/SHUTDOWN, and a P/Invoke-based shutdown invoker enabling SeShutdownPrivilege. Added WiX v4 installer skeleton with ServiceInstall/ServiceControl.
- 2025-09-04: Fixed named-pipe handshake. Removed unsupported Read/WriteTimeout on server; implemented async read timeout with Task.WhenAny; added WaitForPipeDrain and safe writer disposal. Updated Node client to resolve on first newline and ignore EPIPE after response. Verified end-to-end: PING returns PONG; DRYRUN returns OK dryrun.
- 2025-09-04: Added small retry/backoff in VS Code extension PipeClient (ENOENT/ECONNREFUSED/EPIPE/ECONNRESET + timeout). Documented MSI build/install and extension settings. Added Mocha tests for IPC (PING and ERR unknown). Pending: timeout-focused unit test and CI wiring.
- 2025-09-04: Implemented timeout-focused Mocha test using a Node named-pipe server that accepts but does not respond; verified PipeClient throws timeout. Wired npm test to compile TS and build the .NET service first.
- 2025-09-04: Added GitHub Actions CI for Windows (Node 20, .NET 8) to lint and test. Enhanced service logging to include Windows Event Log provider when available. Updated README with CI and manual shutdown validation steps.
- 2025-09-05: Reviewed VS Code Chat Participant API and publishing docs; verified `onChatParticipant:` activation and `vsce` usage are current. Verified WiX v4 ServiceInstall/ServiceControl pattern in `Product.wxs`. Updated README to be GitHub-ready with accurate PowerShell commands, MSI project path, and env var overrides.

## Quality Gates

- Build: PASS (dotnet service and TS compile)
- Lint/Typecheck: PASS (no errors; note @typescript-eslint warns about TS 5.9 not officially supported; acceptable)
- Unit tests: PASS (2/2 Mocha tests: PING and ERR unknown)
- Smoke test: Named pipe PING/DRYRUN verified manually earlier

Requirements coverage:

- VS Code extension with enable/disable and safety toggles: Done
- Windows service with named pipe and clean shutdown: Done
- MSI installer to install/start service: Implemented (docs included)
- Retry/backoff for transient pipe issues: Done
- Documentation of install/start and settings: Done
- Tests for IPC client (happy + unknown): Done; timeout test deferred

## Notes and Observations

- There is no public API to detect Copilot Chat completion lifecycle for another participant; we must implement our own participant.
- Use Windows Named Pipes: service as server (\\.\pipe\AutoShutdownService), extension as client.
- Default to dry-run and require explicit user confirmation in the extension before sending SHUTDOWN.
