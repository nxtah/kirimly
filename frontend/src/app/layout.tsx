import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: "Kirimly — Broadcast WhatsApp Multi-Akun Tanpa Banned",
  icons: { icon: { url: "/logo-kirimly.png", sizes: "512x512", type: "image/png" } },
  description: "Kirim broadcast WhatsApp ke ratusan kontak tanpa kena banned. Multi-tenant, delay otomatis, tracking real-time.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id" className={`${inter.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
