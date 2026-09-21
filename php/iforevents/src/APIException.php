<?php

declare(strict_types=1);

namespace IForevents;

class APIException extends \RuntimeException
{
    /** @param array<string, mixed>|null $details */
    public function __construct(string $message, public readonly int $status = 0, public readonly ?string $apiCode = null, public readonly ?array $details = null, ?\Throwable $previous = null)
    {
        parent::__construct($message, $status, $previous);
    }

    /** Transient failures (network, 5xx) are retried and their events kept. */
    public function isRetryable(): bool
    {
        return $this->status === 0 || $this->status >= 500;
    }

    /** @param array<string, mixed>|null $details */
    public static function classify(int $status, ?array $details, ?string $retryAfterHeader): self
    {
        $code = isset($details['error']) && \is_string($details['error']) ? $details['error'] : null;
        $message = (string) ($details['message'] ?? $code ?? "request failed with status $status");
        if ($status === 429 && $code === 'quota_exceeded') {
            return new QuotaExceededException($message, $details, (int) ($details['limit'] ?? 0), (int) ($details['used'] ?? 0), isset($details['org_uuid']) ? (string) $details['org_uuid'] : null);
        }
        if ($status === 429) {
            $wait = $retryAfterHeader !== null && is_numeric(trim($retryAfterHeader)) ? (float) trim($retryAfterHeader) : (float) ($details['retry_after_seconds'] ?? 0);
            return new RateLimitedException($message, $code, $details, $wait);
        }
        if ($status === 401 || $status === 403) {
            return new AuthException($message, $status, $code, $details);
        }
        return new self($message, $status, $code, $details);
    }
}
