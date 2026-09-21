<?php

declare(strict_types=1);

namespace IForevents;

/**
 * Configuration of the first-party API integration.
 *
 * Only $projectKey is required. It is a public write key: it grants event
 * ingestion and nothing else. There is deliberately no project secret here.
 */
final class APIConfig
{
    public string $baseUrl = 'https://api.iforevents.com';
    /** Events per request (1..500); 1 disables batching. */
    public int $batchSize = 10;
    /** PHP has no timers: a partial batch older than this (seconds) is sent with the next track. */
    public float $flushInterval = 5.0;
    public float $timeout = 10.0;
    public int $maxRetries = 3;
    public float $retryDelay = 1.0;
    public bool $requeueFailedEvents = true;
    public bool $debug = false;
    /** Throw from identify/flush/reset instead of only reporting through onError. */
    public bool $throwOnError = false;
    /** @var null|callable(QuotaExceededException): void */
    public $onQuotaExceeded = null;
    /** @var null|callable(APIException): void */
    public $onError = null;
    public ?Storage $storage = null;
    /** Store the pending queue in storage so unsent events survive the request. */
    public bool $persistQueue = false;
    public int $maxQueueSize = 1000;
    public ?string $userAgent = null;
    /** register_shutdown_function drains the queue when the script ends. */
    public bool $flushOnShutdown = true;
    /** @var array{onInit?: callable, onIdentify?: callable, onTrack?: callable, onPage?: callable, onReset?: callable} */
    public array $hooks = [];
    /** @var null|callable(string $url, string $payload, array<string,string> $headers, float $timeout): array{0:int,1:string,2:array<string,string>} custom transport */
    public $transport = null;

    public function __construct(public readonly string $projectKey)
    {
        if (trim($projectKey) === '') {
            throw new \InvalidArgumentException('APIConfig needs a projectKey');
        }
    }

    /** @param array<string, mixed> $options */
    public static function fromArray(string $projectKey, array $options = []): self
    {
        if (\array_key_exists('projectSecret', $options) || \array_key_exists('project_secret', $options)) {
            throw new \InvalidArgumentException('the project secret never belongs in an SDK; pass the project key only');
        }
        $cfg = new self($projectKey);
        foreach ($options as $key => $value) {
            if (!property_exists($cfg, $key)) {
                throw new \InvalidArgumentException("unknown option $key");
            }
            $cfg->$key = $value;
        }
        return $cfg;
    }
}
