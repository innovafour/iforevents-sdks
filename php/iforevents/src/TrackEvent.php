<?php

declare(strict_types=1);

namespace IForevents;

/** A tracked event ready for every integration. `type` is "track" or "page_view". */
final class TrackEvent
{
    public const TYPE_TRACK = 'track';
    public const TYPE_PAGE_VIEW = 'page_view';

    public readonly string $type;
    public readonly \DateTimeImmutable $timestamp;

    /** @param array<string, mixed> $properties */
    public function __construct(public readonly string $name, public readonly array $properties = [], string $type = self::TYPE_TRACK, ?\DateTimeImmutable $timestamp = null)
    {
        $this->type = $type === '' ? self::TYPE_TRACK : $type;
        $this->timestamp = $timestamp ?? new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }
}
