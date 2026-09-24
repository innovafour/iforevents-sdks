using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace IForevents
{
    /// <summary>
    /// The facade: one InitAsync, then Identify/Track/Page/Reset/Flush/Shutdown fan out to every
    /// integration in isolation. Identify traits go to every integration once, on identify, and
    /// are not copied into later events (each backend keeps them on the profile); nested
    /// dictionaries are flattened with "_". Mirrors the Flutter Iforevents class.
    /// </summary>
    public sealed class Iforevents : IDisposable
    {
        private readonly List<IIntegration> _integrations;
        private readonly Func<IReadOnlyDictionary<string, object?>> _context;
        private readonly bool _debug;
        private readonly Action<IReadOnlyList<IntegrationResult>>? _onResult;
        private readonly object _lock = new object();
        private IReadOnlyDictionary<string, object?> _traits = new Dictionary<string, object?>();
        private volatile bool _initialized;

        public Iforevents(IEnumerable<IIntegration>? integrations = null, Func<IReadOnlyDictionary<string, object?>>? context = null, bool debug = false, Action<IReadOnlyList<IntegrationResult>>? onResult = null)
        {
            _integrations = integrations?.ToList() ?? new List<IIntegration>();
            _context = context ?? (() => Context.Default());
            _debug = debug;
            _onResult = onResult;
        }

        /// <summary>Builds and initializes a client with the API integration and optional adapters.</summary>
        public static async Task<Iforevents> CreateAsync(string projectKey, Action<ApiConfig>? configure = null, IEnumerable<IIntegration>? integrations = null, CancellationToken cancellationToken = default)
        {
            var api = new ApiIntegration(projectKey, configure);
            var client = new Iforevents(new IIntegration[] { api }.Concat(integrations ?? Array.Empty<IIntegration>()));
            await client.InitAsync(cancellationToken).ConfigureAwait(false);
            return client;
        }

        public bool IsInitialized => _initialized;

        public IReadOnlyDictionary<string, object?> CurrentTraits
        {
            get { lock (_lock) return new Dictionary<string, object?>(_traits.ToDictionary(p => p.Key, p => p.Value)); }
        }

        public void AddIntegration(IIntegration integration)
        {
            lock (_lock) _integrations.Add(integration);
        }

        public IIntegration? Integration(string name)
        {
            lock (_lock) return _integrations.FirstOrDefault(i => i.Name == name);
        }

        public T? Integration<T>() where T : class, IIntegration
        {
            lock (_lock) return _integrations.OfType<T>().FirstOrDefault();
        }

        /// <summary>Initializes every integration. Failures are reported, never thrown.</summary>
        public async Task<IReadOnlyList<IntegrationResult>> InitAsync(CancellationToken cancellationToken = default)
        {
            var results = await FanOutAsync(i => i.InitAsync(cancellationToken)).ConfigureAwait(false);
            _initialized = true;
            return results;
        }

        public async Task<IReadOnlyList<IntegrationResult>> IdentifyAsync(string customId, IReadOnlyDictionary<string, object?>? traits = null, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrEmpty(customId) || !Ready("Identify")) return Array.Empty<IntegrationResult>();
            var merged = SafeContext().ToDictionary(p => p.Key, p => p.Value);
            if (traits != null) foreach (var p in traits) merged[p.Key] = p.Value;
            var flat = Flattener.Flatten(merged);
            var evt = new IdentifyEvent(customId, flat);
            var results = await FanOutAsync(i => i.IdentifyAsync(evt, cancellationToken)).ConfigureAwait(false);
            lock (_lock) _traits = flat;
            return results;
        }

        public Task<IReadOnlyList<IntegrationResult>> TrackAsync(string name, IReadOnlyDictionary<string, object?>? properties = null, CancellationToken cancellationToken = default)
        {
            if (string.IsNullOrEmpty(name) || !Ready("Track")) return Task.FromResult<IReadOnlyList<IntegrationResult>>(Array.Empty<IntegrationResult>());
            var own = new Dictionary<string, object?>();
            if (properties != null) foreach (var p in properties) own[p.Key] = p.Value;
            var evt = new TrackEvent(name, Flattener.Flatten(own));
            return FanOutAsync(i => i.TrackAsync(evt, cancellationToken));
        }

        public Task<IReadOnlyList<IntegrationResult>> PageAsync(string? name = null, IReadOnlyDictionary<string, object?>? properties = null, string? navigationType = null, string? toRoute = null, string? previousRoute = null, CancellationToken cancellationToken = default)
        {
            if (!Ready("Page")) return Task.FromResult<IReadOnlyList<IntegrationResult>>(Array.Empty<IntegrationResult>());
            var evt = new PageEvent(name, Flattener.Flatten(properties), navigationType, toRoute, previousRoute);
            return FanOutAsync(i => i.PageAsync(evt, cancellationToken));
        }

        /// <summary>PageAsync with mobile naming.</summary>
        public Task<IReadOnlyList<IntegrationResult>> ScreenAsync(string name, IReadOnlyDictionary<string, object?>? properties = null, CancellationToken cancellationToken = default) => PageAsync(name, properties, cancellationToken: cancellationToken);

        /// <summary>Forgets the user in every integration (logout).</summary>
        public async Task<IReadOnlyList<IntegrationResult>> ResetAsync(CancellationToken cancellationToken = default)
        {
            if (!Ready("Reset")) return Array.Empty<IntegrationResult>();
            var results = await FanOutAsync(i => i.ResetAsync(cancellationToken)).ConfigureAwait(false);
            lock (_lock) _traits = new Dictionary<string, object?>();
            return results;
        }

        public Task<IReadOnlyList<IntegrationResult>> FlushAsync(CancellationToken cancellationToken = default) => FanOutAsync(i => i.FlushAsync(cancellationToken));

        /// <summary>Flushes and releases every integration; the instance is no longer usable.</summary>
        public async Task<IReadOnlyList<IntegrationResult>> ShutdownAsync(CancellationToken cancellationToken = default)
        {
            var results = await FanOutAsync(i => i.ShutdownAsync(cancellationToken)).ConfigureAwait(false);
            _initialized = false;
            return results;
        }

        public void Dispose()
        {
            ShutdownAsync().GetAwaiter().GetResult();
            foreach (var i in _integrations.OfType<IDisposable>()) i.Dispose();
        }

        private bool Ready(string method)
        {
            if (_initialized) return true;
            if (_debug) Console.Error.WriteLine($"[iforevents] {method} called before InitAsync; ignored");
            return false;
        }

        private IReadOnlyDictionary<string, object?> SafeContext()
        {
            try { return _context() ?? new Dictionary<string, object?>(); }
            catch (Exception e)
            {
                if (_debug) Console.Error.WriteLine("[iforevents] context provider failed: " + e.Message);
                return new Dictionary<string, object?>();
            }
        }

        private async Task<IReadOnlyList<IntegrationResult>> FanOutAsync(Func<IIntegration, Task> action)
        {
            List<IIntegration> snapshot;
            lock (_lock) snapshot = _integrations.ToList();
            var results = new List<IntegrationResult>(snapshot.Count);
            foreach (var integration in snapshot)
            {
                var r = await IForevents.Integration.SafeExecuteAsync(integration, () => action(integration)).ConfigureAwait(false);
                if (!r.Success && _debug) Console.Error.WriteLine($"[iforevents] {r.Integration} failed: {r.Error?.Message}");
                results.Add(r);
            }
            _onResult?.Invoke(results);
            return results;
        }
    }
}
