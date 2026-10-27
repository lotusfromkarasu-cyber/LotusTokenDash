using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using AgentSpeed.Core;
using AgentSpeed.Core.Pricing;

// The bridge writes only measurements and project names, never conversation text.
var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
json.Converters.Add(new JsonStringEnumConverter());
var outputGate = new object();
void Send(object value)
{
    lock (outputGate)
    {
        Console.WriteLine(JsonSerializer.Serialize(value, json));
        Console.Out.Flush();
    }
}

string Id(string path) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(path)))[..16];
var pricing = new PriceBook();
var configuration = Environment.GetEnvironmentVariable("LOTUS_SPEED_TEST_CODEX_ONLY") == "1"
    ? new MonitorConfiguration(new HashSet<SourceKind> { SourceKind.Codex })
    : MonitorConfiguration.Default;
var liveHub = new SpeedHub();
var historyHub = new HistoryHub();
var historyFile = Path.Combine(Environment.GetEnvironmentVariable("LOTUS_DATA_DIR") ?? Path.GetTempPath(), "speed-history.sqlite");
using var history = new HistoryService(historyHub, configuration, historyFile, pricing);
using var monitor = new LiveMonitor(liveHub, configuration, pricing);
liveHub.SnapshotChanged += (_, s) =>
{
    history.ObserveLive(s);
    Send(new
    {
        kind = "snapshot", timestamp = s.Timestamp, state = s.State.Kind,
        live = s.Live.Output, estimatedShare = s.LiveEstimatedShare,
        peak = s.PeakToday.Output, average = s.AverageToday,
        today = s.Today, generating = s.GeneratingCount, tools = s.ToolsCount,
        sources = s.Sources.Select(x => new { name = x.Kind, x.Available, sessions = x.SessionCount,
            live = x.Live.Output, x.Today, agents = x.ActiveAgents }),
        agents = s.Agents.Select(x => new { id = Id(x.Id), source = x.Source, x.Project, x.Model,
            phase = x.Phase, x.IsSubagent, live = x.Live.Output, x.RecentSpeed, x.LastActivity }),
        chart = s.History.Select(x => new { time = x.Time, measured = x.Measured.Output, estimated = x.Estimated.Output }),
    });
};
historyHub.Changed += (_, _) => Send(new
{
    kind = "history", state = historyHub.State.Kind, historyHub.State.Progress, historyHub.State.Error,
    days = historyHub.Days.Select(day => new { day.Day, source = day.Source, day.Totals,
        day.AverageSpeed, day.Peak, day.Agents, day.Unfinalized,
        models = day.Models.Select(model => new { model.Model, model.Requests, model.Output, model.AverageSpeed,
            model.MeasuredOutput, model.MeasuredMs }) })
});
monitor.Start();
var historyStarted = false;
while (await Console.In.ReadLineAsync() is { } command)
{
    if (command == "history")
    {
        if (!historyStarted) { history.Start(); historyStarted = true; }
        else historyHub.Refresh();
    }
}
