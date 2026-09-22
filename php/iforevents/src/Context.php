<?php

declare(strict_types=1);

namespace IForevents;

/** Default context merged into identify traits, with the Flutter key names. */
final class Context
{
    public const SDK_NAME = 'iforevents-php';
    public const SDK_VERSION = '0.1.0';

    /**
     * @param array<string, mixed> $extra
     * @return array<string, mixed>
     */
    public static function default(array $extra = []): array
    {
        return array_merge([
            'sdk_name' => self::SDK_NAME,
            'sdk_version' => self::SDK_VERSION,
            'runtime' => 'php/' . PHP_VERSION,
            'device_platform' => 'server',
            'device_brand' => PHP_OS_FAMILY,
            'device_model' => php_uname('m'),
            'device_os_version' => php_uname('r'),
            'device_app_version' => '',
            'hostname' => gethostname() ?: '',
        ], $extra);
    }
}
