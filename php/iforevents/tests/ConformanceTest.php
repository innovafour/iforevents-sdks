<?php

declare(strict_types=1);

namespace IForevents\Tests;

use IForevents\APIConfig;
use IForevents\APIException;
use IForevents\APIIntegration;
use IForevents\AuthException;
use IForevents\Iforevents;
use IForevents\Integration;
use IForevents\MemoryStorage;
use IForevents\QuotaExceededException;
use IForevents\RateLimitedException;
use IForevents\TrackEvent;
use PHPUnit\Framework\TestCase;

use function IForevents\flatten;

/** Conformance suite for sdks/CONTRACT.md section 8; each test names its item. */
final class ConformanceTest extends TestCase
{
    private const ANON = '/^anon_[0-9a-f]{32}$/';
    private MockApi $api;

    protected function setUp(): void
    {
        $this->api = new MockApi();
    }

    private function make(array $options = []): APIIntegration
    {
        $cfg = APIConfig::fromArray('pk_test', array_merge(['baseUrl' => 'http://mock', 'retryDelay' => 0.01, 'flushOnShutdown' => false, 'transport' => $this->api], $options));
        return new APIIntegration($cfg);
    }

    /** @return array{Iforevents, APIIntegration} */
    private function boot(array $options = [], array $extra = []): array
    {
        $api = $this->make($options);
        $client = new Iforevents([$api, ...$extra], static fn () => ['device_platform' => 'test', 'sdk_name' => 'iforevents-php']);
        $client->init();
        return [$client, $api];
    }

    private function names(array $req): array
    {
        return array_map(static fn (array $e) => $e['name'], $req['body']['events']);
    }

    public function test01IdentifyLiftsFieldsSwitchesUserId(): void
    {
        [$client, $api] = $this->boot();
        $client->identify('user_1', ['email' => 'ada@example.com', 'name' => 'Ada', 'phone_number' => '+1', 'plan' => 'pro', 'nested' => ['a' => 1]]);
        $req = $this->api->byPath('/v1/events/identify')[0];
        self::assertSame('pk_test', $req['headers']['x-project-key']);
        self::assertSame('application/json', $req['headers']['content-type']);
        self::assertStringStartsWith('iforevents-php/', $req['headers']['user-agent']);
        self::assertSame('user_1', $req['headers']['x-user-id']);
        self::assertSame(['custom_id' => 'user_1', 'email' => 'ada@example.com', 'name' => 'Ada', 'phone_number' => '+1', 'properties' => ['device_platform' => 'test', 'sdk_name' => 'iforevents-php', 'plan' => 'pro', 'nested_a' => 1]], $req['body']);
        self::assertSame('user_1', $api->userId());
        self::assertTrue($api->isIdentified());
    }

    public function test02TrackAfterIdentifyCarriesUserIdAndTraits(): void
    {
        [$client] = $this->boot(['batchSize' => 1]);
        $client->identify('user_1', ['plan' => 'pro']);
        $client->track('clicked', ['button' => 'buy', 'plan' => 'override']);
        $req = $this->api->byPath('/v1/events/track')[0];
        self::assertSame('user_1', $req['headers']['x-user-id']);
        self::assertSame(['event_name' => 'clicked', 'event_type' => 'track', 'properties' => ['device_platform' => 'test', 'sdk_name' => 'iforevents-php', 'plan' => 'override', 'button' => 'buy']], $req['body']);
    }

    public function test03BatchSizeNSendsOnNth(): void
    {
        [$client] = $this->boot(['batchSize' => 3, 'flushInterval' => 10]);
        $client->track('a');
        $client->track('b');
        self::assertCount(0, $this->api->requests);
        $client->track('c');
        $batches = $this->api->byPath('/v1/events/batch');
        self::assertCount(1, $batches);
        self::assertSame(['a', 'b', 'c'], $this->names($batches[0]));
        foreach ($batches[0]['body']['events'] as $e) {
            self::assertSame('track', $e['type']);
            self::assertStringEndsWith('Z', $e['created_at']);
        }
    }

