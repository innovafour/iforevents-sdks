<?php

declare(strict_types=1);

namespace IForevents;

/**
 * Talks to the IForevents ingest api: identify, single or batched track,
 * page views, a client-owned user id in X-User-Id, retries with Retry-After
 * and typed errors. Mirrors IForeventsAPIIntegration of the Flutter package.
 */
class APIIntegration extends Integration
{
    private const USER_KEY = 'iforevents_user_id';
    private const IDENTIFIED_KEY = 'iforevents_user_identified';
    private const QUEUE_KEY = 'iforevents_queue';
    private const MAX_BATCH = 500;

    public readonly APIConfig $config;
    private readonly Storage $storage;
    private readonly string $baseUrl;
    private readonly string $userAgent;
    /** @var list<array<string, mixed>> */
    private array $queue = [];
    private ?float $oldestQueuedAt = null;
    private ?string $userId = null;
    private bool $initialized = false;
    private bool $identified = false;
    private bool $quotaExceeded = false;

    public function __construct(APIConfig|string $config)
    {
        $cfg = \is_string($config) ? new APIConfig($config) : $config;
        parent::__construct('IForeventsAPIIntegration', $cfg->hooks);
        $cfg->batchSize = max(1, min(self::MAX_BATCH, $cfg->batchSize));
        $this->config = $cfg;
        $this->storage = $cfg->storage ?? new MemoryStorage();
        $this->baseUrl = rtrim($cfg->baseUrl, '/');
        $this->userAgent = $cfg->userAgent ?? sprintf('%s/%s php/%s (%s; %s)', Context::SDK_NAME, Context::SDK_VERSION, PHP_VERSION, PHP_OS_FAMILY, php_uname('m'));
        if ($cfg->flushOnShutdown) {
            register_shutdown_function(function (): void {
                try {
                    $this->shutdown();
                } catch (\Throwable) {
                    // nothing left to do at exit
                }
            });
        }
    }

    // --- state -----------------------------------------------------------------

    public function isInitialized(): bool
    {
        return $this->initialized;
    }

    public function isIdentified(): bool
    {
        return $this->identified;
    }

    /** The id every request carries in X-User-Id: a generated anon_... id kept per visitor, or the customId of the last identify. */
    public function userId(): ?string
    {
        return $this->userId;
    }

    public function queuedEvents(): int
    {
        return \count($this->queue);
    }

    /** True after a quota_exceeded answer until the next accepted request. */
    public function isQuotaExceeded(): bool
    {
        return $this->quotaExceeded;
    }

    /** A fresh anonymous id, unrelated to anything the server derives: anon_<uuid4 without dashes>. */
    public static function anonymousId(): string
    {
        $b = random_bytes(16);
        $b[6] = \chr((\ord($b[6]) & 0x0f) | 0x40);
        $b[8] = \chr((\ord($b[8]) & 0x3f) | 0x80);
        return 'anon_' . bin2hex($b);
    }

    // --- Integration ------------------------------------------------------------

    public function init(): void
    {
        parent::init();
        $stored = $this->storage->get(self::USER_KEY);
        if ($stored !== null && $stored !== '') {
            $this->userId = $stored;
            $this->identified = $this->storage->get(self::IDENTIFIED_KEY) === 'true';
        } else {
            // A fresh visitor: attribute everything to an anonymous id we own, so the
            // api never has to fingerprint the address (which merges users behind a NAT).
            $this->setUser(self::anonymousId(), false);
        }
        if ($this->config->persistQueue) {
            $raw = $this->storage->get(self::QUEUE_KEY);
            if ($raw !== null && $raw !== '') {
                $events = json_decode($raw, true);
                if (\is_array($events) && $events !== []) {
                    $this->queue = array_merge(array_values($events), $this->queue);
                    $this->trim();
                    $this->oldestQueuedAt ??= microtime(true);
                } else {
                    $this->storage->remove(self::QUEUE_KEY);
                }
            }
        }
        $this->initialized = true;
        $this->debug("api integration ready base_url={$this->baseUrl} batch_size={$this->config->batchSize}");
    }

