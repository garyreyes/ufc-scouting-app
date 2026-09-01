import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/shared/components/AppShell";
import { JobHealthBanner } from "@/features/job-health/components/JobHealthBanner";
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
  title: "UFC Scouting",
  description: "UFC fighter catalog and scouting reports",
};

// Runs before paint so a stored "light" preference doesn't flash dark first.
const THEME_INIT_SCRIPT = `
  if (localStorage.getItem("theme") === "light") {
    document.documentElement.dataset.theme = "light";
  }
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AppShell banner={<JobHealthBanner />}>{children}</AppShell>
      </body>
    </html>
  );
}
