import type { openStore } from '../../lib/store';
import { aiStore } from '../../lib/ai-store';
import { CodexClient, CodexError } from './codex';
import { styleStore } from '../../lib/style-store';
import { photoAnalysisStore } from '../../lib/photo-analysis';

export class AiRunner {
  private client = new CodexClient();
  private active?: AbortController;
  private lastPoll = 0;
  private loginStarted = 0;
  readonly store;
  readonly styles;
  readonly photos;
  constructor(store: ReturnType<typeof openStore>) { this.store = aiStore(store); this.store.recover(); this.styles=styleStore(store);this.styles.recover(); this.photos = photoAnalysisStore(store); this.photos.recover(); }
  async tick() {
    const ai = this.store; const connection = ai.connection();
    if (connection.state === 'connecting' || (connection.state === 'login' && Date.now()-this.lastPoll > 5000)) {
      this.lastPoll = Date.now();
      try {
        const status = await this.client.status();
        if (status.state === 'connected') ai.setConnection(status);
        else if (connection.state === 'connecting') { const authUrl = await this.client.login(); this.loginStarted = Date.now(); ai.setConnection({ state: 'login', authUrl, models: [], message: '공식 로그인 화면에서 ChatGPT 계정으로 로그인하세요.' }); }
        else if (Date.now()-this.loginStarted > 10*60000) ai.setConnection({ state: 'disconnected', models: [], message: '로그인 대기 시간이 끝났습니다. 다시 연결하세요.' });
      } catch (error) { ai.setConnection({ state: 'error', models: [], message: error instanceof CodexError ? error.message : 'ChatGPT 연결을 확인하지 못했습니다.' }); }
      return true;
    }
    const analysis=this.styles.jobs().reverse().find(j=>j.state==='queued');
    if(analysis){
      const styles=this.styles;styles.put({...analysis,state:'running',step:'대표 글의 문체·구조 분석 중',attempts:analysis.attempts+1});
      const controller=new AbortController();this.active=controller;
      const timer=setInterval(()=>{if(styles.job(analysis.id).cancel)controller.abort();},300);
      try{const result=await this.client.analyze(analysis,controller.signal);styles.finish(analysis.id,result.output,result.usage);}
      catch(error){const current=styles.job(analysis.id);styles.put({...current,state:current.cancel?'cancelled':'failed',step:current.cancel?'분석을 취소했습니다.':error instanceof CodexError?error.message:'문체 분석 결과 형식을 확인하지 못했습니다.'});}
      finally{clearInterval(timer);this.active=undefined;}return true;
    }
    const photoJob = this.photos.jobs().reverse().find(job => job.state === 'queued');
    if (photoJob) {
      this.photos.put({ ...photoJob, state: 'running', message: '선택한 사진 분석 중' });
      const controller = new AbortController(); this.active = controller;
      const timer = setInterval(() => { if (this.photos.get(photoJob.id).cancel) controller.abort(); }, 300);
      try { const result = await this.client.analyzePhotos(photoJob, controller.signal); this.photos.finish(photoJob.id, result.output, result.usage); }
      catch { const current = this.photos.get(photoJob.id); this.photos.put({ ...current, state: current.cancel ? 'cancelled' : 'failed', message: current.cancel ? '사진 분석 취소됨' : '사진 분석 실패 · 연결·한도·결과 형식을 확인하세요. 자동 재요청하지 않습니다.' }); }
      finally { clearInterval(timer); this.active = undefined; } return true;
    }
    const job = ai.jobs().reverse().find(j => j.state === 'queued'); if (!job) return false;
    ai.put({ ...job, state: 'running', step: job.selection ? '선택 구간 재작성 중' : '요약·사진으로 개요와 본문 생성 중', attempts: job.attempts+1 });
    const controller = new AbortController(); this.active = controller;
    const cancellation = setInterval(() => { if (ai.job(job.id).cancel) controller.abort(); }, 300);
    try { const result = await this.client.generate(job, controller.signal); ai.finish(job.id, result.output, result.usage); }
    catch (error) { const current = ai.job(job.id); ai.put({ ...current, state: current.cancel ? 'cancelled' : 'failed', step: current.cancel ? '생성을 취소했습니다. 이미 사용된 구독 한도는 반환되지 않을 수 있습니다.' : error instanceof CodexError ? error.message : '생성 결과 형식 검증에 실패했습니다. 기존 원고는 유지됩니다.' }); }
    finally { clearInterval(cancellation); this.active = undefined; }
    return true;
  }
  close() { this.active?.abort(); this.client.close(); }
}
