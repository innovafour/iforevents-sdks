using System.Collections.Generic;
using IForevents.Unity;
using UnityEngine;

public class AnalyticsBootstrap : MonoBehaviour
{
    [SerializeField] private string projectKey = "pk_...";

    private void Awake()
    {
        IforeventsUnity.Init(projectKey, c => c.BatchSize = 20);
        IforeventsUnity.Identify("player_123", new Dictionary<string, object> { ["plan"] = "free" });
        IforeventsUnity.Screen("MainMenu");
    }

    public void OnLevelCompleted(int level) => IforeventsUnity.Track("level_completed", new Dictionary<string, object> { ["level"] = level });
}
