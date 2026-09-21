using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace IForevents
{
    /// <summary>Default context merged into identify traits, with the Flutter key names.</summary>
    public static class Context
    {
        public const string SdkName = "iforevents-dotnet";
        public const string SdkVersion = "0.1.0";

        public static Dictionary<string, object?> Default(IReadOnlyDictionary<string, object?>? extra = null)
        {
            var ctx = new Dictionary<string, object?>
            {
                ["sdk_name"] = SdkName,
                ["sdk_version"] = SdkVersion,
                ["runtime"] = RuntimeInformation.FrameworkDescription,
                ["device_platform"] = "server",
                ["device_brand"] = RuntimeInformation.OSDescription,
                ["device_model"] = RuntimeInformation.OSArchitecture.ToString(),
                ["device_os_version"] = Environment.OSVersion.Version.ToString(),
                ["device_app_version"] = "",
                ["hostname"] = SafeHostName(),
            };
            if (extra != null) foreach (var p in extra) ctx[p.Key] = p.Value;
            return ctx;
        }

        private static string SafeHostName()
        {
            try { return Environment.MachineName; } catch (Exception) { return ""; }
        }
    }
}
