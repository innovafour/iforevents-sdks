import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, unknown>;
}

export type Scenario = (req: Recorded, res: ServerResponse, index: number) => boolean | void;

/**
 * Tiny ingest api double: records every request and answers like the real
 * api unless a scenario hook takes over (fault injection).
 */
export class MockApi {
  readonly requests: Recorded[] = [];
  private server!: Server;
  private scenario: Scenario | null = null;
  baseUrl = "";

  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
    return this;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  /** Replaces the fault-injection hook; return true from it once it answered. */
  use(scenario: Scenario | null): void {
    this.scenario = scenario;
  }

  reset(): void {
    this.requests.length = 0;
    this.scenario = null;
  }

  byPath(path: string): Recorded[] {
    return this.requests.filter((r) => r.path === path);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const recorded: Recorded = { method: req.method ?? "", path: req.url ?? "", headers: req.headers, body };
    this.requests.push(recorded);
    if (this.scenario?.(recorded, res, this.requests.length - 1)) return;
    if (req.headers["x-project-key"] !== "pk_test") return json(res, 401, { error: "invalid project key" });
    switch (recorded.path) {
      case "/v1/events/identify":
        return json(res, 201, { user: { uuid: "11111111-1111-4111-8111-111111111111", custom_id: body.custom_id } });
      case "/v1/events/track":
        return json(res, 201, { status: "ok", user_uuid: "22222222-2222-4222-8222-222222222222" });
      case "/v1/events/batch":
        return json(res, 202, { status: "queued", user_uuid: "33333333-3333-4333-8333-333333333333" });
      default:
        return json(res, 404, { error: "not found" });
    }
  }
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): true {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
  return true;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
