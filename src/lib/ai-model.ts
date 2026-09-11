import type { Draft } from './model';
import type { StyleSnapshot } from './style-model';

export type AiModel = { id: string; name: string; images: boolean; isDefault: boolean };
export type AiConnection = { state: 'disconnected' | 'connecting' | 'login' | 'connected' | 'error'; message: string; authUrl?: string; plan?: string; models: AiModel[]; limits?: { name: string; used: number; resetsAt: number | null }[]; checkedAt?: string };
export type AiOutput = { title: string; outline: string[]; markdown: string; captions: { id: string; caption: string }[]; warnings: string[] };
export type AiJob = { id: string; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'; step: string; draft: Draft; model: string; selection: string; instruction: string; style?: StyleSnapshot; attempts: number; cancel: boolean; output?: AiOutput; usage?: { input: number; output: number; total: number }; appliedVersion?: number; createdAt: string };
