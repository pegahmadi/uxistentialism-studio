import type { Metadata } from "next";
import { Libre_Baskerville, Inter, Source_Code_Pro } from "next/font/google";
import "./globals.css";

// Three type roles from the v3 doctrine: serif for headlines & manuscript,
// sans for the interface, mono for marks & the status strip.
const libre = Libre_Baskerville({
  variable: "--font-libre",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const scp = Source_Code_Pro({
  variable: "--font-scp",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "UXistentialism Studio",
  description: "An operating system for intellectual work.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${libre.variable} ${inter.variable} ${scp.variable} h-full antialiased`}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
