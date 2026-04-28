import React from 'react';
import './globals.css';

export const metadata = {
  title: 'CUSAT CBT Portal',
  description: 'AI-Powered Exam Interface',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
