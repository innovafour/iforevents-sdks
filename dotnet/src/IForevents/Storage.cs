using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;

namespace IForevents
{
    /// <summary>Keeps the user id (and the queue when persisted) across runs.</summary>
    public interface IStorage
    {
        string? Get(string key);
        void Set(string key, string value);
        void Remove(string key);
    }

    /// <summary>Nothing survives the process; the default on servers.</summary>
    public sealed class MemoryStorage : IStorage
    {
        private readonly ConcurrentDictionary<string, string> _data = new ConcurrentDictionary<string, string>();
        public string? Get(string key) => _data.TryGetValue(key, out var v) ? v : null;
        public void Set(string key, string value) => _data[key] = value;
        public void Remove(string key) => _data.TryRemove(key, out _);
    }

    /// <summary>A JSON file, for CLIs, desktop apps and workers that want the queue to survive restarts.</summary>
    public sealed class FileStorage : IStorage
    {
        private readonly string _path;
        private readonly object _lock = new object();

        public FileStorage(string path) => _path = path;

        public string? Get(string key)
        {
            lock (_lock) return Read().TryGetValue(key, out var v) ? v : null;
        }

        public void Set(string key, string value)
        {
            lock (_lock)
            {
                var data = Read();
                data[key] = value;
                Write(data);
            }
        }

        public void Remove(string key)
        {
            lock (_lock)
            {
                var data = Read();
                if (data.Remove(key)) Write(data);
            }
        }

        private Dictionary<string, string> Read()
        {
            try
            {
                if (!File.Exists(_path)) return new Dictionary<string, string>();
                return JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(_path)) ?? new Dictionary<string, string>();
            }
            catch (System.Exception)
            {
                return new Dictionary<string, string>();
            }
        }

        private void Write(Dictionary<string, string> data)
        {
            var dir = Path.GetDirectoryName(Path.GetFullPath(_path));
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var tmp = _path + ".tmp";
            File.WriteAllText(tmp, JsonSerializer.Serialize(data));
            if (File.Exists(_path)) File.Delete(_path);
            File.Move(tmp, _path);
        }
    }
}
