import { arch, hostname, platform, release, type as osType } from "node:os";
import { IForeventsAPIIntegration, Iforevents, type IForeventsAPIConfig, type IforeventsOptions, type Integration, type Properties } from "@iforevents/core";

export * from "@iforevents/core";

export const SDK_NAME = "@iforevents/node";
export const SDK_VERSION = "0.1.0";

/** Server context merged into identify traits, with the Flutter key names. */
export function nodeContext(extra: Properties = {}): Properties {
  return {
    sdk_name: SDK_NAME,
    sdk_version: SDK_VERSION,
    runtime: `node/${process.versions.node}`,
    device_platform: "server",
    device_brand: osType(),
    device_model: arch(),
    device_os_version: release(),
    device_app_version: process.env.npm_package_version ?? "",
    hostname: hostname(),
    os: platform(),
    ...extra,
  };
}

export interface NodeIforeventsOptions extends Omit<IForeventsAPIConfig, "userAgent" | "storage"> {
  /** Extra integrations besides the IForevents API. */
  integrations?: Integration[];
  /** Extra context merged into identify traits (app name, version, region). */
  context?: Properties;
  /** Flush on `beforeExit`. Default true. */
  flushOnExit?: boolean;
  /** Skip the IForevents API integration (only third-party adapters). Default false. */
  disableApi?: boolean;
  onResult?: IforeventsOptions["onResult"];
}

/** Facade plus its api integration, ready to use. */
export interface NodeIforevents {
  iforevents: Iforevents;
  api: IForeventsAPIIntegration | null;
  /** Flushes every integration and stops timers. Call before the process exits. */
  shutdown(): Promise<void>;
}

/**
 * Creates and initializes an `Iforevents` for a server process. Batching is
 * on by default (10 events / 5 s); `flushOnExit` drains the queue on
 * `process.beforeExit`. Call `shutdown()` from your own SIGTERM handler.
 */
export async function createIforevents(options: NodeIforeventsOptions): Promise<NodeIforevents> {
  const { integrations = [], context = {}, flushOnExit = true, disableApi = false, onResult, ...apiConfig } = options;
  const api = disableApi
    ? null
    : new IForeventsAPIIntegration({
        ...apiConfig,
        userAgent: `iforevents-node/${SDK_VERSION} node/${process.versions.node} (${platform()}; ${arch()})`,
      });
  const iforevents = new Iforevents({
    integrations: api ? [api, ...integrations] : integrations,
    context: () => nodeContext(context),
    debug: apiConfig.debug,
    logger: apiConfig.logger,
    onResult,
  });
  await iforevents.init();

  let stopped = false;
  const shutdown = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await iforevents.shutdown();
  };
  if (flushOnExit) {
    process.once("beforeExit", () => {
      void shutdown();
    });
  }
  return { iforevents, api, shutdown };
}
