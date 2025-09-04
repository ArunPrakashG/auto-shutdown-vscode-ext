using System.IO.Pipes;
using System.Security.AccessControl;
using System.Text;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AutoShutdownService;

public sealed class NamedPipeWorker : BackgroundService
{
    private readonly ILogger<NamedPipeWorker> _logger;
    private readonly ServiceOptions _options;

    public NamedPipeWorker(ILogger<NamedPipeWorker> logger, IOptions<ServiceOptions> options)
    {
        _logger = logger;
        _options = options.Value;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("AutoShutdownService starting. Pipe: {Pipe}", _options.PipeName);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                using var server = CreateServer(_options.PipeName);
                _logger.LogInformation("Waiting for connection...");
                await server.WaitForConnectionAsync(stoppingToken).ConfigureAwait(false);
                _logger.LogInformation("Client connected.");

                // NamedPipeServerStream does not support Read/WriteTimeout properties in async mode.
                // We'll emulate a read timeout using Task.WhenAny below.

                using var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 1024, leaveOpen: true);
                var writer = new StreamWriter(server, new UTF8Encoding(false)) { AutoFlush = true }; // no BOM

                string? line = null;
                try
                {
                    if (_options.ReadTimeoutMs > 0)
                    {
                        var readTask = reader.ReadLineAsync();
                        var completed = await Task.WhenAny(readTask, Task.Delay(_options.ReadTimeoutMs, stoppingToken)).ConfigureAwait(false);
                        if (completed == readTask)
                        {
                            line = await readTask.ConfigureAwait(false);
                        }
                        else
                        {
                            _logger.LogWarning("Read timed out after {Timeout} ms", _options.ReadTimeoutMs);
                            await writer.WriteLineAsync("ERR timeout").ConfigureAwait(false);
                        }
                    }
                    else
                    {
                        line = await reader.ReadLineAsync().ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    throw; // handled by outer loop
                }
                if (line is null)
                {
                    _logger.LogWarning("Received null/empty command.");
                    await writer.WriteLineAsync("ERR empty").ConfigureAwait(false);
                }
                else
                {
                    string cmd = line.Trim().ToUpperInvariant();
                    _logger.LogInformation("Command: {Command}", cmd);
                    switch (cmd)
                    {
                        case "PING":
                            await writer.WriteLineAsync("PONG").ConfigureAwait(false);
                            try { await writer.FlushAsync().ConfigureAwait(false); } catch { }
                            try { server.WaitForPipeDrain(); } catch { }
                            break;
                        case "DRYRUN":
                            if (_options.AllowDryRun)
                            {
                                await writer.WriteLineAsync("OK dryrun").ConfigureAwait(false);
                                try { await writer.FlushAsync().ConfigureAwait(false); } catch { }
                                try { server.WaitForPipeDrain(); } catch { }
                            }
                            else
                            {
                                await writer.WriteLineAsync("ERR dryrun-disabled").ConfigureAwait(false);
                                try { await writer.FlushAsync().ConfigureAwait(false); } catch { }
                                try { server.WaitForPipeDrain(); } catch { }
                            }
                            break;
                        case "SHUTDOWN":
                            await writer.WriteLineAsync("ACK shutdown").ConfigureAwait(false);
                            try { await writer.FlushAsync().ConfigureAwait(false); } catch { }
                            try { server.WaitForPipeDrain(); } catch { }
                            _ = Task.Run(async () =>
                            {
                                try
                                {
                                    var ok = ShutdownInvoker.TryShutdown(out string message);
                                    if (ok)
                                        _logger.LogInformation("Shutdown requested: {Message}", message);
                                    else
                                        _logger.LogError("Shutdown failed: {Message}", message);
                                }
                                catch (Exception ex)
                                {
                                    _logger.LogError(ex, "Exception during shutdown request");
                                }
                                await Task.CompletedTask;
                            });
                            break;
                        default:
                            await writer.WriteLineAsync("ERR unknown").ConfigureAwait(false);
                            try { await writer.FlushAsync().ConfigureAwait(false); } catch { }
                            try { server.WaitForPipeDrain(); } catch { }
                            break;
                    }
                }

                // disconnect to allow next client
                try { server.Disconnect(); } catch { /* ignore */ }
                // ensure writer is disposed safely
                try { writer.Dispose(); } catch { }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Server loop error");
                await Task.Delay(1000, stoppingToken);
            }
        }

        _logger.LogInformation("AutoShutdownService stopping.");
    }

    private static NamedPipeServerStream CreateServer(string pipeName)
    {
        // Prefer secure ACL, but fall back to default security if not permitted (e.g., non-elevated console)
        try
        {
            var ps = new PipeSecurity();
            ps.AddAccessRule(new PipeAccessRule("Users", PipeAccessRights.ReadWrite, AccessControlType.Allow));
            ps.AddAccessRule(new PipeAccessRule("Administrators", PipeAccessRights.FullControl, AccessControlType.Allow));

            return System.IO.Pipes.NamedPipeServerStreamAcl.Create(
                pipeName,
                PipeDirection.InOut,
                NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous,
                inBufferSize: 0,
                outBufferSize: 0,
                pipeSecurity: ps
            );
        }
        catch (UnauthorizedAccessException)
        {
            // Fallback: default security
            return new NamedPipeServerStream(
                pipeName,
                PipeDirection.InOut,
                NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous
            );
        }
    }
}
