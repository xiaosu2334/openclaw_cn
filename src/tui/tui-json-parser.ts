/**
 * JSON Parser with worker_threads pool for large payloads (P1-2).
 *
 * Messages larger than the defined byte threshold are parsed in a worker
 * thread to avoid blocking the main TUI render loop. Smaller messages are
 * parsed synchronously on the main thread.
 *
 * Worker pool size is capped at 2 to limit resource usage in the TUI context.
 */

import { Buffer } from "node:buffer";
import { Worker } from "node:worker_threads";

/** Threshold in bytes above which JSON parsing is delegated to a worker. */
const WORKER_THRESHOLD_BYTES = 1_048_576; // 1 MB

/** Maximum number of worker threads in the pool. */
const MAX_WORKERS = 2;

/** Inline worker script for JSON.parse — avoids needing a separate file. */
const WORKER_SCRIPT = `
const { parentPort } = require("worker_threads");
parentPort?.on("message", (msg) => {
  try {
    if (!msg || msg.type !== "parse" || !Buffer.isBuffer(msg.buffer)) {
      parentPort?.postMessage({ id: msg?.id, error: "invalid request" });
      return;
    }
    const text = msg.buffer.toString("utf-8");
    const result = JSON.parse(text);
    parentPort?.postMessage({ id: msg.id, result });
  } catch (err) {
    parentPort?.postMessage({ id: msg?.id, error: String(err) });
  }
});
`;

type ParseJob = {
  id: number;
  buffer: Buffer;
  resolve: (value: object) => void;
  reject: (reason: Error) => void;
};

/**
 * Pool of worker threads for offloading large JSON.parse operations.
 *
 * Usage:
 * ```typescript
 * const pool = getJsonParseWorkerPool();
 * const result = await pool.parseAsync(largeBuffer);
 * ```
 */
export class JsonParseWorkerPool {
  private workers: Worker[] = [];
  private busy: Set<Worker> = new Set();
  /** Map from message id to the job that expects a response. */
  private pending = new Map<number, ParseJob>();
  private queue: ParseJob[] = [];
  private nextId = 0;
  private disposed = false;

  /**
   * Parse a JSON buffer, using a worker thread if the buffer exceeds
   * the threshold size. Otherwise parse synchronously on the main thread.
   *
   * @param buffer - UTF-8 encoded JSON buffer.
   * @returns Parsed object.
   */
  async parseAsync(buffer: Buffer): Promise<object> {
    if (this.disposed) {
      throw new Error("JsonParseWorkerPool is disposed");
    }

    // Small payloads: parse synchronously to avoid worker overhead.
    if (buffer.length <= WORKER_THRESHOLD_BYTES) {
      try {
        const text = buffer.toString("utf-8");
        return JSON.parse(text) as object;
      } catch (err) {
        throw new Error(`JSON parse error: ${String(err)}`);
      }
    }

    // Large payloads: delegate to worker pool.
    return this.enqueueJob(buffer);
  }

  /**
   * Synchronous parse for any buffer size. Used as a fallback when
   * worker_threads is unavailable (e.g., in certain build environments).
   */
  parseSync(buffer: Buffer): object {
    const text = buffer.toString("utf-8");
    return JSON.parse(text) as object;
  }

  /**
   * Dispose all workers and reject pending jobs.
   */
  dispose(): void {
    this.disposed = true;
    for (const job of this.queue) {
      job.reject(new Error("JsonParseWorkerPool disposed"));
    }
    this.queue = [];
    for (const [, job] of this.pending) {
      job.reject(new Error("JsonParseWorkerPool disposed"));
    }
    this.pending.clear();
    for (const worker of this.workers) {
      void worker.terminate();
    }
    this.workers = [];
    this.busy.clear();
  }

  private enqueueJob(buffer: Buffer): Promise<object> {
    const id = this.nextId++;
    const promise = new Promise<object>((resolve, reject) => {
      const job: ParseJob = { id, buffer, resolve, reject };
      this.queue.push(job);
    });
    this.processQueue();
    return promise;
  }

  private processQueue(): void {
    while (this.queue.length > 0) {
      // Try to use an existing idle worker.
      let worker: Worker | undefined;
      for (const w of this.workers) {
        if (!this.busy.has(w)) {
          worker = w;
          break;
        }
      }

      // Spawn a new worker if under the limit.
      if (!worker && this.workers.length < MAX_WORKERS) {
        worker = this.createWorker();
      }

      if (!worker) {
        // All workers busy — remaining jobs wait in queue.
        return;
      }

      const job = this.queue.shift();
      if (!job) {
        return;
      }

      this.busy.add(worker);
      this.pending.set(job.id, job);
      worker.postMessage({ type: "parse", id: job.id, buffer: job.buffer });
    }
  }

  private createWorker(): Worker {
    const worker = new Worker(WORKER_SCRIPT, { eval: true });
    this.workers.push(worker);

    worker.on("message", (msg: { id: number; result?: unknown; error?: string }) => {
      this.busy.delete(worker);

      const job = this.pending.get(msg.id);
      if (job) {
        this.pending.delete(msg.id);
        if (msg.result !== undefined) {
          job.resolve(msg.result as object);
        } else {
          job.reject(new Error(msg.error ?? "unknown worker error"));
        }
      }

      // Process next queued job if any.
      this.processQueue();
    });

    worker.on("error", () => {
      this.busy.delete(worker);
      this.processQueue();
    });

    return worker;
  }
}

/**
 * Default singleton instance for use by embedded-backend.
 * Lazily instantiated.
 */
let defaultPool: JsonParseWorkerPool | null = null;

export function getJsonParseWorkerPool(): JsonParseWorkerPool {
  if (!defaultPool) {
    defaultPool = new JsonParseWorkerPool();
  }
  return defaultPool;
}

/**
 * Dispose the default worker pool. Should be called during TUI shutdown.
 */
export function disposeJsonParseWorkerPool(): void {
  if (defaultPool) {
    defaultPool.dispose();
    defaultPool = null;
  }
}
