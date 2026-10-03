import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Peppes Route Optimizer",
  description:
    "Pizza delivery route optimizer for Peppes Pizza. Batch orders into trips and dispatch drivers from Hellinga 3.",
  appleWebApp: {
    capable: true,
    title: "Peppes Routes",
    statusBarStyle: "black",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0E0E10",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
