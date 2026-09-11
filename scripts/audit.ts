import { auditData } from '../src/lib/audit';
import { dataRoot } from '../src/lib/store';

const report = await auditData(dataRoot);
console.log(`DB 무결성: ${report.integrity ? '정상' : '오류'}`);
console.log(`원고 ${report.counts.documents || 0}개 · 원고 버전 ${report.counts.draft_versions || 0}개 · 이미지 ${report.counts.assets || 0}개 · 블로그 작업 ${report.counts.jobs || 0}개`);
for (const finding of report.findings) console.log(`${finding.level === 'error' ? '오류' : '확인'} · ${finding.message} (${finding.count}건)`);
if (!report.findings.length) console.log('추가로 확인할 로컬 데이터 문제가 없습니다.');
if (report.findings.some(finding => finding.level === 'error')) process.exitCode = 1;
