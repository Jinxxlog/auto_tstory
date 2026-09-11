import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openStore} from '../src/lib/store';
import {styleStore} from '../src/lib/style-store';
import {aiStore} from '../src/lib/ai-store';
import {extractArticle,postUrl} from '../src/services/style/import';
import {snapshot,parseStyle} from '../src/services/style/content';
import {prompt} from '../src/services/ai/content';
test('article extraction excludes navigation and injected markup; URL import stays on configured public posts',()=>{
 const text='문장 끝맺음과 예제를 통해 개념을 설명합니다. '.repeat(8);
 const result=extractArticle(`<html><head><meta property="og:title" content="원문 제목"></head><body><nav>메뉴</nav><div class="contents_style"><h2>개념</h2><p>${text}</p><pre>const x = 1;\nconsole.log(x);</pre><img src="secret"><script>위험</script><div class="another_category">다른 글</div><iframe>광고</iframe></div><aside>댓글</aside></body></html>`);
 assert.equal(result.title,'원문 제목');assert.match(result.body,/\[사진\]/);assert.match(result.body,/const x = 1;\nconsole.log/);assert.doesNotMatch(result.body,/메뉴|위험|광고|다른 글|댓글|secret/);
 assert.equal(postUrl('https://example.tistory.com/entry/test?tracking=1#x','https://example.tistory.com'),'https://example.tistory.com/entry/test');
 for(const url of ['http://example.tistory.com/1','https://example.tistory.com/manage','https://127.0.0.1/1','https://evil.test/1','https://u:p@example.tistory.com/1'])assert.throws(()=>postUrl(url,'https://example.tistory.com'));
 assert.throws(()=>extractArticle('<body>본문 선택자 없음</body>'));
});
test('style revisions and source snapshots cannot mutate queued generation; wrong kinds and stale edits are rejected',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'tstory-style-'));const store=openStore(root);const styles=styleStore(store);const ai=aiStore(store);
 try{
 const source=styles.saveSource({title:'예시',body:'먼저 개념부터 살펴보겠습니다. 간단한 예제로 동작을 확인합니다. '.repeat(5),url:'',kind:'technical',origin:'manual'});
 const analysis=styles.enqueue([source.id],'test','공통 문체','common');styles.put({...analysis,state:'running',attempts:1});styles.finish(analysis.id,{rules:'문장 끝은 입니다로 마무리하고, 짧은 소제목 다음에 예제를 배치합니다.',observations:['예시 글에서 존댓말 확인'],warnings:['대표 글 한 편만 분석']});
 const profile=styles.saveProfile({version:0,jobId:analysis.id,name:'공통 문체',kind:'common',rules:styles.job(analysis.id).output!.rules});
 ai.setConnection({state:'connected',message:'',models:[{id:'test',name:'test',images:true,isDefault:true}]});
 const draft=store.saveDraft({id:'',version:0,title:'프로젝트',kind:'project',summary:'실제 구현한 원고 저장과 사진 관리 기능을 설명하는 프로젝트입니다.',markdown:'',images:[],cover:null,category:''});
 const queued=ai.enqueue(draft.id,'test','','',profile.id);assert.equal(queued.style?.version,1);assert.equal(queued.style?.examples.length,1);
 const updated=styles.saveProfile({...profile,rules:'문장 끝은 해요로 마무리하고, 짧은 소제목 뒤에 예제를 배치합니다.'});assert.equal(updated.version,2);assert.throws(()=>styles.saveProfile(profile),/변경/);
 styles.saveSource({...source,body:'수정된 원문의 새 문장입니다. '.repeat(10)});styles.removeSource(source.id);
 assert.equal(ai.job(queued.id).style?.rules,profile.rules);assert.equal(ai.job(queued.id).style?.examples[0].body,source.body);assert.equal(styles.history(profile.id).length,2);
 assert.match(prompt(queued),/사실·경험/);assert.match(prompt(queued),/문체 자료/);
 assert.throws(()=>snapshot({...profile,kind:'ps'},'project'),/유형/);assert.throws(()=>parseStyle('{"rules":"짧음"}'));
 }finally{store.db.close();await rm(root,{recursive:true,force:true});}
});
