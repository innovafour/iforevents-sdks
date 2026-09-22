using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace IForevents
{
    /// <summary>
    /// Talks to the IForevents ingest api: identify, single or batched track, page views,
    /// a client-owned user id in X-User-Id, retries with Retry-After and typed errors.
    /// Thread-safe. Mirrors IForeventsAPIIntegration of the Flutter package.
    /// </summary>
    public sealed class ApiIntegration : Integration, IDisposable
    {
        private const string UserKey = "iforevents_user_id";
        private const string IdentifiedKey = "iforevents_user_identified";
        private const string QueueKey = "iforevents_queue";
        private const int MaxBatch = 500;
        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = null };

        public ApiConfig Config { get; }
        private readonly HttpClient _http;
        private readonly bool _ownsHttp;
        private readonly string _baseUrl;
        private readonly string _userAgent;
        private readonly object _lock = new object();
        private readonly SemaphoreSlim _sendLock = new SemaphoreSlim(1, 1);
        private readonly List<Dictionary<string, object?>> _queue = new List<Dictionary<string, object?>>();
        private Timer? _timer;
        private volatile string? _userId;
        private volatile bool _initialized;
        private volatile bool _identified;
        private volatile bool _quotaExceeded;

        public ApiIntegration(ApiConfig config) : base("IForeventsAPIIntegration", config.Hooks)
        {
            config.BatchSize = Math.Max(1, Math.Min(MaxBatch, config.BatchSize));
            Config = config;
            _baseUrl = config.BaseUrl.TrimEnd('/');
            _userAgent = config.UserAgent ?? $"{Context.SdkName}/{Context.SdkVersion} dotnet ({System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription})";
            _ownsHttp = config.HttpClient == null;
            _http = config.HttpClient ?? new HttpClient();
            _http.Timeout = config.Timeout;
        }

        public ApiIntegration(string projectKey, Action<ApiConfig>? configure = null) : this(Build(projectKey, configure)) { }

        private static ApiConfig Build(string projectKey, Action<ApiConfig>? configure)
        {
            var cfg = new ApiConfig(projectKey);
            configure?.Invoke(cfg);
            return cfg;
        }

        // --- state -------------------------------------------------------------------

        public bool IsInitialized => _initialized;
        public bool IsIdentified => _identified;
        /// <summary>The id every request carries in X-User-Id: a generated anon_... id kept per visitor, or the customId of the last identify.</summary>
        public string? UserId => _userId;
        /// <summary>True after a quota_exceeded answer until the next accepted request.</summary>
        public bool IsQuotaExceeded => _quotaExceeded;

        public int QueuedEvents
        {
            get { lock (_lock) return _queue.Count; }
        }

        /// <summary>A fresh anonymous id, unrelated to anything the server derives: anon_&lt;uuid4 without dashes&gt;.</summary>
        public static string AnonymousId()
        {
            var b = new byte[16];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(b);
            b[6] = (byte)((b[6] & 0x0f) | 0x40);
            b[8] = (byte)((b[8] & 0x3f) | 0x80);
            var sb = new StringBuilder("anon_", 37);
            foreach (var x in b) sb.Append(x.ToString("x2"));
            return sb.ToString();
        }

        // --- Integration --------------------------------------------------------------

        public override async Task InitAsync(CancellationToken cancellationToken = default)
        {
            await base.InitAsync(cancellationToken).ConfigureAwait(false);
            lock (_lock)
            {
                var stored = Config.Storage.Get(UserKey);
                if (!string.IsNullOrEmpty(stored))
                {
                    _userId = stored;
                    _identified = Config.Storage.Get(IdentifiedKey) == "true";
                }
                else
                {
                    // A fresh visitor: attribute everything to an anonymous id we own, so the
                    // api never has to fingerprint the address (which merges users behind a NAT).
                    SetUserLocked(AnonymousId(), false);
                }
                if (Config.PersistQueue)
                {
                    var raw = Config.Storage.Get(QueueKey);
                    if (!string.IsNullOrEmpty(raw))
                    {
                        List<Dictionary<string, object?>>? events = null;
                        try
                        {
                            using var doc = JsonDocument.Parse(raw!);
                            if (doc.RootElement.ValueKind == JsonValueKind.Array)
                            {
                                events = doc.RootElement.EnumerateArray().Select(e => (Dictionary<string, object?>)ToMutable(IForeventsApiException.ToDictionary(e))).ToList();
                            }
                        }
                        catch (JsonException) { }
                        if (events != null && events.Count > 0)
                        {
                            _queue.InsertRange(0, events);
                            TrimLocked();
                            ScheduleLocked();
                        }
                        else Config.Storage.Remove(QueueKey);
                    }
                }
                _initialized = true;
            }
            Log($"api integration ready base_url={_baseUrl} batch_size={Config.BatchSize}");
        }

        private static Dictionary<string, object?> ToMutable(IReadOnlyDictionary<string, object?>? d) => d == null ? new Dictionary<string, object?>() : d.ToDictionary(p => p.Key, p => p.Value);

        public override async Task IdentifyAsync(IdentifyEvent evt, CancellationToken cancellationToken = default)
        {
            await base.IdentifyAsync(evt, cancellationToken).ConfigureAwait(false);
            var properties = evt.Traits.ToDictionary(p => p.Key, p => p.Value);
            var body = new Dictionary<string, object?> { ["custom_id"] = evt.CustomId };
            foreach (var key in new[] { "email", "name", "phone_number" })
            {
                if (properties.TryGetValue(key, out var v) && v is string s && s.Length > 0)
                {
                    body[key] = s;
                    properties.Remove(key);
                }
            }
            body["properties"] = properties;
            // Attribute from now on, even if the profile request itself fails: the
            // api creates the profile on the first event it sees for this id.
            SetUser(evt.CustomId, true);
            try
            {
                await RequestAsync("/v1/events/identify", body, cancellationToken).ConfigureAwait(false);
            }
            catch (IForeventsApiException e)
            {
                Report(e);
                if (Config.ThrowOnError) throw;
            }
        }

        public override async Task TrackAsync(TrackEvent evt, CancellationToken cancellationToken = default)
        {
            await base.TrackAsync(evt, cancellationToken).ConfigureAwait(false);
            if (Config.BatchSize <= 1)
            {
                try
                {
                    await RequestAsync("/v1/events/track", new Dictionary<string, object?> { ["event_name"] = evt.Name, ["event_type"] = evt.Type, ["properties"] = evt.Properties }, cancellationToken).ConfigureAwait(false);
                }
                catch (IForeventsApiException e)
                {
                    Report(e);
                    if (Config.ThrowOnError) throw;
                }
                return;
            }
            var queued = new Dictionary<string, object?>
            {
                ["name"] = evt.Name,
                ["type"] = evt.Type,
                ["properties"] = evt.Properties,
                ["created_at"] = evt.Timestamp.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture),
            };
            bool full;
            lock (_lock)
            {
                _queue.Add(queued);
                TrimLocked();
                full = _queue.Count >= Config.BatchSize;
                PersistLocked();
                if (!full) ScheduleLocked();
            }
            if (full) await FlushAsync(cancellationToken).ConfigureAwait(false);
        }

        public override Task PageAsync(PageEvent evt, CancellationToken cancellationToken = default)
        {
            HooksConfig.OnPage?.Invoke(evt);
            var props = evt.Properties.ToDictionary(p => p.Key, p => p.Value);
            if (evt.NavigationType != null) props["navigation_type"] = evt.NavigationType;
            if (evt.ToRoute != null) props["to_route"] = evt.ToRoute;
            if (evt.PreviousRoute != null) props["previous_route"] = evt.PreviousRoute;
            return TrackAsync(new TrackEvent(evt.Name, props, EventTypes.PageView, evt.Timestamp), cancellationToken);
        }

        public override async Task ResetAsync(CancellationToken cancellationToken = default)
        {
            await base.ResetAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                await FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                // Forget the person; the next events belong to a fresh anonymous id.
                SetUser(AnonymousId(), false);
            }
        }

        /// <summary>Sends the whole queue now, 500 events per request.</summary>
        public override async Task FlushAsync(CancellationToken cancellationToken = default)
        {
            CancelTimer();
            await _sendLock.WaitAsync(cancellationToken).ConfigureAwait(false);
            try
            {
                while (true)
                {
                    List<Dictionary<string, object?>> events;
                    lock (_lock)
                    {
                        if (_queue.Count == 0) return;
                        var n = Math.Min(MaxBatch, _queue.Count);
                        events = _queue.GetRange(0, n);
                        _queue.RemoveRange(0, n);
                    }
                    try
                    {
                        await RequestAsync("/v1/events/batch", new Dictionary<string, object?> { ["events"] = events }, cancellationToken).ConfigureAwait(false);
                        lock (_lock) PersistLocked();
                    }
                    catch (IForeventsApiException e)
                    {
                        lock (_lock)
                        {
                            if (e.IsRetryable && Config.RequeueFailedEvents)
                            {
                                // Transient: keep these events at the front for the next flush.
                                _queue.InsertRange(0, events);
                                ScheduleLocked();
                            }
                            else if (!e.IsRetryable)
                            {
                                // A refused key or an exhausted quota fails the same way forever: drop everything.
                                _queue.Clear();
                            }
                            PersistLocked();
                        }
                        Report(e);
                        if (Config.ThrowOnError) throw;
                        return;
                    }
                }
            }
            finally
            {
                _sendLock.Release();
            }
        }

        public override async Task ShutdownAsync(CancellationToken cancellationToken = default)
        {
            try
            {
                await FlushAsync(cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                CancelTimer();
            }
        }

        public void Dispose()
        {
            CancelTimer();
            if (_ownsHttp) _http.Dispose();
            _sendLock.Dispose();
        }

        // --- internals ------------------------------------------------------------------

        private void TrimLocked()
        {
            var over = _queue.Count - Config.MaxQueueSize;
            if (over > 0) _queue.RemoveRange(0, over);
        }

        private void ScheduleLocked()
        {
            if (_timer != null || _queue.Count == 0) return;
            _timer = new Timer(_ =>
            {
                lock (_lock) { _timer?.Dispose(); _timer = null; }
                _ = FlushAsync().ContinueWith(t => Log("timer flush failed: " + t.Exception?.GetBaseException().Message), TaskContinuationOptions.OnlyOnFaulted);
            }, null, Config.FlushInterval, Timeout.InfiniteTimeSpan);
        }

        private void CancelTimer()
        {
            lock (_lock)
            {
                _timer?.Dispose();
                _timer = null;
            }
        }

        private void PersistLocked()
        {
            if (!Config.PersistQueue) return;
            if (_queue.Count == 0) Config.Storage.Remove(QueueKey);
            else Config.Storage.Set(QueueKey, JsonSerializer.Serialize(_queue, JsonOptions));
        }

        private void SetUser(string id, bool identified)
        {
            lock (_lock) SetUserLocked(id, identified);
        }

        private void SetUserLocked(string id, bool identified)
        {
            _userId = id;
            _identified = identified;
            Config.Storage.Set(UserKey, id);
            Config.Storage.Set(IdentifiedKey, identified ? "true" : "false");
        }

        private void Report(IForeventsApiException e)
        {
            Log("request failed: " + e.Message);
            Config.OnError?.Invoke(e);
        }

        private void NoteOutcome(IForeventsApiException? e)
        {
            if (e is IForeventsQuotaExceededException q)
            {
                if (!_quotaExceeded)
                {
                    _quotaExceeded = true;
                    Config.OnQuotaExceeded?.Invoke(q);
                }
            }
            else if (e == null) _quotaExceeded = false;
        }

        private void Log(string message)
        {
            if (Config.Debug) (Config.Logger ?? Console.Error.WriteLine)("[iforevents] " + message);
        }

        /// <summary>POSTs JSON with retries; returns the decoded body.</summary>
        private async Task<JsonElement?> RequestAsync(string path, object body, CancellationToken cancellationToken)
        {
            var payload = JsonSerializer.Serialize(body, JsonOptions);
            var uid = _userId;
            for (var attempt = 0; ; attempt++)
            {
                IForeventsApiException error;
                try
                {
                    var (status, text, retryAfter) = await OnceAsync(path, payload, uid, cancellationToken).ConfigureAwait(false);
                    JsonElement? json = null;
                    if (!string.IsNullOrEmpty(text))
                    {
                        try { json = JsonDocument.Parse(text).RootElement.Clone(); } catch (JsonException) { }
                    }
                    Log($"POST {path} -> {status}");
                    if (status >= 200 && status < 300)
                    {
                        NoteOutcome(null);
                        return json;
                    }
                    error = IForeventsApiException.Classify(status, json, retryAfter);
                }
                catch (HttpRequestException e)
                {
                    error = new IForeventsApiException(e.Message, 0, null, null, e);
                }
                catch (TaskCanceledException e) when (!cancellationToken.IsCancellationRequested)
                {
                    error = new IForeventsApiException("timeout", 0, null, null, e);
                }
                if (!error.IsRetryable || attempt >= Config.MaxRetries)
                {
                    NoteOutcome(error);
                    throw error;
                }
                var delay = TimeSpan.FromTicks(Config.RetryDelay.Ticks * (attempt + 1));
                if (error is IForeventsRateLimitedException rl && rl.RetryAfter > TimeSpan.Zero) delay = rl.RetryAfter;
                Log($"retrying {path} in {delay.TotalMilliseconds}ms ({attempt + 1}/{Config.MaxRetries})");
                await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
            }
        }

        private async Task<(int status, string text, string? retryAfter)> OnceAsync(string path, string payload, string? uid, CancellationToken cancellationToken)
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, _baseUrl + path);
            req.Content = new StringContent(payload, Encoding.UTF8, "application/json");
            req.Headers.TryAddWithoutValidation("X-Project-Key", Config.ProjectKey);
            req.Headers.TryAddWithoutValidation("User-Agent", _userAgent);
            if (!string.IsNullOrEmpty(uid)) req.Headers.TryAddWithoutValidation("X-User-Id", uid);
            using var res = await _http.SendAsync(req, cancellationToken).ConfigureAwait(false);
            var text = res.Content == null ? "" : await res.Content.ReadAsStringAsync().ConfigureAwait(false);
            string? retryAfter = null;
            if (res.Headers.TryGetValues("Retry-After", out var values)) retryAfter = values.FirstOrDefault();
            return ((int)res.StatusCode, text, retryAfter);
        }
    }
}
