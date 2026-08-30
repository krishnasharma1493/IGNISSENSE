export type PageTab = 'dashboard' | 'map' | 'alerts' | 'analytics';

interface SideNavBarProps {
  activeTab: PageTab;
  onTabChange: (tab: PageTab) => void;
  onExportDossier?: () => void;
}

const NAV_ITEMS: { tab: PageTab; icon: string; label: string }[] = [
  { tab: 'dashboard', icon: 'dashboard', label: 'Dashboard' },
  { tab: 'map', icon: 'map', label: 'GIS Map' },
  { tab: 'alerts', icon: 'warning', label: 'Alerts' },
  { tab: 'analytics', icon: 'analytics', label: 'Analytics' },
];

const FOOTER_ITEMS = [
  { icon: 'help', label: 'Support' },
  { icon: 'history', label: 'Logs' },
];

export default function SideNavBar({
  activeTab,
  onTabChange,
  onExportDossier,
}: SideNavBarProps) {
  return (
    <nav
      aria-label="Sidebar Navigation"
      className="absolute top-[96px] left-6 z-50 flex flex-col gap-2 liquid-glass-structural rounded-2xl p-2 pointer-events-auto"
    >
      {/* Brand Emblem */}
      <div className="w-11 h-11 rounded-xl liquid-glass-interactive flex items-center justify-center p-2 mb-1 border-b border-white/10 bg-slate-950/40">
        <img
          src="/logo-white.png"
          alt="IGNISSENSE"
          className="w-full h-full object-contain filter drop-shadow-[0_0_6px_rgba(56,189,248,0.6)]"
        />
      </div>

      {/* Main Nav Items */}
      <div className="flex flex-col gap-2 mb-2">
        {NAV_ITEMS.map(({ tab, icon, label }) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`liquid-btn w-11 h-11 rounded-xl flex items-center justify-center relative group ${
              activeTab === tab
                ? 'liquid-glass-interactive bg-primary/20 text-primary border-t border-white/40 shadow-[0_2px_14px_rgba(112,210,255,0.25)]'
                : 'text-on-surface-variant hover:bg-white/10 hover:text-white'
            }`}
            title={label}
          >
            <span
              className="material-symbols-outlined text-[21px]"
              style={activeTab === tab ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              {icon}
            </span>
            {/* Alert badge */}
            {tab === 'alerts' && (
              <div className="absolute top-2 right-2 w-2 h-2 bg-industrial-fire rounded-full shadow-[0_0_6px_#ef4444]" />
            )}
            {/* Hover tooltip */}
            <span className="absolute left-14 px-2.5 py-1.5 liquid-glass-contextual rounded-xl sf-metadata text-[10px] uppercase font-bold text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-150 whitespace-nowrap z-50 shadow-xl">
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="w-6 h-px bg-white/10 mx-auto my-1" />

      {/* Footer Nav Items */}
      <div className="flex flex-col gap-2">
        {FOOTER_ITEMS.map(({ icon, label }) => (
          <button
            key={icon}
            className="liquid-btn w-11 h-11 rounded-xl text-on-surface-variant hover:bg-white/10 hover:text-white flex items-center justify-center relative group"
            title={label}
          >
            <span className="material-symbols-outlined text-[20px]">{icon}</span>
            <span className="absolute left-14 px-2.5 py-1.5 liquid-glass-contextual rounded-xl sf-metadata text-[10px] uppercase font-bold text-white opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-150 whitespace-nowrap z-50 shadow-xl">
              {label}
            </span>
          </button>
        ))}

        {/* Export Dossier */}
        {onExportDossier && (
          <button
            onClick={onExportDossier}
            className="liquid-btn w-11 h-11 rounded-xl text-primary hover:bg-primary/20 flex items-center justify-center relative group"
            title="Export Dossier"
          >
            <span className="material-symbols-outlined text-[20px]">download</span>
            <span className="absolute left-14 px-2.5 py-1.5 liquid-glass-contextual rounded-xl sf-metadata text-[10px] uppercase font-bold text-primary opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-150 whitespace-nowrap z-50 shadow-xl">
              Export Dossier
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}

