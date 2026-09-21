<?php

declare(strict_types=1);

namespace IForevents;

/** Monthly plan quota exhausted (429 quota_exceeded). */
class QuotaExceededException extends APIException
{
    /** @param array<string, mixed>|null $details */
    public function __construct(string $message, ?array $details, public readonly int $limit, public readonly int $used, public readonly ?string $organizationUuid)
    {
        parent::__construct($message, 429, 'quota_exceeded', $details);
    }

    public function isRetryable(): bool
    {
        return false;
    }
}
