// Real-api smoke: IFOREVENTS_PROJECT_KEY and IFOREVENTS_BASE_URL must be set.
using System.Text.Json;
using IForevents;

var key = Environment.GetEnvironmentVariable("IFOREVENTS_PROJECT_KEY") ?? "";
var baseUrl = Environment.GetEnvironmentVariable("IFOREVENTS_BASE_URL");
if (key.Length == 0) { Console.Error.WriteLine("IFOREVENTS_PROJECT_KEY missing"); return 2; }
var errors = new List<string>();
var client = await Iforevents.CreateAsync(key, c => { if (!string.IsNullOrEmpty(baseUrl)) c.BaseUrl = baseUrl!; c.BatchSize = 2; c.OnError = e => errors.Add(e.Message); });
var api = client.Integration<ApiIntegration>()!;
var identify = await client.IdentifyAsync($"smoke_dotnet_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}", new Dictionary<string, object?> { ["email"] = "smoke@example.com", ["plan"] = "free", ["nested"] = new Dictionary<string, object?> { ["deep"] = true } });
await client.TrackAsync("smoke_track", new Dictionary<string, object?> { ["n"] = 1 });
await client.PageAsync("/smoke");
await client.ShutdownAsync();
Console.WriteLine(JsonSerializer.Serialize(new { identify = identify[0].Success, user_id = api.UserId, queued = api.QueuedEvents, errors }));
return identify[0].Success && errors.Count == 0 && api.UserId != null ? 0 : 1;
