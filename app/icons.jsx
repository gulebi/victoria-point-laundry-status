// Tabler Icons, MIT. See public/licenses/tabler-icons.txt.
function Icon({ size, className, children }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    {children}
  </svg>;
}

export function WashMachineIcon() {
  return <Icon size={25}>
    <path d="M5 5a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2l0 -14"/>
    <path d="M8 14a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"/>
    <path d="M8 6h.01M11 6h.01M14 6h2"/>
    <path d="M8 14c1.333 -.667 2.667 -.667 4 0c1.333 .667 2.667 .667 4 0"/>
  </Icon>;
}

export function RefreshIcon({ spinning }) {
  return <Icon size={17} className={spinning ? 'spin' : undefined}>
    <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/>
    <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>
  </Icon>;
}

export function InfoCircleIcon() {
  return <Icon size={16} className="info-mark">
    <path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0"/>
    <path d="M12 9h.01M11 12h1v4h1"/>
  </Icon>;
}

export function MoonIcon() {
  return <Icon size={20} className="theme-moon">
    <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008"/>
  </Icon>;
}

export function SunIcon() {
  return <Icon size={20} className="theme-sun">
    <path d="M8 12a4 4 0 1 0 8 0a4 4 0 0 0 -8 0"/>
    <path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7"/>
  </Icon>;
}
