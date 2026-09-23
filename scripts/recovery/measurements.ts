// Safe aggregate helpers: retain failed attempts instead of replacing them with final state.
type Attempt = { scenario: string; passed: boolean };
type Batch = { total: number; passed: number };
export function appendAttempts<T extends Attempt>(previous: T[], current: T[], executed: string[]): T[] {
  return [...previous, ...current.filter(row => executed.includes(row.scenario))];
}
export function executionSummary(report: { batches: Batch[]; live?: { attempts?: Attempt[]; results?: (Attempt & { posts?: number | null })[] } }) {
  const mockTotal=report.batches.reduce((n,b)=>n+b.total,0);
  const mockPassed=report.batches.reduce((n,b)=>n+b.passed,0);
  const attempts=report.live?.attempts??[];
  const liveResults=report.live?.results??[];
  const livePassed=attempts.filter(r=>r.passed).length;
  return {
    mockScenarioExecutions:mockTotal,mockPassed,
    liveScenarioAttempts:attempts.length,livePassedAttempts:livePassed,liveFailedAttempts:attempts.length-livePassed,
    liveDistinctScenarios:liveResults.length,livePrivatePostsCreated:liveResults.reduce((n,r)=>n+(r.posts??0),0),
    totalScenarioAttempts:mockTotal+attempts.length,totalPassedAttempts:mockPassed+livePassed,
    totalFailedAttempts:mockTotal-mockPassed+attempts.length-livePassed,
    finalDistinctScenarioPassed:(report.batches.at(-1)?.passed??0)+liveResults.filter(r=>r.passed).length,
  };
}

