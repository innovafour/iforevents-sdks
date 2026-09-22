# IForevents SDK for Unity

UPM package that wraps the .NET `IForevents` core (the same tested code as
the NuGet package) with a Unity-friendly surface: device context from
`SystemInfo`/`Application`, PlayerPrefs for the user id and the pending
queue, delivery off the main thread, and a flush on pause and quit. Same
philosophy as the Flutter package; the public **project key** is the only
credential.

## Install

Add via git URL in the Package Manager:

```
https://github.com/innovafour/iforevents-sdks.git?path=/unity#unity/v0.1.0
```

The package ships `Runtime/Plugins/IForevents.dll` and its netstandard2.0
dependencies (System.Text.Json and friends). If your project already brings
any of those assemblies (NuGetForUnity, another SDK), delete the duplicate
from `Runtime/Plugins`.

## Use

```csharp
IforeventsUnity.Init("pk_...", c => c.BatchSize = 20);
IforeventsUnity.Identify("player_123", new Dictionary<string, object> { ["plan"] = "free" });
IforeventsUnity.Track("level_completed", new Dictionary<string, object> { ["level"] = 3 });
IforeventsUnity.Screen("MainMenu");
IforeventsUnity.Reset(); // logout
```

Adapters from the .NET family (`IForevents.Segment`, `IForevents.PostHog`)
can be passed through `Init(..., integrations: ...)` when their assemblies
are in the project.

## Status

Written against Unity 2021.3+ and .NET Standard 2.1 API level. The C# core
is covered by the .NET test suite; the Unity glue (this package) has not yet
been compiled inside a Unity project on the maintainers' machines, and WebGL
is unsupported until a `UnityWebRequest` transport lands. Run
`tools/build-plugins.sh` to refresh `Runtime/Plugins` from the .NET build.

MIT
