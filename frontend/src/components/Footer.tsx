import { useAnalyticsSummary } from '../api/hooks';

export default function Footer() {
  const { data: analytics } = useAnalyticsSummary();

  const lastUpdate = analytics?.lastDataUpdate
    ? new Date(analytics.lastDataUpdate).toUTCString().slice(0, 22) + ' UTC'
    : 'Active Feed';

  return (
    <div className="absolute bottom-6 left-24 right-6 z-40 flex justify-between items-end pointer-events-none">
      {/* Temporal Scrubber */}
      <div className="glass-panel rounded-full px-6 py-3 flex items-center gap-6 pointer-events-auto shadow-[0_4px_24px_rgba(0,0,0,0.4)]">
        <button className="text-on-surface-variant hover:text-primary transition-colors flex items-center justify-center">
          <span className="material-symbols-outlined">play_arrow</span>
        </button>
        <div className="flex flex-col gap-2 w-64">
          <div className="flex justify-between items-center w-full">
            <span className="font-label-sm text-[10px] text-outline-variant">T-12H</span>
            <span className="font-label-sm text-xs text-primary font-bold">LIVE</span>
          </div>
          <div className="w-full h-1 bg-surface-container-highest rounded-full relative">
            <div className="absolute right-0 top-0 h-full w-2/3 bg-gradient-to-r from-transparent to-primary rounded-full" />
            <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-primary rounded-full shadow-[0_0_8px_#a1dfff]" />
          </div>
        </div>
      </div>

      {/* System Status / Footer Data */}
      <div className="glass-panel rounded-lg px-4 py-2 flex gap-6 items-center pointer-events-auto border-l-2 border-l-secondary">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-secondary rounded-full shadow-[0_0_5px_#91d963]" />
          <span className="font-label-sm text-[10px] text-on-surface-variant uppercase">Real-time</span>
        </div>
        <div className="w-px h-3 bg-outline-variant" />
        <span className="font-label-sm text-[10px] text-on-surface-variant uppercase">
          {analytics?.totalHotspots || 0} Events
        </span>
        <div className="w-px h-3 bg-outline-variant" />
        <span className="font-label-sm text-[10px] text-on-surface-variant uppercase">
          {lastUpdate}
        </span>
      </div>
    </div>
  );
}
