import localFont from "next/font/local";

import type { Metadata } from "next";

import { Toaster } from "@/components/ui/sonner";
import "@/styles/globals.css";

const dmSans = localFont({
  src: [
    {
      path: "../../fonts/dm-sans/DMSans-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../fonts/dm-sans/DMSans-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../fonts/dm-sans/DMSans-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../fonts/dm-sans/DMSans-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-dm-sans",
  display: "swap",
});

const interTight = localFont({
  src: "../../fonts/inter-tight/InterTight-Variable.ttf",
  variable: "--font-inter-tight",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Structor — Plan the system before you write the code.",
    template: "%s · Structor",
  },
  description:
    "Define components, relationships, requirements, and decisions in one software architecture.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${interTight.variable} antialiased`}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
