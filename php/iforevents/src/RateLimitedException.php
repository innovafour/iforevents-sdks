<?php

declare(strict_types=1);

namespace IForevents;

/** Too many requests in a short window (429 without a quota code); retried after $retryAfter seconds. */
class RateLimitedException extends APIException
{
    /** @param array<string, mixed>|null $details */
    public function __construct(string $message, ?string $code, ?array $details, public readonly float $retryAfter)
    {
        parent::__construct($message, 429, $code, $details);
    }

    public function isRetryable(): bool
    {
        return true;
    }
}
