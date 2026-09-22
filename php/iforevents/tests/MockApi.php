<?php

declare(strict_types=1);

namespace IForevents\Tests;

/**
 * Records every request and answers like the real api; a scenario closure
 * injects faults. Plugged in as APIConfig::$transport, so no sockets.
 */
final class MockApi
{
    /** @var list<array{path:string, headers:array<string,string>, body:array<string,mixed>}> */
    public array $requests = [];
    /** @var null|callable(array): ?array{0:int,1:array,2:array} */
    public $scenario = null;

    public function reset(): void
    {
        $this->requests = [];
        $this->scenario = null;
    }

    /** @return list<array{path:string, headers:array<string,string>, body:array<string,mixed>}> */
    public function byPath(string $path): array
    {
        return array_values(array_filter($this->requests, static fn (array $r) => $r['path'] === $path));
    }

    /** @return array{0:int,1:string,2:array<string,string>} */
    public function __invoke(string $url, string $payload, array $headers, float $timeout): array
    {
        $path = parse_url($url, PHP_URL_PATH) ?: '';
        $lower = [];
        foreach ($headers as $k => $v) {
            $lower[strtolower($k)] = $v;
        }
        $req = ['path' => $path, 'headers' => $lower, 'body' => json_decode($payload, true) ?? []];
        $this->requests[] = $req;
        $answer = $this->scenario !== null ? ($this->scenario)($req) : null;
        if ($answer === null) {
            if (($lower['x-project-key'] ?? '') !== 'pk_test') {
                $answer = [401, ['error' => 'invalid project key'], []];
            } else {
                $answer = match ($path) {
                    '/v1/events/identify' => [201, ['user' => ['uuid' => '11111111-1111-4111-8111-111111111111']], []],
                    '/v1/events/track' => [201, ['status' => 'ok', 'user_uuid' => '22222222-2222-4222-8222-222222222222'], []],
                    '/v1/events/batch' => [202, ['status' => 'queued', 'user_uuid' => '33333333-3333-4333-8333-333333333333'], []],
                    default => [404, ['error' => 'not found'], []],
                };
            }
        }
        [$status, $body, $resHeaders] = $answer;
        $norm = [];
        foreach ($resHeaders as $k => $v) {
            $norm[strtolower($k)] = (string) $v;
        }
        return [$status, json_encode($body), $norm];
    }
}
