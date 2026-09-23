// Imported only by explicit recovery-test entry points, never by the application.
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Job } from '../../src/lib/model';

export function check(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
export function assertTestRoot(root: string) {
  const base = path.resolve('.local'); const target = path.resolve(root);
  check(target.startsWith(base + path.sep) && /^publish-recovery(?:-|$)/.test(path.relative(base, target).split(path.sep)[0]), 'ISOLATION_REQUIRED');
  check(process.env.NODE_ENV === 'test' && process.argv.includes('--recovery-test'), 'TEST_ENTRY_REQUIRED');
}
export type Fault = 'none' | 'before-request-kill' | 'response-lost' | 'created-before-url-kill' | 'after-url-kill';
export type Variant = 'matching' | 'address' | 'title' | 'body' | 'public' | 'category' | 'count' | 'order' | 'network-error';
export type Ledger = { posts: number; publishCalls: number; automaticRepublish: number; verifyCalls: number; nonGetRequests: number; clicks: number; variant: Variant };
export const emptyLedger = (): Ledger => ({ posts: 0, publishCalls: 0, automaticRepublish: 0, verifyCalls: 0, nonGetRequests: 0, clicks: 0, variant: 'matching' });
export function readLedger(root: string): Ledger { return JSON.parse(readFileSync(path.join(root, 'external.json'), 'utf8')); }
export function changeLedger(root: string, update: (value: Ledger) => void) { const value = readLedger(root); update(value); writeFileSync(path.join(root, 'external.json'), JSON.stringify(value)); }

// SQLite triggers capture committed transitions, including acquire/claim and crashes.
// Raw IDs/URLs/body are never copied into the event rows.
export function installTrace(db: DatabaseSync, scenario: string) {
  check(/^[SE][1-6]$/.test(scenario), 'INVALID_SCENARIO');
  db.exec(`CREATE TABLE IF NOT EXISTS recovery_context (id INTEGER PRIMARY KEY CHECK(id=1), scenario TEXT, action TEXT);
    CREATE TABLE IF NOT EXISTS recovery_aliases (id TEXT PRIMARY KEY, alias TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_events (seq INTEGER PRIMARY KEY, jobKey TEXT, scenario TEXT, previousState TEXT, state TEXT, step TEXT, at TEXT, automaticRetry INTEGER, existingPostConfirmed INTEGER, result TEXT);
    INSERT OR IGNORE INTO recovery_context VALUES (1,'${scenario}','initial');`);
  const step = `CASE WHEN NEW.state='succeeded' THEN 'verified' WHEN NEW.state='cancelled' THEN 'explicitly_closed'
    WHEN NEW.step='저장 요청' THEN 'publish_requested' WHEN NEW.kind='verify' AND NEW.state='running' THEN 'verifying'
    WHEN NEW.step='결과 확인' THEN 'result_pending' WHEN NEW.state IN ('unknown','needs_attention','needs_login','failed') THEN 'attention'
    WHEN NEW.state='queued' THEN 'queued' ELSE 'preparing' END`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS recovery_insert AFTER INSERT ON jobs BEGIN
    INSERT OR IGNORE INTO recovery_aliases VALUES(NEW.id,lower(hex(randomblob(16))));
    INSERT INTO recovery_events(jobKey,scenario,previousState,state,step,at,automaticRetry,existingPostConfirmed,result)
    SELECT alias,scenario,'none',NEW.state,${step},strftime('%Y-%m-%dT%H:%M:%fZ','now'),0,0,'pending' FROM recovery_aliases,recovery_context WHERE recovery_aliases.id=NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS recovery_update AFTER UPDATE OF state,step ON jobs WHEN OLD.state<>NEW.state OR OLD.step<>NEW.step BEGIN
    INSERT INTO recovery_events(jobKey,scenario,previousState,state,step,at,automaticRetry,existingPostConfirmed,result)
    SELECT alias,scenario,OLD.state,NEW.state,${step},strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    CASE WHEN OLD.state IN ('unknown','needs_attention') AND NEW.state='queued' AND action='automatic' THEN 1 ELSE 0 END,
    CASE WHEN NEW.state='succeeded' THEN 1 ELSE 0 END,
    CASE WHEN NEW.state IN ('succeeded','cancelled','failed','unknown','needs_attention','needs_login') THEN NEW.state ELSE 'pending' END
    FROM recovery_aliases,recovery_context WHERE recovery_aliases.id=NEW.id;
    END;`);
}
export function action(db: DatabaseSync, value: 'initial' | 'automatic' | 'explicit-verification' | 'explicit-close') { db.prepare('UPDATE recovery_context SET action=? WHERE id=1').run(value); }
export function hadUncertainty(db: DatabaseSync) { return !!db.prepare("SELECT 1 FROM recovery_events WHERE state IN ('unknown','needs_attention') LIMIT 1").get(); }
export async function injectedStop(point: string): Promise<never> {
  // Parent kills this real child process after receiving the durable barrier.
  process.send?.({ barrier: point });
  return new Promise<never>(() => { setInterval(() => {}, 1000); });
}
export type SafeEvent = { seq: number; jobKey: string; scenario: string; previousState: string; state: string; step: string; at: string; automaticRetry: number; existingPostConfirmed: number; result: string };
export function events(db: DatabaseSync): SafeEvent[] { return db.prepare('SELECT * FROM recovery_events ORDER BY seq').all() as SafeEvent[]; }
export function privateMarker(job: Job) { return { id: job.id, snapshot: JSON.stringify(job.snapshot) }; }
export const runId = () => randomUUID().slice(0, 8);
