using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using Xunit;

namespace IForevents.Tests;

/// <summary>Conformance suite for sdks/CONTRACT.md section 8; each test names its item.</summary>
public sealed class ConformanceTests : IDisposable
{
    private static readonly Regex Anon = new("^anon_[0-9a-f]{32}$");
    private readonly MockApi _api = new();
    private readonly List<ApiIntegration> _active = new();

    public void Dispose()
    {
        foreach (var i in _active) i.ShutdownAsync().GetAwaiter().GetResult();
    }

    private ApiIntegration Make(Action<ApiConfig>? configure = null)
    {
        var integration = new ApiIntegration("pk_test", cfg =>
        {
            cfg.BaseUrl = MockApi.BaseUrl;
            cfg.HttpClient = _api.Client();
            cfg.RetryDelay = TimeSpan.FromMilliseconds(10);
            cfg.FlushInterval = TimeSpan.FromMilliseconds(60);
            configure?.Invoke(cfg);
        });
        _active.Add(integration);
        return integration;
    }

    private async Task<(Iforevents client, ApiIntegration api)> Boot(Action<ApiConfig>? configure = null, params IIntegration[] extra)
    {
        var api = Make(configure);
        var client = new Iforevents(new IIntegration[] { api }.Concat(extra), () => new Dictionary<string, object?> { ["device_platform"] = "test", ["sdk_name"] = "iforevents-dotnet" });
        await client.InitAsync();
        return (client, api);
    }

    private static Dictionary<string, object?> P(params (string, object?)[] pairs) => pairs.ToDictionary(p => p.Item1, p => p.Item2);

    [Fact]
    public async Task T01_IdentifyLiftsFieldsSwitchesUserId()
    {
        var (client, api) = await Boot();
        await client.IdentifyAsync("user_1", P(("email", "ada@example.com"), ("name", "Ada"), ("phone_number", "+1"), ("plan", "pro"), ("nested", P(("a", 1)))));
        var req = _api.ByPath("/v1/events/identify")[0];
        Assert.Equal("pk_test", req.Header("X-Project-Key"));
        Assert.StartsWith("application/json", req.Header("Content-Type"));
        Assert.StartsWith("iforevents-dotnet/", req.Header("User-Agent"));
        Assert.Equal("user_1", req.Header("X-User-Id"));
        Assert.Equal("user_1", req.Body.GetProperty("custom_id").GetString());
        Assert.Equal("ada@example.com", req.Body.GetProperty("email").GetString());
        Assert.Equal("Ada", req.Body.GetProperty("name").GetString());
        Assert.Equal("+1", req.Body.GetProperty("phone_number").GetString());
        var props = req.Body.GetProperty("properties");
        Assert.Equal("pro", props.GetProperty("plan").GetString());
        Assert.Equal(1, props.GetProperty("nested_a").GetInt32());
        Assert.Equal("test", props.GetProperty("device_platform").GetString());
        Assert.False(props.TryGetProperty("email", out _));
        Assert.Equal("user_1", api.UserId);
        Assert.True(api.IsIdentified);
    }

    [Fact]
    public async Task T02_TrackAfterIdentifyCarriesUserIdAndOnlyItsOwnProperties()
    {
        var (client, _) = await Boot(c => c.BatchSize = 1);
        await client.IdentifyAsync("user_1", P(("plan", "pro")));
        await client.TrackAsync("clicked", P(("button", "buy")));
        var req = _api.ByPath("/v1/events/track")[0];
        Assert.Equal("user_1", req.Header("X-User-Id"));
        Assert.Equal("clicked", req.Body.GetProperty("event_name").GetString());
        Assert.Equal("track", req.Body.GetProperty("event_type").GetString());
        var props = req.Body.GetProperty("properties");
        Assert.Equal(1, props.EnumerateObject().Count());
        Assert.Equal("buy", props.GetProperty("button").GetString());
    }

    [Fact]
    public async Task T03_BatchSizeNSendsOnNth()
    {
        var (client, _) = await Boot(c => { c.BatchSize = 3; c.FlushInterval = TimeSpan.FromSeconds(10); });
        await client.TrackAsync("a");
        await client.TrackAsync("b");
        await Task.Delay(20);
        Assert.Empty(_api.Requests);
        await client.TrackAsync("c");
        var batches = _api.ByPath("/v1/events/batch");
        Assert.Single(batches);
        Assert.Equal(new[] { "a", "b", "c" }, batches[0].EventNames());
        foreach (var e in batches[0].Body.GetProperty("events").EnumerateArray())
        {
            Assert.Equal("track", e.GetProperty("type").GetString());
            Assert.EndsWith("Z", e.GetProperty("created_at").GetString());
        }
    }

