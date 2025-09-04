using AutoShutdownService;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

// Configurable settings with defaults
builder.Configuration.AddEnvironmentVariables(prefix: "AUTOSHUTDOWN_");

builder.Services.Configure<ServiceOptions>(builder.Configuration.GetSection("Service"));
builder.Services.AddHostedService<NamedPipeWorker>();

builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o =>
{
    o.SingleLine = true;
    o.TimestampFormat = "HH:mm:ss ";
});
// Also log to Windows Event Log when running as a Windows Service
try
{
    builder.Logging.AddEventLog(settings =>
    {
        settings.SourceName = "AutoShutdownService";
        settings.LogName = "Application";
    });
}
catch
{
    // EventLog may not be available in some environments (e.g., non-admin dev run). Ignore failures.
}

var host = builder.Build();
await host.RunAsync();
