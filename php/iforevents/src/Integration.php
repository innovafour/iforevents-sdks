<?php

declare(strict_types=1);

namespace IForevents;

/**
 * Base class every integration extends; mirrors the Flutter Integration.
 * Override what the vendor supports and call parent:: first so hooks run.
 */
abstract class Integration
{
    public readonly string $name;

    /**
     * @param array{onInit?: callable, onIdentify?: callable, onTrack?: callable, onPage?: callable, onReset?: callable} $hooks
     */
    public function __construct(?string $name = null, protected readonly array $hooks = [])
    {
        $this->name = $name ?? (new \ReflectionClass($this))->getShortName();
    }

    public function init(): void
    {
        if (isset($this->hooks['onInit'])) {
            ($this->hooks['onInit'])();
        }
    }

    public function identify(IdentifyEvent $event): void
    {
        if (isset($this->hooks['onIdentify'])) {
            ($this->hooks['onIdentify'])($event);
        }
    }

    public function track(TrackEvent $event): void
    {
        if (isset($this->hooks['onTrack'])) {
            ($this->hooks['onTrack'])($event);
        }
    }

    public function page(PageEvent $event): void
    {
        if (isset($this->hooks['onPage'])) {
            ($this->hooks['onPage'])($event);
        }
    }

    public function reset(): void
    {
        if (isset($this->hooks['onReset'])) {
            ($this->hooks['onReset'])();
        }
    }

    /** Sends anything buffered. No-op by default. */
    public function flush(): void
    {
    }

    /** Flushes and releases resources. No-op by default. */
    public function shutdown(): void
    {
    }

    /** Runs one integration call in isolation and reports the outcome. */
    public static function safeExecute(Integration $integration, callable $action): IntegrationResult
    {
        try {
            $action();
            return new IntegrationResult($integration->name, true);
        } catch (\Throwable $e) {
            return new IntegrationResult($integration->name, false, $e);
        }
    }
}
