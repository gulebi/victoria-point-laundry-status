export const THEME_KEY = 'laundry-theme';
export const DARK_SCHEME = '(prefers-color-scheme: dark)';

export const themeBootstrap = `(() => {
  let preference;
  try { preference = localStorage.getItem(${JSON.stringify(THEME_KEY)}); } catch {}
  const systemTheme = matchMedia(${JSON.stringify(DARK_SCHEME)}).matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = preference === 'light' || preference === 'dark'
    ? preference : systemTheme;
})();`;