    [Fact]
    public async Task T04_FlushIntervalSendsPartialQueue()
    {
        var (client, _) = await Boot(c => { c.BatchSize = 50; c.FlushInterval = TimeSpan.FromMilliseconds(50); });
        await client.TrackAsync("only");
        Assert.Empty(_api.Requests);
        await Task.Delay(250);
        Assert.Single(_api.ByPath("/v1/events/batch"));
    }

    [Fact]
    public async Task T05_BatchSize1PostsTrack()
    {
        var (client, _) = await Boot(c => c.BatchSize = 1);
        await client.TrackAsync("solo", P(("n", 1)));
        var req = _api.ByPath("/v1/events/track")[0];
        Assert.Equal("solo", req.Body.GetProperty("event_name").GetString());
        Assert.Equal("track", req.Body.GetProperty("event_type").GetString());
    }

    [Fact]
    public async Task T06_PageViewTypeAndNavigation()
    {
        var (client, _) = await Boot(c => c.BatchSize = 1);
        await client.PageAsync("/pricing", P(("title", "Pricing")), navigationType: "push", previousRoute: "/");
        var req = _api.ByPath("/v1/events/track")[0];
        Assert.Equal("/pricing", req.Body.GetProperty("event_name").GetString());
        Assert.Equal("page_view", req.Body.GetProperty("event_type").GetString());
        var props = req.Body.GetProperty("properties");
        Assert.Equal("Pricing", props.GetProperty("title").GetString());
        Assert.Equal("push", props.GetProperty("navigation_type").GetString());
        Assert.Equal("/", props.GetProperty("previous_route").GetString());
    }

    [Fact]
    public async Task T07_AnonymousIdGeneratedPersistedReused()
    {
        var storage = new MemoryStorage();
        var (client, api) = await Boot(c => { c.BatchSize = 1; c.Storage = storage; });
        await client.TrackAsync("first");
        await client.TrackAsync("second");
        var reqs = _api.ByPath("/v1/events/track");
        var anon = reqs[0].Header("X-User-Id")!;
        Assert.Matches(Anon, anon);
        Assert.Equal(anon, reqs[1].Header("X-User-Id"));
        Assert.Equal(anon, api.UserId);
        Assert.False(api.IsIdentified);
        Assert.Equal(anon, storage.Get("iforevents_user_id"));
        Assert.Equal("false", storage.Get("iforevents_user_identified"));
        var again = Make(c => c.Storage = storage);
        await again.InitAsync();
        Assert.Equal(anon, again.UserId);
        var other = Make();
        await other.InitAsync();
        Assert.Matches(Anon, other.UserId!);
        Assert.NotEqual(anon, other.UserId);
    }

    [Fact]
    public async Task T08_ResetFlushesThenFreshAnonymousId()
    {
        var storage = new MemoryStorage();
        var (client, api) = await Boot(c => { c.BatchSize = 10; c.FlushInterval = TimeSpan.FromSeconds(10); c.Storage = storage; });
        await client.IdentifyAsync("user_1");
        await client.TrackAsync("before_logout");
        await client.ResetAsync();
        var batches = _api.ByPath("/v1/events/batch");
        Assert.Single(batches);
        Assert.Equal("user_1", batches[0].Header("X-User-Id"));
        Assert.Matches(Anon, api.UserId!);
        Assert.False(api.IsIdentified);
        Assert.Equal(api.UserId, storage.Get("iforevents_user_id"));
        Assert.Empty(client.CurrentTraits);
        await client.TrackAsync("after_logout");
        await client.FlushAsync();
        var second = _api.ByPath("/v1/events/batch")[1];
        Assert.Equal(api.UserId, second.Header("X-User-Id"));
        Assert.NotEqual("user_1", second.Header("X-User-Id"));
    }

    [Fact]
    public async Task T09_500Then200RetriesSameEventsOnce()
    {
        var failures = 0;
        _api.Scenario = req => req.Path == "/v1/events/batch" && failures++ < 1 ? (500, new { error = "boom" }, null) : null;
        var (client, _) = await Boot(c => { c.BatchSize = 2; c.MaxRetries = 2; });
        await client.TrackAsync("x");
        await client.TrackAsync("y");
        await client.FlushAsync();
        var batches = _api.ByPath("/v1/events/batch");
        Assert.Equal(2, batches.Count);
        Assert.Equal(new[] { "x", "y" }, batches[1].EventNames());
    }

