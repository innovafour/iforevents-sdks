using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Options;
using PostHog;

namespace IForevents.PostHog
{
    /// <summary>What the adapter needs from PostHog; a fake satisfies it in tests.</summary>
    public interface IPostHogSink
    {
        Task IdentifyAsync(string distinctId, Dictionary<string, object> properties, CancellationToken cancellationToken);
        void Capture(string distinctId, string eventName, DateTimeOffset timestamp, Dictionary<string, object> properties);
        void CaptureScreenView(string distinctId, string screenName, Dictionary<string, object> properties);
        Task FlushAsync();
        ValueTask DisposeAsync();
    }

    /// <summary>Adapts the real <see cref="IPostHogClient"/>.</summary>
    public sealed class PostHogSink : IPostHogSink
    {
        private readonly IPostHogClient _client;
        private readonly bool _owns;
        public PostHogSink(IPostHogClient client, bool ownsClient = false) { _client = client; _owns = ownsClient; }
        public Task IdentifyAsync(string distinctId, Dictionary<string, object> properties, CancellationToken cancellationToken) => _client.IdentifyAsync(distinctId, properties, null, cancellationToken);
        public void Capture(string distinctId, string eventName, DateTimeOffset timestamp, Dictionary<string, object> properties) => _client.Capture(distinctId, eventName, timestamp, properties);
        public void CaptureScreenView(string distinctId, string screenName, Dictionary<string, object> properties) => _client.CaptureScreenView(distinctId, screenName, properties);
        public Task FlushAsync() => _client.FlushAsync();
        public ValueTask DisposeAsync() => _owns ? _client.DisposeAsync() : default;
    }

    /// <summary>Forwards calls to PostHog through the official PostHog .NET SDK.</summary>
    public sealed class PostHogIntegration : Integration
    {
        private readonly IPostHogSink _client;
        private readonly string _anonymousId;
        private volatile string? _distinctId;

        /// <summary>Creates a PostHogClient from the project api key; configure tweaks the options (HostUrl, FlushAt, ...).</summary>
        public PostHogIntegration(string projectApiKey, Action<PostHogOptions>? configure = null, Hooks? hooks = null, string anonymousId = "server")
            : this(new PostHogSink(CreateClient(projectApiKey, configure), ownsClient: true), hooks, anonymousId) { }

        /// <summary>Reuses a client you configured (or injected through DI).</summary>
        public PostHogIntegration(IPostHogClient client, Hooks? hooks = null, string anonymousId = "server") : this(new PostHogSink(client), hooks, anonymousId) { }

        /// <summary>Takes a sink directly (fakes in tests).</summary>
        public PostHogIntegration(IPostHogSink sink, Hooks? hooks = null, string anonymousId = "server") : base("PostHogIntegration", hooks)
        {
            _client = sink;
            _anonymousId = anonymousId;
        }

        private static PostHogClient CreateClient(string projectApiKey, Action<PostHogOptions>? configure)
        {
            var options = new PostHogOptions { ProjectApiKey = projectApiKey };
            configure?.Invoke(options);
            return new PostHogClient(Options.Create(options));
        }

        private string Who => _distinctId ?? _anonymousId;

        public override async Task IdentifyAsync(IdentifyEvent evt, CancellationToken cancellationToken = default)
        {
            await base.IdentifyAsync(evt, cancellationToken).ConfigureAwait(false);
            _distinctId = evt.CustomId;
            await _client.IdentifyAsync(evt.CustomId, Scalarize(evt.Traits), cancellationToken).ConfigureAwait(false);
        }

        public override async Task TrackAsync(TrackEvent evt, CancellationToken cancellationToken = default)
        {
            await base.TrackAsync(evt, cancellationToken).ConfigureAwait(false);
            _client.Capture(Who, evt.Name, evt.Timestamp, Scalarize(evt.Properties));
        }

        public override async Task PageAsync(PageEvent evt, CancellationToken cancellationToken = default)
        {
            await base.PageAsync(evt, cancellationToken).ConfigureAwait(false);
            var props = Scalarize(evt.Properties);
            if (evt.NavigationType != null) props["navigation_type"] = evt.NavigationType;
            if (evt.ToRoute != null) props["to_route"] = evt.ToRoute;
            if (evt.PreviousRoute != null) props["previous_route"] = evt.PreviousRoute;
            _client.CaptureScreenView(Who, evt.Name, props);
        }

        public override async Task ResetAsync(CancellationToken cancellationToken = default)
        {
            await base.ResetAsync(cancellationToken).ConfigureAwait(false);
            _distinctId = null;
        }

        public override Task FlushAsync(CancellationToken cancellationToken = default) => _client.FlushAsync();

        public override async Task ShutdownAsync(CancellationToken cancellationToken = default)
        {
            await _client.FlushAsync().ConfigureAwait(false);
            await _client.DisposeAsync().ConfigureAwait(false);
        }

        private static Dictionary<string, object> Scalarize(IReadOnlyDictionary<string, object?> input)
        {
            var d = new Dictionary<string, object>();
            foreach (var p in input) if (p.Value != null) d[p.Key] = p.Value;
            return d;
        }
    }
}