    public function test04StalePartialQueueSentWithNextTrack(): void
    {
        [$client] = $this->boot(['batchSize' => 50, 'flushInterval' => 0.05]);
        $client->track('only');
        self::assertCount(0, $this->api->requests);
        usleep(80_000);
        $client->track('later');
        self::assertCount(1, $this->api->byPath('/v1/events/batch'));
        self::assertSame(['only', 'later'], $this->names($this->api->byPath('/v1/events/batch')[0]));
    }

    public function test05BatchSize1PostsTrack(): void
    {
        [$client] = $this->boot(['batchSize' => 1]);
        $client->track('solo', ['n' => 1]);
        $req = $this->api->byPath('/v1/events/track')[0];
        self::assertSame('solo', $req['body']['event_name']);
        self::assertSame('track', $req['body']['event_type']);
    }

    public function test06PageViewTypeAndNavigation(): void
    {
        [$client] = $this->boot(['batchSize' => 1]);
        $client->page('/pricing', ['title' => 'Pricing'], 'push', null, '/');
        $req = $this->api->byPath('/v1/events/track')[0];
        self::assertSame(['event_name' => '/pricing', 'event_type' => 'page_view', 'properties' => ['title' => 'Pricing', 'navigation_type' => 'push', 'previous_route' => '/']], $req['body']);
    }

    public function test07AnonymousIdGeneratedPersistedReused(): void
    {
        $storage = new MemoryStorage();
        [$client, $api] = $this->boot(['batchSize' => 1, 'storage' => $storage]);
        $client->track('first');
        $client->track('second');
        [$first, $second] = $this->api->byPath('/v1/events/track');
        $anon = $first['headers']['x-user-id'];
        self::assertMatchesRegularExpression(self::ANON, $anon);
        self::assertSame($anon, $second['headers']['x-user-id']);
        self::assertSame($anon, $api->userId());
        self::assertFalse($api->isIdentified());
        self::assertSame($anon, $storage->get('iforevents_user_id'));
        self::assertSame('false', $storage->get('iforevents_user_identified'));
        $again = $this->make(['storage' => $storage]);
        $again->init();
        self::assertSame($anon, $again->userId());
        $other = $this->make();
        $other->init();
        self::assertMatchesRegularExpression(self::ANON, (string) $other->userId());
        self::assertNotSame($anon, $other->userId());
    }

    public function test08ResetFlushesThenFreshAnonymousId(): void
    {
        $storage = new MemoryStorage();
        [$client, $api] = $this->boot(['batchSize' => 10, 'flushInterval' => 10, 'storage' => $storage]);
        $client->identify('user_1');
        $client->track('before_logout');
        $client->reset();
        $batches = $this->api->byPath('/v1/events/batch');
        self::assertCount(1, $batches);
        self::assertSame('user_1', $batches[0]['headers']['x-user-id']);
        self::assertMatchesRegularExpression(self::ANON, (string) $api->userId());
        self::assertFalse($api->isIdentified());
        self::assertSame($api->userId(), $storage->get('iforevents_user_id'));
        self::assertSame([], $client->currentTraits());
        $client->track('after_logout');
        $client->flush();
        $second = $this->api->byPath('/v1/events/batch')[1];
        self::assertSame($api->userId(), $second['headers']['x-user-id']);
        self::assertNotSame('user_1', $second['headers']['x-user-id']);
    }

    public function test09500Then200RetriesSameEventsOnce(): void
    {
        $failures = 0;
        $this->api->scenario = static function (array $req) use (&$failures): ?array {
            if ($req['path'] === '/v1/events/batch' && $failures < 1) {
                $failures++;
                return [500, ['error' => 'boom'], []];
            }
            return null;
        };
        [$client] = $this->boot(['batchSize' => 2, 'maxRetries' => 2]);
        $client->track('x');
        $client->track('y');
        $client->flush();
        $batches = $this->api->byPath('/v1/events/batch');
        self::assertCount(2, $batches);
        self::assertSame(['x', 'y'], $this->names($batches[1]));
    }

