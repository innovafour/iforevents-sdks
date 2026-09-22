using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Segment.Analytics;
using Segment.Serialization;

namespace IForevents.Segment
{
    /// <summary>What the adapter needs from Segment's Analytics; a fake satisfies it in tests.</summary>
    public interface ISegmentClient
    {
        void Identify(string userId, JsonObject traits);
        void Track(string name, JsonObject properties);
        void Screen(string title, JsonObject properties);
        void Reset();
        void Flush();
    }

    /// <summary>Adapts the real Analytics client.</summary>
    public sealed class SegmentClient : ISegmentClient
    {
        private readonly Analytics _analytics;
        public SegmentClient(Analytics analytics) => _analytics = analytics;
        public void Identify(string userId, JsonObject traits) => _analytics.Identify(userId, traits);
        public void Track(string name, JsonObject properties) => _analytics.Track(name, properties);
        public void Screen(string title, JsonObject properties) => _analytics.Screen(title, properties);
        public void Reset() => _analytics.Reset();
        public void Flush() => _analytics.Flush();
    }

    /// <summary>Forwards calls to Segment through Segment.Analytics.CSharp. Mirrors iforevents_segment.</summary>
    public sealed class SegmentIntegration : Integration
    {
        private readonly ISegmentClient _client;

        /// <summary>Creates the Segment client from the write key; configure tweaks the Configuration (flushAt, apiHost, ...).</summary>
        public SegmentIntegration(string writeKey, Func<string, Configuration>? configure = null, Hooks? hooks = null)
            : this(new SegmentClient(new Analytics(configure?.Invoke(writeKey) ?? new Configuration(writeKey))), hooks) { }

        /// <summary>Reuses a client you configured, or a fake in tests.</summary>
        public SegmentIntegration(ISegmentClient client, Hooks? hooks = null) : base("SegmentIntegration", hooks) => _client = client;

        public override async Task IdentifyAsync(IdentifyEvent evt, CancellationToken cancellationToken = default)
        {
            await base.IdentifyAsync(evt, cancellationToken).ConfigureAwait(false);
            _client.Identify(evt.CustomId, ToJson(evt.Traits));
        }

        public override async Task TrackAsync(TrackEvent evt, CancellationToken cancellationToken = default)
        {
            await base.TrackAsync(evt, cancellationToken).ConfigureAwait(false);
            _client.Track(evt.Name, ToJson(evt.Properties));
        }

        public override async Task PageAsync(PageEvent evt, CancellationToken cancellationToken = default)
        {
            await base.PageAsync(evt, cancellationToken).ConfigureAwait(false);
            var props = new Dictionary<string, object?>(ToMutable(evt.Properties));
            if (evt.NavigationType != null) props["navigation_type"] = evt.NavigationType;
            if (evt.ToRoute != null) props["to_route"] = evt.ToRoute;
            if (evt.PreviousRoute != null) props["previous_route"] = evt.PreviousRoute;
            _client.Screen(evt.Name, ToJson(props));
        }

        public override async Task ResetAsync(CancellationToken cancellationToken = default)
        {
            await base.ResetAsync(cancellationToken).ConfigureAwait(false);
            _client.Reset();
        }

        public override Task FlushAsync(CancellationToken cancellationToken = default)
        {
            _client.Flush();
            return Task.CompletedTask;
        }

        public override Task ShutdownAsync(CancellationToken cancellationToken = default) => FlushAsync(cancellationToken);

        private static Dictionary<string, object?> ToMutable(IReadOnlyDictionary<string, object?> d)
        {
            var m = new Dictionary<string, object?>();
            foreach (var p in d) m[p.Key] = p.Value;
            return m;
        }

        /// <summary>Segment's JsonObject only takes JsonElement values; convert the property tree.</summary>
        public static JsonObject ToJson(IEnumerable<KeyValuePair<string, object?>> properties)
        {
            var obj = new JsonObject();
            foreach (var p in properties)
            {
                var v = ToElement(p.Value);
                if (v != null) obj[p.Key] = v;
            }
            return obj;
        }

        private static JsonElement? ToElement(object? value)
        {
            switch (value)
            {
                case null: return null;
                case JsonElement e: return e;
                case string s: return s;
                case bool b: return b;
                case int i: return i;
                case long l: return l;
                case float f: return f;
                case double d: return d;
                case decimal m: return (double)m;
                case DateTime dt: return dt.ToUniversalTime().ToString("o");
                case DateTimeOffset dto: return dto.ToUniversalTime().ToString("o");
                case IEnumerable<KeyValuePair<string, object?>> dict: return ToJson(dict);
                case IEnumerable list:
                    var arr = new JsonArray();
                    foreach (var item in list) { var el = ToElement(item); if (el != null) arr.Add(el); }
                    return arr;
                default: return value.ToString();
            }
        }
    }
}
