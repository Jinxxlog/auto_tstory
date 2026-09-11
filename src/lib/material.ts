export type Reference = { id: string; title: string; url: string; text: string; method: 'fetched' | 'pasted'; checkedAt: string; official: boolean };
export type Example = { input: string; expected: string; kind: 'example' | 'edge' };
export type Material = { topic: string; interpretation: string; problem: string; constraints: string; language: string; code: string; cases: Example[]; referenceIds: string[] };
export const emptyMaterial = (): Material => ({ topic: '', interpretation: '', problem: '', constraints: '', language: 'Python', code: '', cases: [], referenceIds: [] });
export function validateMaterial(input: unknown): Material {
  if (!input || typeof input !== 'object') throw new Error('자료 입력을 확인하세요.');
  const v = input as Material; const out = emptyMaterial();
  for (const [key, max] of Object.entries({ topic: 500, interpretation: 10000, problem: 20000, constraints: 5000, language: 50, code: 20000 })) {
    const value = v[key as keyof Material];
    if (typeof value !== 'string' || value.length > max) throw new Error(`${key} 입력 길이를 확인하세요.`);
    (out as unknown as Record<string, unknown>)[key] = value;
  }
  if (!Array.isArray(v.referenceIds) || v.referenceIds.length > 5 || v.referenceIds.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id))) throw new Error('출처는 최대 5개입니다.');
  out.referenceIds = [...new Set(v.referenceIds)];
  if (!Array.isArray(v.cases) || v.cases.length > 5) throw new Error('예제는 최대 5개입니다.');
  out.cases = v.cases.map(c => {
    if (!c || !['example', 'edge'].includes(c.kind) || typeof c.input !== 'string' || typeof c.expected !== 'string' || c.input.length > 5000 || c.expected.length > 5000) throw new Error('예제 입력과 기대 출력을 확인하세요.');
    return { input: c.input, expected: c.expected, kind: c.kind };
  });
  return out;
}
