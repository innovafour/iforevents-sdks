<?php

declare(strict_types=1);

namespace IForevents;

/**
 * The facade: one init(), then identify/track/page/reset/flush/shutdown fan
 * out to every integration in isolation. Identify traits go to every
 * integration once, on identify, and are not copied into later events (each
 * backend keeps them on the profile); nested arrays are flattened with "_".
 * Mirrors the Iforevents class of the Flutter package.
 */
class Iforevents
{
    /** @var list<Integration> */
    private array $integrations;
    /** @var callable(): array<string, mixed> */
    private $context;
    /** @var array<string, mixed> */
    private array $traits = [];
    private bool $initialized = false;

    /**
     * @param list<Integration> $integrations
     * @param null|callable(): array<string, mixed> $context
     * @param null|callable(list<IntegrationResult>): void $onResult
     */
    public function __construct(array $integrations = [], ?callable $context = null, private readonly bool $debug = false, private $onResult = null)
    {
        $this->integrations = array_values($integrations);
        $this->context = $context ?? static fn (): array => Context::default();
    }

    /** Builds and initializes a client with the API integration and optional adapters. */
    public static function create(string $projectKey, array $options = [], array $integrations = []): self
    {
        $api = new APIIntegration(APIConfig::fromArray($projectKey, $options));
        $client = new self([$api, ...$integrations]);
        $client->init();
        return $client;
    }

    public function isInitialized(): bool
    {
        return $this->initialized;
    }

    /** @return array<string, mixed> */
    public function currentTraits(): array
    {
        return $this->traits;
    }

    public function addIntegration(Integration $integration): self
    {
        $this->integrations[] = $integration;
        return $this;
    }

    public function integration(string $name): ?Integration
    {
        foreach ($this->integrations as $i) {
            if ($i->name === $name) {
                return $i;
            }
        }
        return null;
    }

    /** @return list<IntegrationResult> */
    public function init(): array
    {
        $results = $this->fanOut(static fn (Integration $i) => $i->init());
        $this->initialized = true;
        return $results;
    }

    /**
     * @param array<string, mixed> $traits
     * @return list<IntegrationResult>
     */
    public function identify(string $customId, array $traits = []): array
    {
        if ($customId === '' || !$this->ready('identify')) {
            return [];
        }
        $merged = flatten(array_merge($this->safeContext(), $traits));
        $event = new IdentifyEvent($customId, $merged);
        $results = $this->fanOut(static fn (Integration $i) => $i->identify($event));
        $this->traits = $merged;
        return $results;
    }

    /**
     * @param array<string, mixed> $properties
     * @return list<IntegrationResult>
     */
    public function track(string $name, array $properties = []): array
    {
        if ($name === '' || !$this->ready('track')) {
            return [];
        }
        $event = new TrackEvent($name, flatten($properties));
        return $this->fanOut(static fn (Integration $i) => $i->track($event));
    }

    /**
     * @param array<string, mixed> $properties
     * @return list<IntegrationResult>
     */
    public function page(string $name = 'page_view', array $properties = [], ?string $navigationType = null, ?string $toRoute = null, ?string $previousRoute = null): array
    {
        if (!$this->ready('page')) {
            return [];
        }
        $event = new PageEvent($name, flatten($properties), $navigationType, $toRoute, $previousRoute);
        return $this->fanOut(static fn (Integration $i) => $i->page($event));
    }

    /** page() with mobile naming. */
    public function screen(string $name, array $properties = []): array
    {
        return $this->page($name, $properties);
    }

    /** @return list<IntegrationResult> */
    public function reset(): array
    {
        if (!$this->ready('reset')) {
            return [];
        }
        $results = $this->fanOut(static fn (Integration $i) => $i->reset());
        $this->traits = [];
        return $results;
    }

    /** @return list<IntegrationResult> */
    public function flush(): array
    {
        return $this->fanOut(static fn (Integration $i) => $i->flush());
    }

    /** @return list<IntegrationResult> */
    public function shutdown(): array
    {
        $results = $this->fanOut(static fn (Integration $i) => $i->shutdown());
        $this->initialized = false;
        return $results;
    }

    private function ready(string $method): bool
    {
        if ($this->initialized) {
            return true;
        }
        if ($this->debug) {
            error_log("[iforevents] $method called before init; ignored");
        }
        return false;
    }

    /** @return array<string, mixed> */
    private function safeContext(): array
    {
        try {
            $ctx = ($this->context)();
            return \is_array($ctx) ? $ctx : [];
        } catch (\Throwable $e) {
            if ($this->debug) {
                error_log('[iforevents] context provider failed: ' . $e->getMessage());
            }
            return [];
        }
    }

    /** @return list<IntegrationResult> */
    private function fanOut(callable $action): array
    {
        $results = [];
        foreach ($this->integrations as $integration) {
            $r = Integration::safeExecute($integration, static fn () => $action($integration));
            if (!$r->success && $this->debug) {
                error_log("[iforevents] {$r->integration} failed: " . $r->error?->getMessage());
            }
            $results[] = $r;
        }
        if ($this->onResult !== null) {
            ($this->onResult)($results);
        }
        return $results;
    }
}
