<?php

declare(strict_types=1);

namespace IForevents\Tests;

use IForevents\Iforevents;
use IForevents\Integrations\MixpanelIntegration;
use Mixpanel;
use PHPUnit\Framework\TestCase;

final class MixpanelIntegrationTest extends TestCase
{
    public function testForwarding(): void
    {
        $calls = [];
        $people = new class ($calls) {
            public function __construct(private array &$calls)
            {
            }

            public function set($id, $props, $ip = null, $ignoreTime = false, $ignoreAlias = false): void
            {
                $this->calls[] = ['people_set', $id, $props];
            }
        };
        $client = $this->getMockBuilder(Mixpanel::class)->disableOriginalConstructor()->onlyMethods(['track', 'flush'])->getMock();
        $client->people = $people;
        $client->method('track')->willReturnCallback(static function ($event, $props) use (&$calls): void {
            $calls[] = ['track', $event, $props];
        });
        $client->expects(self::atLeastOnce())->method('flush');

        $ife = new Iforevents([new MixpanelIntegration(client: $client)], static fn () => []);
        $ife->init();
        $ife->track('anon');
        $ife->identify('u', ['plan' => 'pro', 'nested' => ['x' => 1], 'nil' => null]);
        $ife->track('paid', ['amount' => 1]);
        $ife->page('Home', [], 'load');
        $ife->reset();
        $ife->track('again');
        $ife->shutdown();

        self::assertSame('server', $calls[0][2]['distinct_id']);
        self::assertSame(['people_set', 'u', ['plan' => 'pro', 'nested_x' => 1]], $calls[1]);
        self::assertSame('u', $calls[2][2]['distinct_id']);
        self::assertSame(1, $calls[2][2]['amount']);
        self::assertArrayHasKey('time', $calls[2][2]);
        self::assertSame('Home', $calls[3][1]);
        self::assertSame('load', $calls[3][2]['navigation_type']);
        self::assertSame('server', $calls[4][2]['distinct_id']);
    }

    public function testRealClientConstructs(): void
    {
        $integration = new MixpanelIntegration('token', options: ['consumer' => 'file', 'file' => '/tmp/iforevents-mixpanel-test.log']);
        $integration->init();
        self::assertSame('MixpanelIntegration', $integration->name);
    }
}
