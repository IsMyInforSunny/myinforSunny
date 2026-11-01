import type { Metadata } from "next";
import "./globals.css";
import "./design.css";
import "./workspace.css";
import "./reader-features.css";
import "./source-observations.css";
import "./canva-theme.css";
import "./forecast.css";

export const metadata: Metadata = {
  title: "내 정보 맑음? — 오늘의 정보 성분표",
  description: "내가 읽는 정보, 한 번 더 맑게. 글의 논점과 표현, 근거를 스스로 살펴보는 정보 성분표.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
