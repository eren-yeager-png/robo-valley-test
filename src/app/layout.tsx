
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoboValley | Sign Up",
  description: "Create your RoboValley account",
};

// Every page: the width of the device, normal zoom, and pinch zoom left on (no maximum-scale, no user-scalable=no).
// viewport-fit=cover lets the safe-area insets (iPhone notch and home bar) reach the CSS: env(safe-area-inset-*) in globals.css.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

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
