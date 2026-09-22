<?php

declare(strict_types=1);

// Real-api smoke: IFOREVENTS_PROJECT_KEY and IFOREVENTS_BASE_URL must be set.
require __DIR__ . '/../vendor/autoload.php';

use IForevents\APIException;
use IForevents\Iforevents;

$key = getenv('IFOREVENTS_PROJECT_KEY') ?: '';
$base = getenv('IFOREVENTS_BASE_URL') ?: 'https://api.iforevents.com';
if ($key === '') {
    fwrite(STDERR, "IFOREVENTS_PROJECT_KEY missing\n");
    exit(2);
}
$errors = [];
$client = Iforevents::create($key, ['baseUrl' => $base, 'batchSize' => 2, 'onError' => static function (APIException $e) use (&$errors): void { $errors[] = $e->getMessage(); }, 'flushOnShutdown' => false]);
/** @var \IForevents\APIIntegration $api */
$api = $client->integration('IForeventsAPIIntegration');
$identify = $client->identify('smoke_php_' . time(), ['email' => 'smoke@example.com', 'plan' => 'free', 'nested' => ['deep' => true]]);
$client->track('smoke_track', ['n' => 1]);
$client->page('/smoke');
$client->shutdown();
echo json_encode(['identify' => $identify[0]->success, 'user_id' => $api->userId(), 'queued' => $api->queuedEvents(), 'errors' => $errors]), "\n";
exit($identify[0]->success && $errors === [] && $api->userId() !== null ? 0 : 1);
