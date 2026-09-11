import type { AiConnection, AiJob, AiOutput } from '../../lib/ai-model';

export interface WritingProvider {
  status(): Promise<AiConnection>;
  login(): Promise<string>;
  generate(job: AiJob, signal: AbortSignal): Promise<{ output: AiOutput; usage?: AiJob['usage'] }>;
  close(): void;
}
