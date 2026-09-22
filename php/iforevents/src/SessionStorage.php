<?php

declare(strict_types=1);

namespace IForevents;

/** PHP session storage for web apps: the anonymous id follows the visitor's session. */
final class SessionStorage implements Storage
{
    public function __construct(private readonly string $prefix = 'iforevents.')
    {
    }

    public function get(string $key): ?string
    {
        return isset($_SESSION[$this->prefix . $key]) ? (string) $_SESSION[$this->prefix . $key] : null;
    }

    public function set(string $key, string $value): void
    {
        $_SESSION[$this->prefix . $key] = $value;
    }

    public function remove(string $key): void
    {
        unset($_SESSION[$this->prefix . $key]);
    }
}