    public function identify(IdentifyEvent $event): void
    {
        parent::identify($event);
        $properties = $event->traits;
        $body = ['custom_id' => $event->customId];
        foreach (['email', 'name', 'phone_number'] as $key) {
            if (isset($properties[$key]) && \is_string($properties[$key]) && $properties[$key] !== '') {
                $body[$key] = $properties[$key];
                unset($properties[$key]);
            }
        }
        $body['properties'] = (object) $properties;
        // Attribute from now on, even if the profile request itself fails: the
        // api creates the profile on the first event it sees for this id.
        $this->setUser($event->customId, true);
        try {
            $this->request('/v1/events/identify', $body);
        } catch (APIException $e) {
            $this->report($e);
            if ($this->config->throwOnError) {
                throw $e;
            }
        }
    }

    public function track(TrackEvent $event): void
    {
        parent::track($event);
        if ($this->config->batchSize <= 1) {
            try {
                $this->request('/v1/events/track', ['event_name' => $event->name, 'event_type' => $event->type, 'properties' => (object) $event->properties]);
            } catch (APIException $e) {
                $this->report($e);
                if ($this->config->throwOnError) {
                    throw $e;
                }
            }
            return;
        }
        $stale = $this->oldestQueuedAt !== null && (microtime(true) - $this->oldestQueuedAt) >= $this->config->flushInterval;
        $this->queue[] = ['name' => $event->name, 'type' => $event->type, 'properties' => (object) $event->properties, 'created_at' => $event->timestamp->format('Y-m-d\TH:i:s.v\Z')];
        $this->oldestQueuedAt ??= microtime(true);
        $this->trim();
        $this->persist();
        if (\count($this->queue) >= $this->config->batchSize || $stale) {
            $this->flush();
        }
    }

    public function page(PageEvent $event): void
    {
        parent::page($event);
        $props = $event->properties;
        if ($event->navigationType !== null) {
            $props['navigation_type'] = $event->navigationType;
        }
        if ($event->toRoute !== null) {
            $props['to_route'] = $event->toRoute;
        }
        if ($event->previousRoute !== null) {
            $props['previous_route'] = $event->previousRoute;
        }
        $this->track(new TrackEvent($event->name, $props, TrackEvent::TYPE_PAGE_VIEW, $event->timestamp));
    }

    public function reset(): void
    {
        parent::reset();
        try {
            $this->flush();
        } finally {
            // Forget the person; the next events belong to a fresh anonymous id.
            $this->setUser(self::anonymousId(), false);
        }
    }

    /** Sends the whole queue now, 500 events per request. */
    public function flush(): void
    {
        while ($this->queue !== []) {
            $events = array_splice($this->queue, 0, self::MAX_BATCH);
            try {
                $this->request('/v1/events/batch', ['events' => $events]);
                $this->oldestQueuedAt = $this->queue === [] ? null : $this->oldestQueuedAt;
                $this->persist();
            } catch (APIException $e) {
                if ($e->isRetryable() && $this->config->requeueFailedEvents) {
                    // Transient: keep these events at the front for the next flush.
                    $this->queue = array_merge($events, $this->queue);
                } elseif (!$e->isRetryable()) {
                    // A refused key or an exhausted quota fails the same way forever: drop everything.
                    $this->queue = [];
                    $this->oldestQueuedAt = null;
                }
                $this->persist();
                $this->report($e);
                if ($this->config->throwOnError) {
                    throw $e;
                }
                return;
            }
        }
    }

    public function shutdown(): void
    {
        $this->flush();
    }

    // --- internals ----------------------------------------------------------------

    private function trim(): void
    {
        $over = \count($this->queue) - $this->config->maxQueueSize;
        if ($over > 0) {
            array_splice($this->queue, 0, $over);
        }
    }

