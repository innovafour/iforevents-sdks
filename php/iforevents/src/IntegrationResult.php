<?php

declare(strict_types=1);

namespace IForevents;

/** Outcome of one integration call; the facade never throws for these. */
final class IntegrationResult
{
    public readonly \DateTimeImmutable $timestamp;

    public function __construct(public readonly string $integration, public readonly bool $success, public readonly ?\Throwable $error = null)
    {
        $this->timestamp = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
    }
}
