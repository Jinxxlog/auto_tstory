import type { Material } from './material';
export type DraftImage = { id: string; caption: string };
export type Draft = { id: string; version: number; title: string; kind: 'project' | 'technical' | 'ps'; summary: string; material?: Material; markdown: string; category: string; images: DraftImage[]; cover: string | null; updatedAt: string };
export type Asset = { id: string; name: string; mime: string; size: number; library: boolean };
export type Settings = { blog: string; categories: string[]; connection: string; checkedAt?: string };
export type Job = { id: string; kind: 'connect' | 'publish' | 'verify'; state: string; step: string; snapshot: { blog: string; draft?: Draft; postUrl?: string }; result: string | null; createdAt: string; updatedAt: string };
export const jobLabels: Record<string, string> = { queued: '대기 중', running: '진행 중', needs_login: '로그인 필요', needs_attention: '확인 필요', succeeded: '완료', failed: '실패', cancelled: '취소됨', unknown: '저장 결과 확인 필요' };
