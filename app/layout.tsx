import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Дуут AI Туслагч",
  description: "Ахмад настнуудад зориулсан дуут хиймэл оюун туслагч",
  manifest: "/manifest.json", // ЭНЭ МӨРИЙГ НЭМНЭ
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="mn">
      <body className="antialiased">{children}</body>
    </html>
  );
}