    private function persist(): void
    {
        if (!$this->config->persistQueue) {
            return;
        }
        if ($this->queue === []) {
            $this->storage->remove(self::QUEUE_KEY);
        } else {
            $this->storage->set(self::QUEUE_KEY, json_encode($this->queue, JSON_THROW_ON_ERROR));
        }
    }

    private function setUser(string $id, bool $identified): void
    {
        $this->userId = $id;
        $this->identified = $identified;
        $this->storage->set(self::USER_KEY, $id);
        $this->storage->set(self::IDENTIFIED_KEY, $identified ? 'true' : 'false');
    }

    private function report(APIException $e): void
    {
        $this->debug('request failed: ' . $e->getMessage());
        if ($this->config->onError !== null) {
            ($this->config->onError)($e);
        }
    }

    private function noteOutcome(?APIException $e): void
    {
        if ($e instanceof QuotaExceededException) {
            if (!$this->quotaExceeded) {
                $this->quotaExceeded = true;
                if ($this->config->onQuotaExceeded !== null) {
                    ($this->config->onQuotaExceeded)($e);
                }
            }
        } elseif ($e === null) {
            $this->quotaExceeded = false;
        }
    }

    private function debug(string $message): void
    {
        if ($this->config->debug) {
            error_log('[iforevents] ' . $message);
        }
    }

    /**
     * POSTs JSON with retries; returns the decoded body.
     *
     * @return array<string, mixed>
     */
    private function request(string $path, array $body): array
    {
        $payload = json_encode($body, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        $headers = ['Content-Type' => 'application/json', 'X-Project-Key' => $this->config->projectKey, 'User-Agent' => $this->userAgent];
        if ($this->userId !== null && $this->userId !== '') {
            $headers['X-User-Id'] = $this->userId;
        }
        $url = $this->baseUrl . $path;
        for ($attempt = 0; ; $attempt++) {
            try {
                [$status, $text, $resHeaders] = $this->config->transport !== null ? ($this->config->transport)($url, $payload, $headers, $this->config->timeout) : $this->curl($url, $payload, $headers);
                $data = json_decode($text, true);
                $data = \is_array($data) ? $data : [];
                $this->debug("POST $path -> $status");
                if ($status >= 200 && $status < 300) {
                    $this->noteOutcome(null);
                    return $data;
                }
                $error = APIException::classify($status, $data, $resHeaders['retry-after'] ?? null);
            } catch (APIException $e) {
                $error = $e;
            }
            if (!$error->isRetryable() || $attempt >= $this->config->maxRetries) {
                $this->noteOutcome($error);
                throw $error;
            }
            $delay = $error instanceof RateLimitedException && $error->retryAfter > 0 ? $error->retryAfter : $this->config->retryDelay * ($attempt + 1);
            $this->debug(sprintf('retrying %s in %.2fs (%d/%d)', $path, $delay, $attempt + 1, $this->config->maxRetries));
            usleep((int) ($delay * 1_000_000));
        }
    }

    /**
     * @param array<string, string> $headers
     * @return array{0:int,1:string,2:array<string,string>}
     */
    private function curl(string $url, string $payload, array $headers): array
    {
        $ch = curl_init($url);
        if ($ch === false) {
            throw new APIException('curl_init failed');
        }
        $headerLines = [];
        foreach ($headers as $k => $v) {
            $headerLines[] = "$k: $v";
        }
        $resHeaders = [];
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $payload,
            CURLOPT_HTTPHEADER => $headerLines,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT_MS => (int) ($this->config->timeout * 1000),
            CURLOPT_CONNECTTIMEOUT_MS => (int) ($this->config->timeout * 1000),
            CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$resHeaders): int {
                $parts = explode(':', $line, 2);
                if (\count($parts) === 2) {
                    $resHeaders[strtolower(trim($parts[0]))] = trim($parts[1]);
                }
                return \strlen($line);
            },
        ]);
        $text = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($text === false || $status === 0) {
            throw new APIException($err !== '' ? $err : 'network error');
        }
        return [$status, (string) $text, $resHeaders];
    }
}
