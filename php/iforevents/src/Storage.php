<?php

declare(strict_types=1);

namespace IForevents;

/** Keeps the user id (and the queue when persisted) across requests or runs. */
interface Storage
{
    public function get(string $key): ?string;

    public function set(string $key, string $value): void;

    public function remove(string $key): void;
}
