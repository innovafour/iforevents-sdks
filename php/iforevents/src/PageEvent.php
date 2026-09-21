<?php

declare(strict_types=1);

namespace IForevents;

/** A page (web) or screen (mobile) view. */
final class PageEvent
{
    public readonly string $name;
    public readonly \DateTimeImmutable $timestamp;

    /** @param array<string, mixed> $properties */
    public function __construct(string $name = 'page_view', public readonly array $properties = [], public readonly ?string $navigationType = null, public readonly ?string $toRoute = null, public readonly ?string $previousRoute = null)
    {
        $this->name = $name === '' ? 'page_view' : $name;
        $this->timestamp = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }
}
