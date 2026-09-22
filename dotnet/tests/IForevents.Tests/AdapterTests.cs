using IForevents.PostHog;
using IForevents.Segment;
using Segment.Serialization;
using Xunit;

namespace IForevents.Tests;

public sealed class SegmentAdapterTests
{
    private sealed class Fake : ISegmentClient
    {
        public readonly List<(string method, string name, JsonObject? props)> Calls = new();
        public void Identify(string userId, JsonObject traits) => Calls.Add(("identify", userId, traits));
        public void Track(string name, JsonObject properties) => Calls.Add(("track", name, properties));
        public void Screen(string title, JsonObject properties) => Calls.Add(("screen", title, properties));
        public void Reset() => Calls.Add(("reset", "", null));
        public void Flush() => Calls.Add(("flush", "", null));
    }

    [Fact]
    public async Task ForwardsIdentifyTrackScreenReset()
    {
        var fake = new Fake();
        var client = new Iforevents(new[] { new SegmentIntegration(fake) }, () => new Dictionary<string, object?>());
        await client.InitAsync();
        await client.IdentifyAsync("u", new Dictionary<string, object?> { ["plan"] = "pro", ["nested"] = new Dictionary<string, object?> { ["x"] = 1 }, ["nil"] = null });
        await client.TrackAsync("buy", new Dictionary<string, object?> { ["total"] = 9.5 });
        await client.PageAsync("Home", navigationType: "load");
        await client.ResetAsync();
        await client.ShutdownAsync();
        Assert.Equal(new[] { "identify", "track", "screen", "reset", "flush" }, fake.Calls.Select(c => c.method).ToArray());
        Assert.Equal("u", fake.Calls[0].name);
        Assert.Equal("pro", fake.Calls[0].props!["plan"].ToString().Trim('"'));
        Assert.True(fake.Calls[0].props!.ContainsKey("nested_x"));
        Assert.False(fake.Calls[0].props!.ContainsKey("nil"));
        Assert.Equal("buy", fake.Calls[1].name);
        Assert.Equal("Home", fake.Calls[2].name);
        Assert.True(fake.Calls[2].props!.ContainsKey("navigation_type"));
    }

    [Fact]
    public void RealClientConstructs()
    {
        var integration = new SegmentIntegration("wk", key => new global::Segment.Analytics.Configuration(key, flushAt: 1000, flushInterval: 100000));
        Assert.Equal("SegmentIntegration", integration.Name);
    }
}

public sealed class PostHogAdapterTests
{
    private sealed class Fake : IPostHogSink
    {
        public readonly List<string> Calls = new();
        public string? LastDistinctId;
        public Dictionary<string, object>? LastProps;
        public Task IdentifyAsync(string distinctId, Dictionary<string, object> properties, CancellationToken cancellationToken)
        { Calls.Add("identify:" + distinctId); LastDistinctId = distinctId; LastProps = properties; return Task.CompletedTask; }
        public void Capture(string distinctId, string eventName, DateTimeOffset timestamp, Dictionary<string, object> properties)
        { Calls.Add("capture:" + eventName); LastDistinctId = distinctId; LastProps = properties; }
        public void CaptureScreenView(string distinctId, string screenName, Dictionary<string, object> properties)
        { Calls.Add("screen:" + screenName); LastDistinctId = distinctId; LastProps = properties; }
        public Task FlushAsync() { Calls.Add("flush"); return Task.CompletedTask; }
        public ValueTask DisposeAsync() { Calls.Add("dispose"); return default; }
    }

    [Fact]
    public async Task ForwardsWithDistinctIdSwitch()
    {
        var fake = new Fake();
        var client = new Iforevents(new[] { new PostHogIntegration(fake) }, () => new Dictionary<string, object?>());
        await client.InitAsync();
        await client.TrackAsync("anon");
        Assert.Equal("server", fake.LastDistinctId);
        await client.IdentifyAsync("u", new Dictionary<string, object?> { ["plan"] = "pro" });
        Assert.Equal("pro", fake.LastProps!["plan"]);
        await client.TrackAsync("paid");
        Assert.Equal("u", fake.LastDistinctId);
        await client.PageAsync("Home", navigationType: "load");
        Assert.Equal("load", fake.LastProps!["navigation_type"]);
        await client.ResetAsync();
        await client.TrackAsync("again");
        Assert.Equal("server", fake.LastDistinctId);
        await client.ShutdownAsync();
        Assert.Equal(new[] { "capture:anon", "identify:u", "capture:paid", "screen:Home", "capture:again", "flush", "dispose" }, fake.Calls.ToArray());
    }

    [Fact]
    public async Task RealClientConstructs()
    {
        var integration = new PostHogIntegration("phc_test", o => { o.HostUrl = new Uri("https://eu.i.posthog.com"); o.FlushAt = 1000; });
        Assert.Equal("PostHogIntegration", integration.Name);
        await integration.ShutdownAsync();
    }
}
