namespace AutoShutdownService;

public sealed class ServiceOptions
{
    public string PipeName { get; set; } = "AutoShutdownService";
    public int ReadTimeoutMs { get; set; } = 5000;
    public int WriteTimeoutMs { get; set; } = 5000;
    public bool AllowDryRun { get; set; } = true;
}
