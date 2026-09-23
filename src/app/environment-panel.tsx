'use client';
import { useState } from 'react';
type Check = { id: string; level: string; message: string };
export function EnvironmentPanel({ request }: { request: (action: string) => Promise<Check[]> }) {
  const [checks, setChecks] = useState<Check[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function inspect() {
    setBusy(true); setError('');
    try { setChecks(await request('diagnostics')); } catch { setError('환경을 확인하지 못했습니다. 설치 폴더의 Doctor.cmd를 실행하세요.'); } finally { setBusy(false); }
  }
  return <section className="panel environment-panel"><h2>이 컴퓨터의 실행 환경</h2><p>블로그 연결과 AI 생성에 필요한 프로그램을 확인합니다. 계정 로그인이나 글 전송은 실행하지 않습니다.</p><button disabled={busy} onClick={() => void inspect()}>{busy ? '확인 중…' : '실행 환경 확인'}</button>{error && <p role="alert">{error}</p>}<ul>{checks.map(check => <li key={check.id}><strong>{check.level === 'ok' ? '준비됨' : check.level === 'warning' ? '추가 준비' : '확인 필요'}</strong> · {check.message}</li>)}</ul></section>;
}
