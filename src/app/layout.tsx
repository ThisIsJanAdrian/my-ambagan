import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "MyAmbagan", description: "Split shared expenses with your group." };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, background: "#fafafa" }}>
        <main style={{ maxWidth: 420, margin: "0 auto", padding: 20 }}>{children}</main>
      </body>
    </html>
  );
}
