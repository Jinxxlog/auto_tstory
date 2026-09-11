import { load } from 'cheerio';
import { normalizeBlogUrl } from '../tistory/url';

export function postUrl(value: string, blog: string) {
  const url = new URL(value); const origin = normalizeBlogUrl(blog);
  if (url.origin !== origin || url.username || url.password || !(/^\/\d+\/?$/.test(url.pathname) || /^\/entry\/[^/]+\/?$/.test(url.pathname))) throw new Error('설정한 티스토리 블로그의 개별 공개 글 URL을 입력하세요.');
  url.search=''; url.hash=''; return url.href;
}
async function getHtml(url: string, blog: string) {
  let next = postUrl(url, blog); const signal=AbortSignal.timeout(15000);
  for(let attempt=0;attempt<3;attempt++) {
    const response=await fetch(next,{redirect:'manual',signal,headers:{Accept:'text/html'}});
    if(response.status>=300 && response.status<400) { const target=response.headers.get('location'); await response.body?.cancel(); if(!target)throw new Error('리디렉션 주소가 없습니다.');next=postUrl(new URL(target,next).href,blog);continue; }
    if(!response.ok || !response.headers.get('content-type')?.includes('text/html')) {await response.body?.cancel();throw new Error('공개 글을 읽지 못했습니다. 본문을 직접 붙여넣어주세요.');}
    const reader=response.body?.getReader();if(!reader)throw new Error('본문 응답이 없습니다.');const chunks:Uint8Array[]=[];let size=0;
    while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>2_000_000){await reader.cancel();throw new Error('페이지가 너무 큽니다. 본문을 직접 붙여넣어주세요.');}chunks.push(chunk.value);}
    return {html:Buffer.concat(chunks).toString('utf8'),url:next};
  } throw new Error('리디렉션이 반복됩니다. 본문을 직접 붙여넣어주세요.');
}
export function extractArticle(html: string) {
  const $=load(html); const article=$('.tt_article_useless_p_margin, .contents_style, #article-view').first();
  if(!article.length)throw new Error('이 스킨의 본문 영역을 찾지 못했습니다. 본문을 직접 붙여넣어주세요.');
  article.find('script,style,iframe,nav,aside,form,button,.adsbygoogle,.revenue_unit_wrap,.container_postbtn,.another_category,.tt_adsense_bottom,.tt_adsense_top').remove();
  article.find('img').replaceWith('\n[사진]\n'); article.find('br').replaceWith('\n');
  article.find('h1,h2,h3,h4,p,div,li,pre,tr,blockquote,figcaption').each((_,el)=>{ $(el).prepend('\n').append('\n'); });
  const body=article.text().replace(/[\t ]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  if(body.length<80 || body.length>50000)throw new Error('본문 길이가 분석 범위(80~50,000자)에 맞지 않습니다. 직접 붙여넣어 확인하세요.');
  const title=($('meta[property="og:title"]').attr('content') || $('h1').first().text() || $('title').text()).trim().slice(0,200);
  return {title,body};
}
export async function importPost(url: string, blog: string) { const result=await getHtml(url,blog);return {...extractArticle(result.html),url:result.url}; }
