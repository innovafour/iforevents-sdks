using System;
using System.Threading;
using System.Threading.Tasks;

namespace IForevents
{
    /// <summary>Implemented by every destination. Derive from <see cref="Integration"/> for defaults and hooks.</summary>
    public interface IIntegration
    {
        string Name { get; }
        Task InitAsync(CancellationToken cancellationToken = default);
        Task IdentifyAsync(IdentifyEvent evt, CancellationToken cancellationToken = default);
        Task TrackAsync(TrackEvent evt, CancellationToken cancellationToken = default);
        Task PageAsync(PageEvent evt, CancellationToken cancellationToken = default);
        Task ResetAsync(CancellationToken cancellationToken = default);
        /// <summary>Sends anything buffered.</summary>
        Task FlushAsync(CancellationToken cancellationToken = default);
        /// <summary>Flushes and releases resources.</summary>
        Task ShutdownAsync(CancellationToken cancellationToken = default);
    }

    /// <summary>Optional callbacks fired before an integration handles a call.</summary>
    public sealed class Hooks
    {
        public Action? OnInit { get; set; }
        public Action<IdentifyEvent>? OnIdentify { get; set; }
        public Action<TrackEvent>? OnTrack { get; set; }
        public Action<PageEvent>? OnPage { get; set; }
        public Action? OnReset { get; set; }
    }

    /// <summary>Defaults and hooks; mirrors the Flutter Integration base. Call base first in overrides.</summary>
    public abstract class Integration : IIntegration
    {
        protected Integration(string? name = null, Hooks? hooks = null)
        {
            Name = name ?? GetType().Name;
            HooksConfig = hooks ?? new Hooks();
        }

        public string Name { get; }
        protected Hooks HooksConfig { get; }

        public virtual Task InitAsync(CancellationToken cancellationToken = default)
        {
            HooksConfig.OnInit?.Invoke();
            return Task.CompletedTask;
        }

        public virtual Task IdentifyAsync(IdentifyEvent evt, CancellationToken cancellationToken = default)
        {
            HooksConfig.OnIdentify?.Invoke(evt);
            return Task.CompletedTask;
        }

        public virtual Task TrackAsync(TrackEvent evt, CancellationToken cancellationToken = default)
        {
            HooksConfig.OnTrack?.Invoke(evt);
            return Task.CompletedTask;
        }

        public virtual Task PageAsync(PageEvent evt, CancellationToken cancellationToken = default)
        {
            HooksConfig.OnPage?.Invoke(evt);
            return Task.CompletedTask;
        }

        public virtual Task ResetAsync(CancellationToken cancellationToken = default)
        {
            HooksConfig.OnReset?.Invoke();
            return Task.CompletedTask;
        }

        public virtual Task FlushAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public virtual Task ShutdownAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        /// <summary>Runs one integration call in isolation and reports the outcome.</summary>
        public static async Task<IntegrationResult> SafeExecuteAsync(IIntegration integration, Func<Task> action)
        {
            try
            {
                await action().ConfigureAwait(false);
                return new IntegrationResult(integration.Name, true);
            }
            catch (Exception e)
            {
                return new IntegrationResult(integration.Name, false, e);
            }
        }
    }
}
