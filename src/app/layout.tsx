import type { Metadata } from "next";
import { Geist_Mono, Open_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/motion/Toast";
import "./globals.css";

const openSans = Open_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-open-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export function generateMetadata(): Metadata {
  return { title: process.env.PRODUCT_NAME ?? "vidrev" };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${openSans.variable} ${geistMono.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
        <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-4 pb-6 text-sm text-muted-foreground">
          <a href="/help" className="text-muted-foreground">
            Help
          </a>
          <a href="/trust" className="text-muted-foreground">
            Trust and data
          </a>
          <a href="/data-deletion" className="text-muted-foreground">
            Data deletion
          </a>
        </footer>
      </body>
    </html>
  );
}
