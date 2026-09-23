import type { Settings, BlogTarget } from './model';
import type { AiConnection } from './ai-model';
export const platformCapabilities = {
  tistory: { name: '티스토리', connectedInApp: true, images: 50, inlineImages: true, tables: true, code: true, visibility: ['private'] },
  naver: { name: '네이버', connectedInApp: false, images: 0, inlineImages: false, tables: false, code: false, visibility: [] },
} as const;
export function blogTarget(settings: Settings, category = ''): BlogTarget {
  return { platform: 'tistory', blogId: settings.blog, profile: 'tistory-profile', category, visibility: 'private' };
}
export function connectionSummary(settings: Settings, ai: AiConnection) {
  return { blog: { ...blogTarget(settings), categories: settings.categories, status: settings.connection }, ai: { provider: 'chatgpt-codex', profile: 'codex-writing', state: ai.state, models: ai.models, limits: ai.limits }, capabilities: platformCapabilities };
}
