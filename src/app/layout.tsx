import type { Metadata } from "next";
import { Geist, Geist_Mono, Outfit, Gasoek_One } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const gasoekOne = Gasoek_One({
  variable: "--font-gasoek",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Movie Night",
  description: "Watch something together. Voice + video call with tab-sharing.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${outfit.variable} ${gasoekOne.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
