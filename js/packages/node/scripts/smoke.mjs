// Real-api smoke: IFOREVENTS_PROJECT_KEY and IFOREVENTS_BASE_URL must be set.
import { createIforevents } from "../dist/index.js";
const projectKey = process.env.IFOREVENTS_PROJECT_KEY;
const baseUrl = process.env.IFOREVENTS_BASE_URL ?? "https://api.iforevents.com";
if (!projectKey) { console.error("IFOREVENTS_PROJECT_KEY missing"); process.exit(2); }
const errors = [];
const { iforevents, api, shutdown } = await createIforevents({ projectKey, baseUrl, batchSize: 2, onError: (e) => errors.push(String(e)) });
const [id] = await iforevents.identify(`smoke_node_${Date.now()}`, { email: "smoke@example.com", plan: "free" });
await iforevents.track("smoke_track", { n: 1 });
await iforevents.page("/smoke");
await shutdown();
console.log(JSON.stringify({ identify: id.success, userId: api.currentUserId, queued: api.queuedEventsCount, errors }));
process.exit(id.success && errors.length === 0 ? 0 : 1);
