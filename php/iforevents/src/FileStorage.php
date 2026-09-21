<?php

declare(strict_types=1);

namespace IForevents;

/** A JSON file with an exclusive lock, for CLIs and long-running workers. */
final class FileStorage implements Storage
{
    public function __construct(private readonly string $path)
    {
    }

    public function get(string $key): ?string
    {
        $data = $this->read();
        return isset($data[$key]) ? (string) $data[$key] : null;
    }

    public function set(string $key, string $value): void
    {
        $data = $this->read();
        $data[$key] = $value;
        $this->write($data);
    }

    public function remove(string $key): void
    {
        $data = $this->read();
        if (\array_key_exists($key, $data)) {
            unset($data[$key]);
            $this->write($data);
        }
    }

    /** @return array<string, mixed> */
    private function read(): array
    {
        if (!is_file($this->path)) {
            return [];
        }
        $raw = @file_get_contents($this->path);
        $data = $raw === false ? null : json_decode($raw, true);
        return \is_array($data) ? $data : [];
    }

    /** @param array<string, mixed> $data */
    private function write(array $data): void
    {
        $dir = \dirname($this->path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0775, true);
        }
        @file_put_contents($this->path, json_encode($data), LOCK_EX);
    }
}
