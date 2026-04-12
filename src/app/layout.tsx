import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "谁是卧底组局工具",
  description: "支持人数配置、词库管理与 Grok 词条生成的谁是卧底 Web 应用",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <Script 
          defer 
          src="https://cloud.umami.is/script.js" 
          data-website-id="f3bea32c-328c-4bf2-86f1-6d89fab43cd2"
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
