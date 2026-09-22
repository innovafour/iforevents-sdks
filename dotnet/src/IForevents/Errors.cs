using System;
using System.Collections.Generic;
using System.Text.Json;

namespace IForevents
{
    /// <summary>
    /// A request failed after retries. Every api failure body is
    /// {"error": &lt;code or message&gt;, "message"?: ...}. <see cref="IForeventsAuthException"/> and
    /// <see cref="IForeventsQuotaExceededException"/> are permanent: their events are dropped.
    /// </summary>
    public class IForeventsApiException : Exception
    {
        public IForeventsApiException(string message, int status = 0, string? code = null, IReadOnlyDictionary<string, object?>? details = null, Exception? inner = null) : base(message, inner)
        {
            Status = status;
            Code = code;
            Details = details;
        }

        public int Status { get; }
        /// <summary>Stable machine-readable code from the "error" field, when the api set one.</summary>
        public string? Code { get; }
        public IReadOnlyDictionary<string, object?>? Details { get; }

        /// <summary>Transient failures (network, 5xx) are retried and their events kept.</summary>
        public virtual bool IsRetryable => Status == 0 || Status >= 500;

        internal static IForeventsApiException Classify(int status, JsonElement? body, string? retryAfterHeader)
        {
            var details = ToDictionary(body);
            string? code = details != null && details.TryGetValue("error", out var c) && c is string s ? s : null;
            var message = details != null && details.TryGetValue("message", out var m) && m != null ? m.ToString()! : code ?? $"request failed with status {status}";
            if (status == 429 && code == "quota_exceeded")
            {
                return new IForeventsQuotaExceededException(message, details, AsLong(details, "limit"), AsLong(details, "used"), details != null && details.TryGetValue("org_uuid", out var o) ? o?.ToString() : null);
            }
            if (status == 429)
            {
                double wait = 0;
                if (!string.IsNullOrWhiteSpace(retryAfterHeader) && double.TryParse(retryAfterHeader!.Trim(), System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed)) wait = parsed;
                if (wait <= 0) wait = AsLong(details, "retry_after_seconds");
                return new IForeventsRateLimitedException(message, code, details, TimeSpan.FromSeconds(wait));
            }
            if (status == 401 || status == 403) return new IForeventsAuthException(message, status, code, details);
            return new IForeventsApiException(message, status, code, details);
        }

        private static long AsLong(IReadOnlyDictionary<string, object?>? d, string key)
        {
            if (d == null || !d.TryGetValue(key, out var v) || v == null) return 0;
            return v switch
            {
                long l => l,
                int i => i,
                double dd => (long)dd,
                string s when long.TryParse(s, out var p) => p,
                _ => 0,
            };
        }

        internal static IReadOnlyDictionary<string, object?>? ToDictionary(JsonElement? element)
        {
            if (element == null || element.Value.ValueKind != JsonValueKind.Object) return null;
            var d = new Dictionary<string, object?>();
            foreach (var p in element.Value.EnumerateObject()) d[p.Name] = ToObject(p.Value);
            return d;
        }

        internal static object? ToObject(JsonElement e)
        {
            switch (e.ValueKind)
            {
                case JsonValueKind.String: return e.GetString();
                case JsonValueKind.Number: return e.TryGetInt64(out var l) ? l : e.GetDouble();
                case JsonValueKind.True: return true;
                case JsonValueKind.False: return false;
                case JsonValueKind.Object: return ToDictionary(e);
                case JsonValueKind.Array:
                    var list = new List<object?>();
                    foreach (var item in e.EnumerateArray()) list.Add(ToObject(item));
                    return list;
                default: return null;
            }
        }
    }

    /// <summary>Project key unknown, rotated or project disabled (401/403).</summary>
    public sealed class IForeventsAuthException : IForeventsApiException
    {
        public IForeventsAuthException(string message, int status, string? code, IReadOnlyDictionary<string, object?>? details) : base(message, status, code, details) { }
        public override bool IsRetryable => false;
    }

    /// <summary>Monthly plan quota exhausted (429 quota_exceeded).</summary>
    public sealed class IForeventsQuotaExceededException : IForeventsApiException
    {
        public IForeventsQuotaExceededException(string message, IReadOnlyDictionary<string, object?>? details, long limit, long used, string? organizationUuid) : base(message, 429, "quota_exceeded", details)
        {
            Limit = limit;
            Used = used;
            OrganizationUuid = organizationUuid;
        }

        public long Limit { get; }
        public long Used { get; }
        public string? OrganizationUuid { get; }
        public override bool IsRetryable => false;
    }

    /// <summary>Too many requests in a short window (429 without a quota code); retried after <see cref="RetryAfter"/>.</summary>
    public sealed class IForeventsRateLimitedException : IForeventsApiException
    {
        public IForeventsRateLimitedException(string message, string? code, IReadOnlyDictionary<string, object?>? details, TimeSpan retryAfter) : base(message, 429, code, details)
        {
            RetryAfter = retryAfter;
        }

        public TimeSpan RetryAfter { get; }
        public override bool IsRetryable => true;
    }
}
