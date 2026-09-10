import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '글담 · Tistory Studio', description: '내 컴퓨터에서 준비하는 티스토리 원고' };
export default function Layout({ children }: { children: React.ReactNode }) { return <html lang="ko"><body>{children}</body></html>; }