    [Fact]
    public async Task T10_QuotaExceededNoRetryDropCallbackOnce()
    {
        var refuse = true;
        _api.Scenario = req => req.Path == "/v1/events/batch" && refuse ? (429, new { error = "quota_exceeded", message = "plan quota exhausted", limit = 5000000, used = 5000001, org_uuid = "org-1" }, null) : null;
        var seen = new List<IForeventsQuotaExceededException>();
        var (client, api) = await Boot(c => { c.BatchSize = 500; c.OnQuotaExceeded = e => seen.Add(e); });
        await client.TrackAsync("a");
        await client.FlushAsync();
        await client.TrackAsync("b");
        await client.FlushAsync();
        Assert.Equal(2, _api.ByPath("/v1/events/batch").Count);
        Assert.Single(seen);
        Assert.Equal((5000000L, 5000001L, "org-1"), (seen[0].Limit, seen[0].Used, seen[0].OrganizationUuid));
        Assert.True(api.IsQuotaExceeded);
        Assert.Equal(0, api.QueuedEvents);
        refuse = false;
        await client.TrackAsync("c");
        await client.FlushAsync();
        Assert.False(api.IsQuotaExceeded);
        Assert.Equal(new[] { "c" }, _api.ByPath("/v1/events/batch").Last().EventNames());
    }

    [Fact]
    public async Task T11_RateLimitRetryAfterHonored()
    {
        var limited = true;
        _api.Scenario = req =>
        {
            if (req.Path == "/v1/events/batch" && limited)
            {
                limited = false;
                return (429, new { error = "ingest_rate_limit_exceeded", retry_after_seconds = 1 }, new Dictionary<string, string> { ["Retry-After"] = "1" });
            }
            return null;
        };
        var errors = new List<IForeventsApiException>();
        var (client, _) = await Boot(c => { c.BatchSize = 500; c.OnError = e => errors.Add(e); });
        await client.TrackAsync("r");
        var sw = Stopwatch.StartNew();
        await client.FlushAsync();
        Assert.True(sw.Elapsed >= TimeSpan.FromMilliseconds(950), sw.Elapsed.ToString());
        Assert.Equal(2, _api.ByPath("/v1/events/batch").Count);
        Assert.Empty(errors);
    }

    [Fact]
    public async Task T11b_RateLimitErrorTypedWhenRetriesExhausted()
    {
        _api.Scenario = req => req.Path == "/v1/events/identify" ? (429, new { error = "ingest_rate_limit_exceeded" }, new Dictionary<string, string> { ["Retry-After"] = "0" }) : null;
        var errors = new List<IForeventsApiException>();
        var (client, _) = await Boot(c => { c.MaxRetries = 1; c.OnError = e => errors.Add(e); });
        await client.IdentifyAsync("u");
        Assert.Equal(2, _api.ByPath("/v1/events/identify").Count);
        Assert.IsType<IForeventsRateLimitedException>(errors[0]);
    }

    [Fact]
    public async Task T12_Unauthorized401NoRetryDropAuthError()
    {
        var errors = new List<IForeventsApiException>();
        var api = new ApiIntegration("pk_wrong", c => { c.BaseUrl = MockApi.BaseUrl; c.HttpClient = _api.Client(); c.BatchSize = 500; c.RetryDelay = TimeSpan.FromMilliseconds(10); c.OnError = e => errors.Add(e); });
        _active.Add(api);
        var client = new Iforevents(new[] { api });
        await client.InitAsync();
        await client.TrackAsync("a");
        await client.FlushAsync();
        Assert.Single(_api.ByPath("/v1/events/batch"));
        Assert.Equal(0, api.QueuedEvents);
        var auth = Assert.IsType<IForeventsAuthException>(errors[0]);
        Assert.Equal(401, auth.Status);
    }

    private sealed class Broken : Integration
    {
        public Broken() : base("Broken") { }
        public override async Task TrackAsync(TrackEvent evt, CancellationToken cancellationToken = default)
        {
            await base.TrackAsync(evt, cancellationToken);
            throw new InvalidOperationException("vendor down");
        }
    }

    [Fact]
    public async Task T13_ThrowingIntegrationDoesNotStopApi()
    {
        var api = Make(c => c.BatchSize = 1);
        var client = new Iforevents(new IIntegration[] { new Broken(), api });
        await client.InitAsync();
        var results = await client.TrackAsync("still_delivered");
        Assert.Equal(new[] { ("Broken", false), ("IForeventsAPIIntegration", true) }, results.Select(r => (r.Integration, r.Success)).ToArray());
        Assert.Single(_api.ByPath("/v1/events/track"));
    }

