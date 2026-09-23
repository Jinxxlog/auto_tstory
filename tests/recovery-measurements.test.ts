import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendAttempts, executionSummary } from '../scripts/recovery/measurements';

test('a corrected live rerun preserves the failed attempt without recounting completed scenarios', () => {
  const first=[{scenario:'E1',passed:true},{scenario:'E2',passed:true},{scenario:'E3',passed:false}];
  const final=first.map(r=>({...r,passed:true,posts:1}));
  const attempts=appendAttempts(first,final,['E3']);
  assert.deepEqual(attempts.map(r=>[r.scenario,r.passed]),[['E1',true],['E2',true],['E3',false],['E3',true]]);
  assert.equal(first.length,3);
  const counts=executionSummary({batches:[{total:30,passed:30}],live:{attempts,results:final}});
  assert.equal(counts.totalScenarioAttempts,34);
  assert.equal(counts.totalFailedAttempts,1);
  assert.equal(counts.livePrivatePostsCreated,3);
  assert.deepEqual(appendAttempts(attempts,final,[]),attempts);
});