    public function test10QuotaExceededNoRetryDropCallbackOnce(): void
    {
        $refuse = true;
        $this->api->scenario = static function (array $req) use (&$refuse): ?array {
            return $req['path'] === '/v1/events/batch' && $refuse ? [429, ['error' => 'quota_exceeded', 'message' => 'plan quota exhausted', 'limit' => 5000000, 'used' => 5000001, 'org_uuid' => 'org-1'], []] : null;
        };
        $seen = [];
        [$client, $api] = $this->boot(['batchSize' => 500, 'onQuotaExceeded' => static function (QuotaExceededException $e) use (&$seen): void { $seen[] = $e; }]);
        $client->track('a');
        $client->flush();
        $client->track('b');
        $client->flush();
        self::assertCount(2, $this->api->byPath('/v1/events/batch'));
        self::assertCount(1, $seen);
        self::assertSame([5000000, 5000001, 'org-1'], [$seen[0]->limit, $seen[0]->used, $seen[0]->organizationUuid]);
        self::assertTrue($api->isQuotaExceeded());
        self::assertSame(0, $api->queuedEvents());
        $refuse = false;
        $client->track('c');
        $client->flush();
        self::assertFalse($api->isQuotaExceeded());
        $batches = $this->api->byPath('/v1/events/batch');
        self::assertSame(['c'], $this->names(end($batches)));
    }

    public function test11RateLimitRetryAfterHonored(): void
    {
        $limited = true;
        $this->api->scenario = static function (array $req) use (&$limited): ?array {
            if ($req['path'] === '/v1/events/batch' && $limited) {
                $limited = false;
                return [429, ['error' => 'ingest_rate_limit_exceeded', 'retry_after_seconds' => 1], ['Retry-After' => '1']];
            }
            return null;
        };
        $errors = [];
        [$client] = $this->boot(['batchSize' => 500, 'onError' => static function (APIException $e) use (&$errors): void { $errors[] = $e; }]);
        $client->track('r');
        $started = microtime(true);
        $client->flush();
        self::assertGreaterThanOrEqual(0.95, microtime(true) - $started);
        self::assertCount(2, $this->api->byPath('/v1/events/batch'));
        self::assertSame([], $errors);
    }

    public function test11bRateLimitErrorTypedWhenRetriesExhausted(): void
    {
        $this->api->scenario = static fn (array $req): ?array => $req['path'] === '/v1/events/identify' ? [429, ['error' => 'ingest_rate_limit_exceeded'], ['Retry-After' => '0']] : null;
        $errors = [];
        [$client] = $this->boot(['maxRetries' => 1, 'onError' => static function (APIException $e) use (&$errors): void { $errors[] = $e; }]);
        $client->identify('u');
        self::assertCount(2, $this->api->byPath('/v1/events/identify'));
        self::assertInstanceOf(RateLimitedException::class, $errors[0]);
    }

    public function test12Unauthorized401NoRetryDropAuthError(): void
    {
        $errors = [];
        $api = new APIIntegration(APIConfig::fromArray('pk_wrong', ['baseUrl' => 'http://mock', 'batchSize' => 500, 'retryDelay' => 0.01, 'flushOnShutdown' => false, 'transport' => $this->api, 'onError' => static function (APIException $e) use (&$errors): void { $errors[] = $e; }]));
        $client = new Iforevents([$api]);
        $client->init();
        $client->track('a');
        $client->flush();
        self::assertCount(1, $this->api->byPath('/v1/events/batch'));
        self::assertSame(0, $api->queuedEvents());
        self::assertInstanceOf(AuthException::class, $errors[0]);
        self::assertSame(401, $errors[0]->status);
    }

