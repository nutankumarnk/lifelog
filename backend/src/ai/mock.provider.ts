/**
 * Scriptable provider for tests.
 *
 * Lets a test say "this call times out", "this call returns malformed JSON" or
 * "this call hallucinates a person who was never mentioned" without touching
 * the network. Every failure mode in docs/testing.md is reproduced through this
 * class.
 *
 * Never registered outside NODE_ENV=test unless AI_PROVIDER=mock is set explicitly.
 */
import { AiProviderError, type AiProvider, type AnalysisRequest, type ProviderResult } from './provider.js';

export type MockBehaviour =
  | { kind: 'respond'; payload: unknown; rawText?: string; delayMs?: number }
  | { kind: 'respondText'; text: string; delayMs?: number }
  | { kind: 'fail'; error: AiProviderError; delayMs?: number };

export class MockProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = 'mock-model';

  /** Consumed in order; the last entry repeats once the queue drains. */
  private queue: MockBehaviour[];
  private available = true;
  readonly calls: AnalysisRequest[] = [];

  constructor(behaviours: MockBehaviour[] = []) {
    this.queue = [...behaviours];
  }

  static respondingWith(payload: unknown): MockProvider {
    return new MockProvider([{ kind: 'respond', payload }]);
  }

  static failingWith(kind: AiProviderError['kind'], message = 'mock failure'): MockProvider {
    return new MockProvider([{ kind: 'fail', error: new AiProviderError(kind, 'mock', message) }]);
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  enqueue(behaviour: MockBehaviour): void {
    this.queue.push(behaviour);
  }

  isAvailable(): boolean {
    return this.available;
  }

  async analyze(request: AnalysisRequest): Promise<ProviderResult> {
    this.calls.push(request);

    const behaviour = this.queue.length > 1 ? this.queue.shift()! : this.queue[0];
    if (!behaviour) {
      throw new AiProviderError('UNAVAILABLE', this.name, 'mock provider has no scripted behaviour');
    }

    if (behaviour.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, behaviour.delayMs));
    }

    if (behaviour.kind === 'fail') throw behaviour.error;

    if (behaviour.kind === 'respondText') {
      // Routed through the same recovery path a real model's text would take.
      const { parseModelJson } = await import('./json.js');
      const parsed = parseModelJson(behaviour.text);
      if (!parsed.ok) {
        throw new AiProviderError('BAD_OUTPUT', this.name, `model did not return JSON: ${parsed.error}`);
      }
      return { raw: parsed.value, rawText: behaviour.text, latencyMs: behaviour.delayMs ?? 0 };
    }

    return {
      raw: behaviour.payload,
      rawText: behaviour.rawText ?? JSON.stringify(behaviour.payload),
      latencyMs: behaviour.delayMs ?? 0,
    };
  }
}
