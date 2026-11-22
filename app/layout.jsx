import './globals.css';

export const metadata = {
  title: 'victoria-point-laundry-status',
  description: 'Check washer and dryer availability at Victoria Point 4.',
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  icons: { icon: { url: '/icon.svg', type: 'image/svg+xml' } },
  appleWebApp: { capable: true, title: 'victoria-point-laundry-status', statusBarStyle: 'default' },
};
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#f5f6f2' };

export default function RootLayout({ children }) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
