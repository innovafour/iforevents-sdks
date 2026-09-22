<?php

declare(strict_types=1);

namespace IForevents\Integrations;

use IForevents\IdentifyEvent;
use IForevents\Integration;
use IForevents\PageEvent;
use IForevents\TrackEvent;
use Segment\Client;

/** Forwards calls to Segment through segmentio/analytics-php. Mirrors iforevents_segment. */
class SegmentIntegration extends Integration
{
    private readonly Client $client;
    private ?string $userId = null;

    /** @param array<string, mixed> $options passed to the Segment Client (consumer, host, batch_size, ...) */
    public function __construct(?string $writeKey = null, ?Client $client = null, array $options = [], private readonly string $anonymousId = 'server', array $hooks = [])
    {
        parent::__construct('SegmentIntegration', $hooks);
        if ($client === null && ($writeKey === null || $writeKey === '')) {
            throw new \InvalidArgumentException('SegmentIntegration needs a writeKey or a client');
        }
        $this->client = $client ?? new Client($writeKey, $options);
    }

    /** @return array<string, string> */
    private function who(): array
    {
        return $this->userId !== null ? ['userId' => $this->userId] : ['anonymousId' => $this->anonymousId];
    }

    public function identify(IdentifyEvent $event): void
    {
        parent::identify($event);
        $this->userId = $event->customId;
        $this->client->identify(['userId' => $event->customId, 'traits' => $event->traits]);
    }

    public function track(TrackEvent $event): void
    {
        parent::track($event);
        $this->client->track($this->who() + ['event' => $event->name, 'properties' => $event->properties, 'timestamp' => $event->timestamp->getTimestamp()]);
    }

    public function page(PageEvent $event): void
    {
        parent::page($event);
        $props = array_filter($event->properties + ['navigation_type' => $event->navigationType, 'to_route' => $event->toRoute, 'previous_route' => $event->previousRoute], static fn ($v) => $v !== null);
        $this->client->page($this->who() + ['name' => $event->name, 'properties' => $props, 'timestamp' => $event->timestamp->getTimestamp()]);
    }

    public function reset(): void
    {
        parent::reset();
        $this->userId = null;
    }

    public function flush(): void
    {
        $this->client->flush();
    }

    public function shutdown(): void
    {
        $this->client->flush();
    }
}
