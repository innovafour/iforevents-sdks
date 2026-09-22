# IForevents SDKs

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Server and client SDKs for [IForevents](https://iforevents.com), one directory
per language. Every SDK implements the same [contract](CONTRACT.md): one
facade, pluggable integrations, a first-party API integration that batches and
retries, and a public project key only.

The Flutter SDK lives in [innovafour/flutter_iforevents](https://github.com/innovafour/flutter_iforevents).

| Directory | Platform | Install |
|-----------|----------|---------|
| [`android`](android) | Android (Kotlin) | `implementation("com.iforevents:iforevents-android:0.1.0")` |
| [`dotnet`](dotnet) | .NET | `dotnet add package IForevents` |
| [`go`](go) | Go | `go get github.com/innovafour/iforevents-sdks/go` |
| [`java`](java) | JVM | Maven `com.iforevents:iforevents` |
| [`js`](js) | Browser, Node, React, Next.js, React Native | `npm i @iforevents/core` |
| [`php`](php) | PHP | `composer require innovafour/iforevents` |
| [`python`](python) | Python | `pip install iforevents` |
| [`ruby`](ruby) | Ruby | `gem install iforevents` |
| [`swift`](swift) | iOS, macOS, tvOS, watchOS | SwiftPM `https://github.com/innovafour/iforevents-sdks.git` |
| [`unity`](unity) | Unity | UPM `https://github.com/innovafour/iforevents-sdks.git?path=/unity#unity/v0.1.0` |

Each directory has its own README with usage, adapters and local test commands.

## Credentials

The SDKs take a **project key** only. It grants event ingestion and nothing
else, so shipping it inside an app is safe. Reading analytics needs a dashboard
session. If a key is abused, rotate it from the dashboard.

## Releases

Each SDK is versioned and released on its own. Push a tag and the matching
workflow in `.github/workflows/publish-<sdk>.yml` tests and publishes it:

| SDK | Tag |
|-----|-----|
| android, dotnet, java, js, php, python, ruby, unity | `<sdk>/vX.Y.Z` (e.g. `python/v0.2.0`) |
| go | `go/vX.Y.Z`, then `go/integrations/<name>/vX.Y.Z` per adapter |
| swift | `X.Y.Z` (SwiftPM reads plain semver tags on the root `Package.swift`) |

The version in the SDK's manifest must match the tag.

## History

These SDKs were separate repositories (`innovafour/iforevents-<sdk>`), now
archived. Their full git history is preserved here under each directory.

## License

MIT. See [LICENSE](LICENSE).
