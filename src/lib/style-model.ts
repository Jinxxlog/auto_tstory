import type { Draft } from './model';
import type { AiJob } from './ai-model';
export type StyleKind = Draft['kind'] | 'common';
export type StyleSource = { id: string; title: string; url: string; body: string; kind: StyleKind; origin: 'url' | 'manual' | 'draft'; createdAt: string };
export type StyleRules = { rules: string; observations: string[]; warnings: string[] };
export type StyleProfile = StyleRules & { id: string; version: number; name: string; kind: StyleKind; sources: StyleSource[]; createdAt: string };
export type StyleJob = { id: string; state: AiJob['state']; step: string; model: string; name: string; kind: StyleKind; sources: StyleSource[]; attempts: number; cancel: boolean; output?: StyleRules; usage?: AiJob['usage']; createdAt: string };
export type StyleSnapshot = { id: string; version: number; name: string; kind: StyleKind; rules: string; examples: { id: string; title: string; body: string }[] };