    [Fact]
    public async Task T14_NoSecretAnywhere()
    {
        var (client, _) = await Boot(c => c.BatchSize = 1);
        await client.IdentifyAsync("u", P(("plan", "pro")));
        await client.TrackAsync("t");
        await client.PageAsync("/p");
        foreach (var r in _api.Requests)
        {
            Assert.DoesNotContain("secret", r.Body.GetRawText().ToLowerInvariant());
            Assert.DoesNotContain("secret", string.Join(",", r.Headers.Keys).ToLowerInvariant());
        }
    }

    [Fact]
    public void T15_Flatten()
    {
        var flat = Flattener.Flatten(P(("a", P(("b", P(("c", 1))))), ("list", new[] { 1, 2 }), ("plain", "x")));
        Assert.Equal(1, flat["a_b_c"]);
        Assert.Equal("x", flat["plain"]);
        Assert.False(flat.ContainsKey("a"));
    }

    [Fact]
    public async Task QueuePersistsAcrossRestarts()
    {
        var storage = new MemoryStorage();
        var first = Make(c => { c.BatchSize = 100; c.FlushInterval = TimeSpan.FromSeconds(10); c.Storage = storage; c.PersistQueue = true; });
        await first.InitAsync();
        await first.TrackAsync(new TrackEvent("offline"));
        Assert.Contains("offline", storage.Get("iforevents_queue"));
        var second = Make(c => { c.BatchSize = 100; c.FlushInterval = TimeSpan.FromSeconds(10); c.Storage = storage; c.PersistQueue = true; });
        await second.InitAsync();
        Assert.Equal(1, second.QueuedEvents);
        await second.FlushAsync();
        Assert.Single(_api.ByPath("/v1/events/batch"));
        Assert.Null(storage.Get("iforevents_queue"));
    }

    [Fact]
    public async Task CallsBeforeInitIgnored()
    {
        var client = new Iforevents(new[] { Make() });
        Assert.Empty(await client.TrackAsync("early"));
        Assert.Empty(await client.IdentifyAsync("u"));
        Assert.Empty(_api.Requests);
    }

    [Fact]
    public async Task IdentifyAttributesEvenWhenProfileRequestFails()
    {
        _api.Scenario = req => req.Path == "/v1/events/identify" ? (500, new { error = "down" }, null) : null;
        var (client, api) = await Boot(c => { c.BatchSize = 1; c.MaxRetries = 0; });
        await client.IdentifyAsync("user_x");
        Assert.Equal("user_x", api.UserId);
        await client.TrackAsync("still_attributed");
        Assert.Equal("user_x", _api.ByPath("/v1/events/track")[0].Header("X-User-Id"));
    }

    [Fact]
    public async Task ThrowOnErrorSurfacesInResultsAndRecovers()
    {
        _api.Scenario = _ => (500, new { error = "down" }, null);
        var (client, api) = await Boot(c => { c.MaxRetries = 0; c.ThrowOnError = true; c.BatchSize = 500; });
        var results = await client.IdentifyAsync("u");
        Assert.False(results[0].Success);
        Assert.Contains("down", results[0].Error!.Message);
        await client.TrackAsync("x");
        await Assert.ThrowsAsync<IForeventsApiException>(() => api.FlushAsync());
        _api.Scenario = null;
        await api.FlushAsync();
        Assert.Single(_api.ByPath("/v1/events/batch").Last().EventNames());
    }

    [Fact]
    public async Task ConcurrentTracksAllDelivered()
    {
        var (client, api) = await Boot(c => { c.BatchSize = 7; c.FlushInterval = TimeSpan.FromSeconds(10); });
        var tasks = Enumerable.Range(0, 8).Select(i => Task.Run(async () =>
        {
            for (var n = 0; n < 20; n++) await client.TrackAsync("t", P(("i", i), ("n", n)));
        }));
        await Task.WhenAll(tasks);
        await client.FlushAsync();
        var total = _api.ByPath("/v1/events/batch").Sum(b => b.EventNames().Count);
        Assert.Equal(160, total);
        Assert.Equal(0, api.QueuedEvents);
    }

    [Fact]
    public void DefaultContextHasContractKeys()
    {
        var ctx = Context.Default(P(("app", "demo")));
        foreach (var key in new[] { "sdk_name", "sdk_version", "runtime", "device_platform", "device_brand", "device_model", "device_os_version", "device_app_version" }) Assert.True(ctx.ContainsKey(key), key);
        Assert.Equal("demo", ctx["app"]);
    }
}
