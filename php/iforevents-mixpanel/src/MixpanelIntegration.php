<?php

declare(strict_types=1);

namespace IForevents\Integrations;

use IForevents\IdentifyEvent;
use IForevents\Integration;
use IForevents\PageEvent;
use IForevents\TrackEvent;
use Mixpanel;

/** Forwards calls to Mixpanel through mixpanel/mixpanel-php. Mirrors iforevents_mixpanel. */
class MixpanelIntegration extends Integration
{
    private readonly Mixpanel $client;
    private ?string $distinctId = null;

    /** @param array<string, mixed> $options passed to the Mixpanel constructor (consumer, host, ...) */
    public function __construct(?string $token = null, ?Mixpanel $client = null, array $options = [], private readonly string $anonymousId = 'server', array $hooks = [])
    {
        parent::__construct('MixpanelIntegration', $hooks);
        if ($client === null && ($token === null || $token === '')) {
            throw new \InvalidArgumentException('MixpanelIntegration needs a token or a client');
        }
        $this->client = $client ?? new Mixpanel($token, $options);
    }

    private function who(): string
    {
        return $this->distinctId ?? $this->anonymousId;
    }

    public function identify(IdentifyEvent $event): void
    {
        parent::identify($event);
        $this->distinctId = $event->customId;
        $this->client->people->set($event->customId, $this->scalarize($event->traits));
    }

    public function track(TrackEvent $event): void
    {
        parent::track($event);
        $props = $this->scalarize($event->properties);
        $props['distinct_id'] = $this->who();
        $props['time'] = $event->timestamp->getTimestamp();
        $this->client->track($event->name, $props);
    }

    public function page(PageEvent $event): void
    {
        parent::page($event);
        $props = $event->properties + ['navigation_type' => $event->navigationType, 'to_route' => $event->toRoute, 'previous_route' => $event->previousRoute];
        $this->track(new TrackEvent($event->name, $props, TrackEvent::TYPE_PAGE_VIEW, $event->timestamp));
    }

    public function reset(): void
    {
        parent::reset();
        $this->distinctId = null;
    }

    public function flush(): void
    {
        $this->client->flush();
    }

    public function shutdown(): void
    {
        $this->client->flush();
    }

    /** @param array<string, mixed> $in @return array<string, mixed> */
    private function scalarize(array $in): array
    {
        return array_filter($in, static fn ($v) => $v !== null);
    }
}
