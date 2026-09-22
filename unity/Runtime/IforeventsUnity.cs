using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace IForevents.Unity
{
    /// <summary>
    /// The Unity entry point. Wraps the .NET <see cref="Iforevents"/> facade: calls run on the
    /// thread pool so the main thread never waits on the network, PlayerPrefs keeps the user id
    /// and the queue, device context is collected on the main thread at init, and the queue is
    /// flushed when the app pauses or quits. Not for WebGL yet (HttpClient is unavailable there).
    ///
    /// <code>
    /// IforeventsUnity.Init("pk_...", c => c.BatchSize = 20);
    /// IforeventsUnity.Track("level_completed", new Dictionary&lt;string, object&gt; { ["level"] = 3 });
    /// </code>
    /// </summary>
    public sealed class IforeventsUnity : MonoBehaviour
    {
        private static IforeventsUnity _instance;
        private Iforevents _client;
        private ApiIntegration _api;
        private Dictionary<string, object> _context;

        public static Iforevents Client => _instance?._client ?? throw new InvalidOperationException("IforeventsUnity.Init must run first");
        public static bool IsInitialized => _instance != null;

        /// <summary>Creates the singleton once; later calls return it. Call from the first scene's Awake or a bootstrap script.</summary>
        public static IforeventsUnity Init(string projectKey, Action<ApiConfig> configure = null, IEnumerable<IIntegration> integrations = null, IReadOnlyDictionary<string, object> extraContext = null)
        {
            if (_instance != null) return _instance;
            var go = new GameObject("IForevents") { hideFlags = HideFlags.HideAndDontSave };
            DontDestroyOnLoad(go);
            var runner = go.AddComponent<IforeventsUnity>();
            runner._context = UnityContext.Collect(extraContext);
            var storage = new PlayerPrefsStorage();
            // PlayerPrefs is main-thread only: read the persisted values now and let the
            // integration work on a memory copy that is written back on the main thread.
            var mirror = new MainThreadMirrorStorage(storage);
            runner._api = new ApiIntegration(projectKey, c =>
            {
                c.Storage = mirror;
                c.PersistQueue = true;
                configure?.Invoke(c);
            });
            var all = new List<IIntegration> { runner._api };
            if (integrations != null) all.AddRange(integrations);
            var ctx = runner._context;
            runner._client = new Iforevents(all, () => new Dictionary<string, object>(ctx));
            _ = runner._client.InitAsync();
            _instance = runner;
            return runner;
        }

        public static Task Identify(string customId, IReadOnlyDictionary<string, object> traits = null) => Task.Run(() => Client.IdentifyAsync(customId, Nullable(traits)));
        public static Task Track(string name, IReadOnlyDictionary<string, object> properties = null) => Task.Run(() => Client.TrackAsync(name, Nullable(properties)));
        public static Task Screen(string name, IReadOnlyDictionary<string, object> properties = null) => Task.Run(() => Client.ScreenAsync(name, Nullable(properties)));
        public static Task Reset() => Task.Run(() => Client.ResetAsync());
        public static Task Flush() => Task.Run(() => Client.FlushAsync());

        private static IReadOnlyDictionary<string, object> Nullable(IReadOnlyDictionary<string, object> d) => d;

        private void Update() => (_api?.Config.Storage as MainThreadMirrorStorage)?.Pump();

        private void OnApplicationPause(bool paused)
        {
            if (paused) _ = Flush();
        }

        private void OnApplicationQuit()
        {
            try { _client?.ShutdownAsync().Wait(TimeSpan.FromSeconds(3)); } catch (Exception) { }
            (_api?.Config.Storage as MainThreadMirrorStorage)?.Pump();
        }

        /// <summary>Memory storage that queues writes for PlayerPrefs on the main thread.</summary>
        private sealed class MainThreadMirrorStorage : IStorage
        {
            private readonly PlayerPrefsStorage _prefs;
            private readonly Dictionary<string, string> _cache = new Dictionary<string, string>();
            private readonly Queue<Action> _writes = new Queue<Action>();
            private readonly object _lock = new object();

            public MainThreadMirrorStorage(PlayerPrefsStorage prefs)
            {
                _prefs = prefs;
                foreach (var key in new[] { "iforevents_user_id", "iforevents_user_identified", "iforevents_queue" })
                {
                    var v = prefs.Get(key);
                    if (v != null) _cache[key] = v;
                }
            }

            public string Get(string key)
            {
                lock (_lock) return _cache.TryGetValue(key, out var v) ? v : null;
            }

            public void Set(string key, string value)
            {
                lock (_lock) { _cache[key] = value; _writes.Enqueue(() => _prefs.Set(key, value)); }
            }

            public void Remove(string key)
            {
                lock (_lock) { _cache.Remove(key); _writes.Enqueue(() => _prefs.Remove(key)); }
            }

            /// <summary>Applies queued writes; called from Update on the main thread.</summary>
            public void Pump()
            {
                Action[] pending;
                lock (_lock)
                {
                    if (_writes.Count == 0) return;
                    pending = _writes.ToArray();
                    _writes.Clear();
                }
                foreach (var w in pending) w();
            }
        }
    }
}
