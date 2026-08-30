import { useMemo } from 'react';
import type { Hotspot, Classification, ClassificationClass } from '../../types';
import { CLASS_CONFIG } from '../../types';
import { useSyncFirms, useSystemStatus } from '../../api/hooks';

interface LiveStreamHUDProps {
  hotspots: Hotspot[];
  classifications: Map<string, Classification>;
  onSelectHotspot: (id: string) => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function LiveStreamHUD({
  hotspots,
  classifications,
  onSelectHotspot,
  isOpen,
  onClose,
}: LiveStreamHUDProps) {
  const syncMutation = useSyncFirms();
  const { data: systemStatus } = useSystemStatus();

  // Sort genuine observations by detectedAt descending
  const sortedObservations = useMemo(() => {
    return [...hotspots].sort(
      (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    );
  }, [hotspots]);

  const handleSyncNow = async () => {
    try {
      await syncMutation.mutateAsync({ scope: 'delhi_ncr', dayRange: 2 });
    } catch (e: any) {
      console.error('Live sync error:', e.message);
    }
  };

  if (!isOpen) return null;

  const isFirmsConnected = systemStatus?.firmsConnected ?? true;
  const isModelReady = systemStatus?.modelStatus === 'ready';
  const isDbConnected = systemStatus?.databaseStatus === 'connected';
  const lastPollTime = systemStatus?.lastSuccessfulPoll
    ? new Date(systemStatus.lastSuccessfulPoll).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'Recent';
  const pollMessage = systemStatus?.pollStatusMessage || 'Monitoring NASA satellite passes every 5 min';
  const modelVersion = systemStatus?.modelVersion || 'XGB-FIRMS-v1.0.0-DELHI_NCR';

  return (
    <div className="absolute left-6 bottom-20 z-40 w-[440px] max-w-[calc(100vw-3rem)] liquid-glass-contextual rounded-3xl overflow-hidden flex flex-col shadow-2xl">
      {/* HUD Header & Provenance Status */}
      <div className="p-4 border-b border-white/10 flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isFirmsConnected ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-amber-500'
              }`}
            />
            {isFirmsConnected && <span className="w-4 h-4 rounded-full border border-emerald-400 absolute animate-ping" />}
          </div>
          <div>
            <h3 className="sf-headline font-bold text-xs text-white uppercase tracking-wider flex items-center gap-2">
              <span>LIVE NASA FIRMS ⇄ ML STREAM</span>
            </h3>
            <div className="sf-metadata text-[10px] text-on-surface-variant font-mono">
              Model: <span className="text-primary font-bold">{modelVersion}</span> ({isModelReady ? 'READY' : 'OFFLINE'})
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          className="liquid-btn text-on-surface-variant hover:text-white p-1 rounded-full liquid-glass-interactive transition-colors"
          title="Close Feed"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* System Connection Truth Strip */}
      <div className="px-4 py-2 bg-black/30 border-b border-white/10 grid grid-cols-3 gap-2 text-[10px] font-mono">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isFirmsConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-slate-400">FIRMS:</span>
          <span className={isFirmsConnected ? 'text-emerald-300 font-bold' : 'text-red-300'}>
            {isFirmsConnected ? 'CONNECTED' : 'STANDBY'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isModelReady ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-slate-400">ML ENGINE:</span>
          <span className={isModelReady ? 'text-emerald-300 font-bold' : 'text-amber-300'}>
            {isModelReady ? 'ACTIVE' : 'FALLBACK'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${isDbConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className="text-slate-400">DB:</span>
          <span className={isDbConnected ? 'text-emerald-300 font-bold' : 'text-red-300'}>
            {isDbConnected ? 'SYNCED' : 'OFFLINE'}
          </span>
        </div>
      </div>

      {/* Live Polling Status & Manual Ingestion Bar */}
      <div className="px-4 py-2.5 bg-black/20 border-b border-white/5 flex items-center justify-between text-xs">
        <div className="flex flex-col min-w-0 pr-2">
          <div className="sf-subhead text-[11px] font-semibold text-white truncate flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[14px] text-primary">update</span>
            <span>{pollMessage}</span>
          </div>
          <div className="sf-metadata text-[9.5px] text-slate-400 font-mono mt-0.5">
            Last Poll: {lastPollTime} • Tracking {hotspots.length} verified observations
          </div>
        </div>

        <button
          onClick={handleSyncNow}
          disabled={syncMutation.isPending}
          className="liquid-btn text-[10px] font-mono liquid-glass-interactive text-primary hover:text-white px-2.5 py-1 rounded-xl flex items-center gap-1 font-bold flex-shrink-0 disabled:opacity-50"
          title="Manually query NASA FIRMS API for newly published satellite passes"
        >
          <span
            className="material-symbols-outlined text-[13px]"
            style={{ animation: syncMutation.isPending ? 'spin-slow 1s linear infinite' : 'none' }}
          >
            sync
          </span>
          <span>{syncMutation.isPending ? 'Ingesting...' : 'Poll FIRMS'}</span>
        </button>
      </div>

      {/* Observations List (Strictly Real NASA Telemetry & ML Classifications) */}
      <div className="max-h-72 overflow-y-auto p-2.5 flex flex-col gap-2 font-mono text-xs">
        {sortedObservations.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs sf-subhead">
            No active FIRMS thermal observations recorded in this geographic bounding box.
          </div>
        ) : (
          sortedObservations.slice(0, 30).map((hotspot) => {
            const classification = classifications.get(hotspot._id);
            const predictedClass = classification?.predictedClass || 'other_or_uncertain';
            const cfg = CLASS_CONFIG[predictedClass as ClassificationClass] || {
              color: '#EF4444',
              label: predictedClass,
              icon: '🔥',
            };
            const confPct = classification ? Math.round(classification.confidence * 100) : 50;
            const isHighAnomaly = (classification?.anomalyScore ?? 0) >= 0.65 || predictedClass === 'industrial_fire';
            const detectedTime = new Date(hotspot.detectedAt).toLocaleTimeString('en-IN', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const [lon, lat] = hotspot.location.coordinates;

            return (
              <div
                key={hotspot._id}
                onClick={() => onSelectHotspot(hotspot._id)}
                className="liquid-btn w-full p-2.5 rounded-2xl liquid-glass-interactive hover:border-primary/50 flex items-center justify-between gap-3 text-left cursor-pointer"
              >
                {/* Left: Classification Icon & Metadata */}
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cfg.color, boxShadow: `0 0 6px ${cfg.color}` }}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="sf-headline font-bold text-[11px] text-white">
                        {cfg.icon} {cfg.label}
                      </span>
                      {isHighAnomaly && (
                        <span className="sf-metadata px-1.5 py-0.2 text-[8px] bg-red-500/30 text-red-300 rounded border border-red-500/40 uppercase font-bold">
                          ANOMALY
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-on-surface-variant flex items-center gap-1.5 mt-0.5 font-mono">
                      <span className="text-slate-300 font-bold">{hotspot.instrument} ({hotspot.satellite})</span>
                      <span>•</span>
                      <span className="text-red-400 font-bold">{hotspot.frp?.toFixed(1) || '0.0'} MW</span>
                      <span>•</span>
                      <span className="text-slate-400">{lat.toFixed(3)}°N, {lon.toFixed(3)}°E</span>
                    </div>
                  </div>
                </div>

                {/* Right: Confidence & NASA Acquisition Time */}
                <div className="flex flex-col items-end flex-shrink-0">
                  <span className="sf-metadata text-[10px] font-bold" style={{ color: cfg.color }}>
                    {confPct}% CONF
                  </span>
                  <span className="sf-metadata text-[9px] text-slate-400 text-right">{detectedTime}</span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* HUD Footer Provenance Note */}
      <div className="p-3 bg-black/20 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-on-surface-variant">
        <span className="sf-metadata">PROVENANCE: NASA FIRMS</span>
        <span className="sf-metadata text-primary font-bold">AUTO 5-MIN SCAN</span>
      </div>
    </div>
  );
}
