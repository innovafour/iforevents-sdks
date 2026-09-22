<?php

declare(strict_types=1);

namespace IForevents;

/** Project key unknown, rotated or project disabled (401/403). */
class AuthException extends APIException
{
    public function isRetryable(): bool
    {
        return false;
    }
}
