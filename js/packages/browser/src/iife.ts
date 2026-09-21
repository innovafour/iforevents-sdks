/**
 * Single-file build. Loads with a script tag; `data-project-key` triggers
 * init, and the async `window.iforevents.push([...])` queue is replayed.
 *
 *   <script src="https://iforevents.com/sdk/v1/iforevents.min.js" async
 *           data-project-key="pk_..." data-base-url="https://api.iforevents.com"
 *           data-auto-track="true"></script>
 */
import { IforeventsStatic } from "./static";

export { IforeventsStatic as Iforevents };

(function autoInit() {
  if (typeof document === "undefined") return;
  const script = document.currentScript as HTMLScriptElement | null;
  const key = script?.dataset.projectKey;
  if (!key) {
    // No attributes: the page calls Iforevents.init itself; still replay the queue after init.
    return;
  }
  const opts: Record<string, unknown> = {};
  if (script?.dataset.baseUrl) opts.baseUrl = script.dataset.baseUrl;
  if (script?.dataset.autoTrack === "true") opts.autoTrack = true;
  if (script?.dataset.debug === "true") opts.debug = true;
  if (script?.dataset.batchSize) opts.batchSize = Number(script.dataset.batchSize);
  if (script?.dataset.flushInterval) opts.flushInterval = Number(script.dataset.flushInterval);
  if (script?.dataset.appVersion) opts.appVersion = script.dataset.appVersion;
  IforeventsStatic.init(key, opts);
})();
