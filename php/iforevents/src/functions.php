<?php

declare(strict_types=1);

namespace IForevents;

/** Nested associative arrays are flattened with "_": ['a' => ['b' => 1]] becomes ['a_b' => 1]. Lists are kept. */
function flatten(array $input, string $prefix = ''): array
{
    $out = [];
    foreach ($input as $key => $value) {
        $name = $prefix === '' ? (string) $key : $prefix . '_' . $key;
        if (\is_array($value) && !array_is_list($value) && $value !== []) {
            $out = array_merge($out, flatten($value, $name));
        } else {
            $out[$name] = $value;
        }
    }
    return $out;
}
