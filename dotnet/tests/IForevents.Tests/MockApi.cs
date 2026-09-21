using System.Net;
using System.Text;
using System.Text.Json;

namespace IForevents.Tests;

/// <summary>Records every request and answers like the real api; a scenario injects faults. Plugged in as an HttpMessageHandler, so no sockets.</summary>
public sealed class MockApi : HttpMessageHandler
{
    public sealed record Recorded(string Path, Dictionary<string, string> Headers, JsonElement Body)
    {
        public string? Header(string name) => Headers.TryGetValue(name.ToLowerInvariant(), out var v) ? v : null;
        public List<string> EventNames() => Body.GetProperty("events").EnumerateArray().Select(e => e.GetProperty("name").GetString()!).ToList();
    }

    public readonly List<Recorded> Requests = new();
    public Func<Recorded, (int status, object body, Dictionary<string, string>? headers)?>? Scenario;
    public const string BaseUrl = "http://mock.iforevents.test";

    public HttpClient Client() => new HttpClient(this, disposeHandler: false);

    public List<Recorded> ByPath(string path)
    {
        lock (Requests) return Requests.Where(r => r.Path == path).ToList();
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var text = request.Content == null ? "{}" : await request.Content.ReadAsStringAsync(cancellationToken);
        var headers = new Dictionary<string, string>();
        foreach (var h in request.Headers) headers[h.Key.ToLowerInvariant()] = string.Join(",", h.Value);
        if (request.Content != null) foreach (var h in request.Content.Headers) headers[h.Key.ToLowerInvariant()] = string.Join(",", h.Value);
        var rec = new Recorded(request.RequestUri!.AbsolutePath, headers, JsonDocument.Parse(text).RootElement.Clone());
        lock (Requests) Requests.Add(rec);
        var answer = Scenario?.Invoke(rec);
        if (answer == null)
        {
            if (rec.Header("X-Project-Key") != "pk_test") answer = (401, new { error = "invalid project key" }, null);
            else answer = rec.Path switch
            {
                "/v1/events/identify" => (201, new { user = new { uuid = "11111111-1111-4111-8111-111111111111" } }, null),
                "/v1/events/track" => (201, new { status = "ok", user_uuid = "22222222-2222-4222-8222-222222222222" }, null),
                "/v1/events/batch" => (202, new { status = "queued", user_uuid = "33333333-3333-4333-8333-333333333333" }, null),
                _ => (404, new { error = "not found" }, null),
            };
        }
        var (status, body, extra) = answer.Value;
        var res = new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };
        if (extra != null) foreach (var h in extra) res.Headers.TryAddWithoutValidation(h.Key, h.Value);
        return res;
    }
}
