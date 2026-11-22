'use client';

import { useEffect, useRef, useState } from 'react';
import { DARK_SCHEME, THEME_KEY } from '../lib/theme.mjs';
import { MoonIcon, SunIcon } from './icons';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const preference = useRef(null);

  function applyTheme(theme) {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const background = getComputedStyle(root).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background);
    setDark(theme === 'dark');
  }

  useEffect(() => {
    const system = window.matchMedia(DARK_SCHEME);
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === 'light' || stored === 'dark') preference.current = stored;
    } catch { /* Follow the system until a theme is chosen for this tab. */ }

    const update = () => applyTheme(preference.current ?? (system.matches ? 'dark' : 'light'));
    update();
    system.addEventListener('change', update);
    return () => system.removeEventListener('change', update);
  }, []);

  function toggle() {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    preference.current = theme;
    applyTheme(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* Keep the choice for this tab. */ }
  }

  return <button type="button" className="theme-toggle" aria-label="Dark theme" aria-pressed={dark}
    title={dark ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggle}>
    <MoonIcon/>
    <SunIcon/>
  </button>;
}
