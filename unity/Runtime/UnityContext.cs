using System.Collections.Generic;
using UnityEngine;

namespace IForevents.Unity
{
    /// <summary>Device context merged into identify traits, with the Flutter key names. Read on the main thread once at init.</summary>
    public static class UnityContext
    {
        public const string SdkName = "iforevents-unity";
        public const string SdkVersion = "0.1.0";

        public static Dictionary<string, object> Collect(IReadOnlyDictionary<string, object> extra = null)
        {
            var ctx = new Dictionary<string, object>
            {
                ["sdk_name"] = SdkName,
                ["sdk_version"] = SdkVersion,
                ["runtime"] = "unity/" + Application.unityVersion,
                ["device_platform"] = Application.platform.ToString().ToLowerInvariant(),
                ["device_brand"] = SystemInfo.deviceModel,
                ["device_model"] = SystemInfo.deviceModel,
                ["device_os_version"] = SystemInfo.operatingSystem,
                ["device_app_version"] = Application.version,
                ["app_bundle_id"] = Application.identifier,
                ["language"] = Application.systemLanguage.ToString(),
                ["screen_width"] = Screen.width,
                ["screen_height"] = Screen.height,
                ["graphics_device"] = SystemInfo.graphicsDeviceName,
            };
            if (extra != null) foreach (var p in extra) ctx[p.Key] = p.Value;
            return ctx;
        }
    }
}
