<?php

declare(strict_types=1);

namespace IForevents;

/** The app's own user id plus traits (context merged in, nested arrays flattened). */
final class IdentifyEvent
{
    /** @param array<string, mixed> $traits */
    public function __construct(public readonly string $customId, public readonly array $traits = [])
    {
    }
}
