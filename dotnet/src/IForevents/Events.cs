using System;
using System.Collections.Generic;

namespace IForevents
{
    /// <summary>Event types the api distinguishes.</summary>
    public static class EventTypes
    {
        public const string Track = "track";
        public const string PageView = "page_view";
    }

    /// <summary>The app's own user id plus traits (context merged in, nested dictionaries flattened).</summary>
    public sealed class IdentifyEvent
    {
        public IdentifyEvent(string customId, IReadOnlyDictionary<string, object?>? traits = null)
        {
            CustomId = customId;
            Traits = traits ?? new Dictionary<string, object?>();
        }

        public string CustomId { get; }
        public IReadOnlyDictionary<string, object?> Traits { get; }
    }

    /// <summary>A tracked event ready for every integration. <see cref="Type"/> is "track" or "page_view".</summary>
    public sealed class TrackEvent
    {
        public TrackEvent(string name, IReadOnlyDictionary<string, object?>? properties = null, string type = EventTypes.Track, DateTimeOffset? timestamp = null)
        {
            Name = name;
            Type = string.IsNullOrEmpty(type) ? EventTypes.Track : type;
            Properties = properties ?? new Dictionary<string, object?>();
            Timestamp = timestamp ?? DateTimeOffset.UtcNow;
        }

        public string Name { get; }
        public string Type { get; }
        public IReadOnlyDictionary<string, object?> Properties { get; }
        /// <summary>When the event was queued; sent as created_at.</summary>
        public DateTimeOffset Timestamp { get; }
    }

    /// <summary>A page (web) or screen (mobile) view.</summary>
    public sealed class PageEvent
    {
        public PageEvent(string? name = null, IReadOnlyDictionary<string, object?>? properties = null, string? navigationType = null, string? toRoute = null, string? previousRoute = null)
        {
            Name = string.IsNullOrEmpty(name) ? "page_view" : name!;
            Properties = properties ?? new Dictionary<string, object?>();
            NavigationType = navigationType;
            ToRoute = toRoute;
            PreviousRoute = previousRoute;
            Timestamp = DateTimeOffset.UtcNow;
        }

        public string Name { get; }
        public IReadOnlyDictionary<string, object?> Properties { get; }
        public string? NavigationType { get; }
        public string? ToRoute { get; }
        public string? PreviousRoute { get; }
        public DateTimeOffset Timestamp { get; }
    }

    /// <summary>Outcome of one integration call; the facade never throws for these.</summary>
    public sealed class IntegrationResult
    {
        public IntegrationResult(string integration, bool success, Exception? error = null)
        {
            Integration = integration;
            Success = success;
            Error = error;
            Timestamp = DateTimeOffset.UtcNow;
        }

        public string Integration { get; }
        public bool Success { get; }
        public Exception? Error { get; }
        public DateTimeOffset Timestamp { get; }

        public override string ToString() => $"IntegrationResult({Integration}, success={Success}{(Error == null ? "" : ", error=" + Error.Message)})";
    }

    public static class Flattener
    {
        /// <summary>Flattens nested dictionaries with "_": {a: {b: 1}} becomes {a_b: 1}.</summary>
        public static Dictionary<string, object?> Flatten(IReadOnlyDictionary<string, object?>? input)
        {
            var output = new Dictionary<string, object?>();
            if (input != null) Into(output, "", input);
            return output;
        }

        private static void Into(Dictionary<string, object?> output, string prefix, IEnumerable<KeyValuePair<string, object?>> input)
        {
            foreach (var pair in input)
            {
                var name = prefix.Length == 0 ? pair.Key : prefix + "_" + pair.Key;
                switch (pair.Value)
                {
                    case IReadOnlyDictionary<string, object?> ro:
                        Into(output, name, ro);
                        break;
                    case IDictionary<string, object?> d:
                        Into(output, name, d);
                        break;
                    default:
                        output[name] = pair.Value;
                        break;
                }
            }
        }
    }
}
