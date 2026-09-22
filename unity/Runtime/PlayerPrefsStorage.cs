using UnityEngine;

namespace IForevents.Unity
{
    /// <summary>IStorage on PlayerPrefs: the user id and the pending queue survive restarts. Main thread only, like PlayerPrefs itself.</summary>
    public sealed class PlayerPrefsStorage : IStorage
    {
        private readonly string _prefix;

        public PlayerPrefsStorage(string prefix = "iforevents.") => _prefix = prefix;

        public string Get(string key) => PlayerPrefs.HasKey(_prefix + key) ? PlayerPrefs.GetString(_prefix + key) : null;

        public void Set(string key, string value)
        {
            PlayerPrefs.SetString(_prefix + key, value);
            PlayerPrefs.Save();
        }

        public void Remove(string key)
        {
            PlayerPrefs.DeleteKey(_prefix + key);
            PlayerPrefs.Save();
        }
    }
}
