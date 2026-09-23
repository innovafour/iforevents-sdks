<?php

declare(strict_types=1);

namespace IForevents\Tests;

use IForevents\Iforevents;
use IForevents\Integrations\SegmentIntegration;
use PHPUnit\Framework\TestCase;

final class SegmentIntegrationTest extends TestCase
{
    public function testForwardingThroughTheFileConsumer(): void
    {
        $file = sys_get_temp_dir() . '/iforevents-segment-' . uniqid() . '.log';
        $integration = new SegmentIntegration('wk', options: ['consumer' => 'file', 'filename' => $file]);
        $ife = new Iforevents([$integration], static fn () => []);
        $ife->init();
        $ife->track('anon');
        $ife->identify('u', ['plan' => 'pro']);
        $ife->track('paid', ['amount' => 1]);
        $ife->page('Home', [], null, '/');
        $ife->reset();
        $ife->track('again');
        $ife->shutdown();

        $lines = array_values(array_filter(array_map('trim', file($file))));
        $msgs = array_map(static fn (string $l) => json_decode($l, true), $lines);
        @unlink($file);
        self::assertCount(5, $msgs);
        self::assertSame(['track', 'anon', 'server'], [$msgs[0]['type'], $msgs[0]['event'], $msgs[0]['anonymousId']]);
        self::assertSame(['identify', 'u', 'pro'], [$msgs[1]['type'], $msgs[1]['userId'], $msgs[1]['traits']['plan']]);
        self::assertSame(['u', 'paid', ['amount' => 1]], [$msgs[2]['userId'], $msgs[2]['event'], $msgs[2]['properties']]);
        self::assertSame(['page', 'Home', '/'], [$msgs[3]['type'], $msgs[3]['name'], $msgs[3]['properties']['to_route']]);
        self::assertSame('server', $msgs[4]['anonymousId']);
        self::assertSame('SegmentIntegration', $integration->name);
    }
}
