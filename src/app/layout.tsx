import type { Metadata } from "next";
import { Geist_Mono, Open_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const openSans = Open_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-open-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export function generateMetadata(): Metadata {
  return { title: process.env.PRODUCT_NAME ?? "ProductName" };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${openSans.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
