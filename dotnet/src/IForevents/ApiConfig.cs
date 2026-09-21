using System;
using System.Net.Http;

namespace IForevents
{
    /// <summary>
    /// Configuration of the first-party API integration.
    /// Only <see cref="ProjectKey"/> is required. It is a public write key: it grants event
    /// ingestion and nothing else. There is deliberately no project secret here.
    /// </summary>
    public sealed class ApiConfig
    {
        public ApiConfig(string projectKey)
        {
            if (string.IsNullOrWhiteSpace(projectKey)) throw new ArgumentException("ApiConfig needs a projectKey", nameof(projectKey));
            ProjectKey = projectKey;
        }

        public string ProjectKey { get; }
        public string BaseUrl { get; set; } = "https://api.iforevents.com";
        /// <summary>Events per request (1..500); 1 disables batching.</summary>
        public int BatchSize { get; set; } = 10;
        /// <summary>How long a partial batch waits.</summary>
        public TimeSpan FlushInterval { get; set; } = TimeSpan.FromSeconds(5);
        public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(10);
        public int MaxRetries { get; set; } = 3;
        public TimeSpan RetryDelay { get; set; } = TimeSpan.FromSeconds(1);
        public bool RequeueFailedEvents { get; set; } = true;
        public bool Debug { get; set; }
        /// <summary>Throw from Identify/Flush/Reset instead of only reporting through <see cref="OnError"/>.</summary>
        public bool ThrowOnError { get; set; }
        public Action<IForeventsQuotaExceededException>? OnQuotaExceeded { get; set; }
        public Action<IForeventsApiException>? OnError { get; set; }
        public IStorage Storage { get; set; } = new MemoryStorage();
        /// <summary>Store the pending queue in <see cref="Storage"/> so unsent events survive a restart.</summary>
        public bool PersistQueue { get; set; }
        public int MaxQueueSize { get; set; } = 1000;
        public string? UserAgent { get; set; }
        /// <summary>Custom HttpClient (tests inject a fake handler through it).</summary>
        public HttpClient? HttpClient { get; set; }
        public Action<string>? Logger { get; set; }
        public Hooks Hooks { get; set; } = new Hooks();
    }
}