    public function test13ThrowingIntegrationDoesNotStopApi(): void
    {
        $broken = new class ('Broken') extends Integration {
            public function track(TrackEvent $event): void
            {
                parent::track($event);
                throw new \RuntimeException('vendor down');
            }
        };
        $api = $this->make(['batchSize' => 1]);
        $client = new Iforevents([$broken, $api]);
        $client->init();
        $results = $client->track('still_delivered');
        self::assertSame([['Broken', false], ['IForeventsAPIIntegration', true]], array_map(static fn ($r) => [$r->integration, $r->success], $results));
        self::assertCount(1, $this->api->byPath('/v1/events/track'));
    }

    public function test14NoSecretAnywhere(): void
    {
        [$client] = $this->boot(['batchSize' => 1]);
        $client->identify('u', ['plan' => 'pro']);
        $client->track('t');
        $client->page('/p');
        foreach ($this->api->requests as $r) {
            self::assertStringNotContainsString('secret', strtolower(json_encode($r['body'])));
            self::assertStringNotContainsString('secret', strtolower(implode(',', array_keys($r['headers']))));
        }
        $this->expectException(\InvalidArgumentException::class);
        APIConfig::fromArray('pk', ['projectSecret' => 'nope']);
    }

    public function test15Flatten(): void
    {
        self::assertSame(['a_b_c' => 1, 'list' => [1, 2], 'plain' => 'x'], flatten(['a' => ['b' => ['c' => 1]], 'list' => [1, 2], 'plain' => 'x']));
    }

    public function testQueuePersistsAcrossRestarts(): void
    {
        $storage = new MemoryStorage();
        $first = $this->make(['batchSize' => 100, 'flushInterval' => 10, 'storage' => $storage, 'persistQueue' => true]);
        $first->init();
        $first->track(new TrackEvent('offline'));
        self::assertStringContainsString('offline', (string) $storage->get('iforevents_queue'));
        $second = $this->make(['batchSize' => 100, 'flushInterval' => 10, 'storage' => $storage, 'persistQueue' => true]);
        $second->init();
        self::assertSame(1, $second->queuedEvents());
        $second->flush();
        self::assertCount(1, $this->api->byPath('/v1/events/batch'));
        self::assertNull($storage->get('iforevents_queue'));
    }

    public function testCallsBeforeInitIgnored(): void
    {
        $client = new Iforevents([$this->make()]);
        self::assertSame([], $client->track('early'));
        self::assertSame([], $client->identify('u'));
        self::assertCount(0, $this->api->requests);
    }

    public function testIdentifyAttributesEvenWhenProfileRequestFails(): void
    {
        $this->api->scenario = static fn (array $req): ?array => $req['path'] === '/v1/events/identify' ? [500, ['error' => 'down'], []] : null;
        [$client, $api] = $this->boot(['batchSize' => 1, 'maxRetries' => 0]);
        $client->identify('user_x');
        self::assertSame('user_x', $api->userId());
        $client->track('still_attributed');
        self::assertSame('user_x', $this->api->byPath('/v1/events/track')[0]['headers']['x-user-id']);
    }

    public function testThrowOnErrorRaisesAndRecovers(): void
    {
        $this->api->scenario = static fn (array $req): ?array => [500, ['error' => 'down'], []];
        [$client, $api] = $this->boot(['maxRetries' => 0, 'throwOnError' => true, 'batchSize' => 500]);
        $result = $client->identify('u')[0];
        self::assertFalse($result->success);
        self::assertStringContainsString('down', (string) $result->error?->getMessage());
        $client->track('x');
        try {
            $api->flush();
            self::fail('expected APIException');
        } catch (APIException) {
        }
        $this->api->scenario = null;
        $api->flush();
        $batches = $this->api->byPath('/v1/events/batch');
        self::assertCount(1, $this->names(end($batches)));
    }
}
