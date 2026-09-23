import type { openStore } from '../lib/store';
import type { Job } from '../lib/model';
import { AttentionRequired, LoginRequired } from './tistory/publisher';

export interface PublicationAdapter {
  categories(blog: string): Promise<string[]>;
  publish(job: Job, step: (value: string, postUrl?: string, imagePaths?: string[]) => void): Promise<string>;
  verify(job: Job): Promise<string>;
}

// One production queue iteration. Fault injection belongs to test adapters only.
export async function runPublicationOnce(
  store: ReturnType<typeof openStore>, owner: string, publisher: PublicationAdapter,
  stopped: () => boolean = () => false,
  diagnose?: (error: unknown, job: Job) => Promise<void>,
): Promise<'idle' | 'handled' | 'lost-lease'> {
  if (stopped()) return 'lost-lease';
  const job = store.claim(owner);
  if (!job) return 'idle';
  const ownsLease = () => !stopped() && store.heartbeat(owner);
  const assertLease = () => { if (!ownsLease()) throw new AttentionRequired('실행기 연결이 중단되었습니다.'); };
  let submitted = false;
  try {
    if (job.kind === 'connect') {
      const categories = await publisher.categories(job.snapshot.blog);
      assertLease();
      store.setSettings({ ...store.settings(), categories, connection: '연결됨', checkedAt: new Date().toISOString() });
      store.updateJob(job.id, 'succeeded', `연결 완료 · 카테고리 ${categories.length}개`);
    } else if (job.kind === 'verify' || job.snapshot.postUrl || job.result || job.snapshot.candidatePostUrl) {
      const url = await publisher.verify(job);
      assertLease();
      store.recordPost(job.id, url);
      store.updateJob(job.id, 'succeeded', '기존 글 제목·본문·비공개·카테고리·사진 확인 완료', url);
    } else {
      const url = await publisher.publish(job, (step, postUrl, imagePaths) => {
        assertLease();
        // This durable boundary precedes the external save click.
        store.updateJob(job.id, 'running', step);
        if (imagePaths) store.recordImagePaths(job.id, imagePaths);
        if (postUrl) store.recordPost(job.id, postUrl);
        if (step === '저장 요청') submitted = true;
      });
      assertLease();
      store.recordPost(job.id, url);
      store.updateJob(job.id, 'succeeded', '비공개 저장 · 다시 열어 본문과 사진 순서 확인 완료', url);
    }
  } catch (error) {
    if (!ownsLease()) return 'lost-lease';
    // Durable recovery state must not depend on best-effort diagnostic I/O.
    const current = store.job(job.id);
    const knownUrl = current.snapshot.postUrl || current.result;
    if (submitted && !knownUrl) store.updateJob(job.id, 'unknown', '저장 요청 이후 결과를 확정하지 못했습니다. 글 관리에서 확인하세요.');
    else if (error instanceof LoginRequired) {
      store.updateJob(job.id, 'needs_login', error.message, knownUrl);
      store.setSettings({ ...store.settings(), connection: '로그인 필요' });
    } else if (error instanceof AttentionRequired || knownUrl || job.kind === 'verify' || job.snapshot.candidatePostUrl) {
      store.updateJob(job.id, 'needs_attention', error instanceof AttentionRequired ? error.message : '기존 글 확인을 완료하지 못했습니다. 주소와 로그인 상태를 확인하고 다시 검사하세요.', knownUrl);
    } else store.updateJob(job.id, 'failed', '브라우저 작업에 실패했습니다. Chrome이 열려 있는지, P0 실행기가 함께 켜져 있지 않은지 확인하세요.');
    await diagnose?.(error, job).catch(() => {});
  }
  return 'handled';
}
