import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Copilot UBB Budget Monitor",
  description: "Monitor real-time GitHub Copilot Enterprise budget controls and consumption",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
