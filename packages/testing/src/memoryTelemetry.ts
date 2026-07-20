import type { NodeSlideTelemetryAdapter, NodeSlideTelemetryRecord } from '../../backend/src';

export class MemoryNodeSlideTelemetryAdapter implements NodeSlideTelemetryAdapter {
  readonly #records: NodeSlideTelemetryRecord[] = [];

  async record(event: NodeSlideTelemetryRecord): Promise<void> {
    this.#records.push(structuredClone(event));
  }

  async flush(): Promise<void> {}

  records(): NodeSlideTelemetryRecord[] {
    return structuredClone(this.#records);
  }

  clear(): void {
    this.#records.length = 0;
  }
}
