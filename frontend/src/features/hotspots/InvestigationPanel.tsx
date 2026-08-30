import { CLASS_CONFIG, CLASSIFICATION_CLASSES } from '../../types';
import type { Classification, Hotspot } from '../../types';
import { useHotspotHistory } from '../../api/hooks';

interface InvestigationPanelProps {
  hotspot: Hotspot;
  classification: Classification | null;
  isLoading: boolean;
  onClose: () => void;
}

export default function InvestigationPanel({
  hotspot,
  classification,
  isLoading,
  onClose,
}: InvestigationPanelProps) {
  const cls = classification?.predictedClass || 'other_or_uncertain';
  const config = CLASS_CONFIG[cls];
  const confPercent = classification ? Math.round(classification.confidence * 100) : 0;
  const frpVal = hotspot.frp ? hotspot.frp.toFixed(1) : 'N/A';
  const brightVal = hotspot.brightness ? Math.round(hotspot.brightness) : 'N/A';

  // Fetch genuine historical satellite overpasses for this coordinate
  const { data: historyData, isLoading: historyLoading } = useHotspotHistory(hotspot._id);
  const historicalPasses = historyData?.points || [];

  // Format event code
  const eventId = `HS-${hotspot._id.slice(-6).toUpperCase()}`;

  // Grounded Anomaly & Persistence quantitative labels
  const anomalyScore = classification?.anomalyScore ?? 0.0;
  const persistenceScore = classification?.persistenceScore ?? 0.0;

  const anomalyLabel =
    anomalyScore >= 0.70 ? 'High' : anomalyScore >= 0.40 ? 'Medium' : 'Low';

  const persistenceLabel =
    persistenceScore >= 0.50 ? 'High' : persistenceScore >= 0.25 ? 'Medium' : 'Low';

  const contextLabel =
    classification?.landCover === 'built_up' || classification?.facilityDistanceMeters !== null
      ? 'Industrial'
      : classification?.landCover === 'forest'
      ? 'Wildland'
      : 'Agricultural';

  // Compute SVG polyline points from real historical FRP trajectory
  let svgPoints = '';
  let maxFrpInHistory = hotspot.frp || 10;
  if (historicalPasses.length >= 2) {
    const frpVals = historicalPasses.map((p) => p.frp);
    maxFrpInHistory = Math.max(...frpVals, 10);
    svgPoints = historicalPasses
      .map((p, i) => {
        const x = (i / (historicalPasses.length - 1)) * 100;
        const y = 90 - (p.frp / maxFrpInHistory) * 75;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  return (
    <aside className="absolute right-6 top-[80px] bottom-6 w-[420px] max-w-[calc(100vw-3rem)] liquid-glass-contextual rounded-3xl flex flex-col z-40 overflow-hidden shadow-2xl">
      {/* Drawer Header */}
      <div className="p-5 border-b border-white/10 flex justify-between items-start sticky top-0 bg-transparent z-10 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className="sf-metadata text-[10px] px-2.5 py-0.5 rounded-full border uppercase font-bold"
              style={{
                backgroundColor: `${config.color}22`,
                color: config.color,
                borderColor: `${config.color}55`,
              }}
            >
              {confPercent >= 70 ? 'AI CANDIDATE' : 'UNCERTAIN SIGNATURE'}
            </span>
            <span className="sf-metadata text-[11px] text-on-surface-variant font-mono font-bold">
              {confPercent}% Confidence
            </span>
          </div>
          <h2 className="sf-display text-xl font-black text-on-surface tracking-tight font-mono">
            Event #{eventId}
          </h2>
          <p className="sf-headline text-xs mt-0.5 font-bold" style={{ color: config.color }}>
            {config.label}
          </p>
        </div>
        <button
          onClick={onClose}
          className="liquid-btn text-on-surface-variant hover:text-white p-1.5 rounded-full liquid-glass-interactive transition-colors flex items-center justify-center"
          title="Close Drawer"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Drawer Content Scrollable */}
      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
        {isLoading ? (
          <div className="flex items-center justify-center p-8 gap-2 text-on-surface-variant sf-subhead text-xs">
            <span className="material-symbols-outlined animate-spin-slow text-primary text-[18px]">sync</span>
            <span>Running telemetry feature extraction...</span>
          </div>
        ) : (
          <>
            {/* Summary 3-Box Strip (Calculated from Real Features) */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="liquid-glass-interactive p-3 rounded-2xl flex flex-col items-center justify-center text-center">
                <span className="material-symbols-outlined text-industrial-fire mb-1 text-[18px]">
                  warning
                </span>
                <span className="sf-metadata text-[10px] text-on-surface-variant block uppercase font-bold">Anomaly</span>
                <span className="sf-headline text-xs text-on-surface font-mono font-bold mt-0.5">
                  {anomalyLabel} ({anomalyScore.toFixed(2)})
                </span>
              </div>
              <div className="liquid-glass-interactive p-3 rounded-2xl flex flex-col items-center justify-center text-center">
                <span className="material-symbols-outlined text-tertiary mb-1 text-[18px]">
                  timelapse
                </span>
                <span className="sf-metadata text-[10px] text-on-surface-variant block uppercase font-bold">Persistence</span>
                <span className="sf-headline text-xs text-on-surface font-mono font-bold mt-0.5">
                  {persistenceLabel} ({persistenceScore.toFixed(2)})
                </span>
              </div>
              <div className="liquid-glass-interactive p-3 rounded-2xl flex flex-col items-center justify-center text-center">
                <span className="material-symbols-outlined text-secondary mb-1 text-[18px]">
                  factory
                </span>
                <span className="sf-metadata text-[10px] text-on-surface-variant block uppercase font-bold">Context</span>
                <span className="sf-headline text-xs text-on-surface font-bold mt-0.5">{contextLabel}</span>
              </div>
            </div>

            {/* 1. Model Classification Probabilities */}
            <section className="liquid-glass-interactive p-4 rounded-2xl">
              <div className="flex justify-between items-center mb-3 pb-1 border-b border-white/10">
                <h3 className="sf-metadata text-[11px] uppercase font-bold text-slate-300">
                  1. Model Classification
                </h3>
                <span className="sf-metadata text-primary font-mono text-[10px] font-bold">
                  {classification?.modelVersion || 'XGB-PROD'}
                </span>
              </div>

              <div className="space-y-2.5">
                {CLASSIFICATION_CLASSES.map((c) => {
                  const prob = classification?.classProbabilities?.[c] || 0;
                  const cConfig = CLASS_CONFIG[c];
                  const pct = Math.round(prob * 100);
                  return (
                    <div key={c}>
                      <div className="flex justify-between sf-subhead text-xs mb-1">
                        <span className="text-on-surface text-[11px]">{cConfig.label}</span>
                        <span style={{ color: cConfig.color }} className="font-bold font-mono text-[11px]">
                          {pct}%
                        </span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-1.5 rounded-full transition-all duration-500"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: cConfig.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 2. Real Thermal Signal Telemetry */}
            <section className="liquid-glass-interactive p-4 rounded-2xl">
              <h3 className="sf-metadata text-[11px] uppercase font-bold text-slate-300 mb-3 pb-1 border-b border-white/10">
                2. Thermal Signal (NASA FIRMS)
              </h3>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                  <span className="sf-metadata text-[10px] text-on-surface-variant block mb-1 uppercase font-bold">
                    Observed FRP
                  </span>
                  <span className="sf-display text-lg text-on-surface font-mono font-bold text-red-400">
                    {frpVal} MW
                  </span>
                </div>
                <div className="bg-black/30 p-3 rounded-xl border border-white/5">
                  <span className="sf-metadata text-[10px] text-on-surface-variant block mb-1 uppercase font-bold">
                    Brightness (K)
                  </span>
                  <span className="sf-display text-lg text-on-surface font-mono font-bold">
                    {brightVal} K
                  </span>
                </div>
                <div className="col-span-2 bg-black/30 p-3 rounded-xl border border-white/5 flex flex-col gap-1">
                  <div className="flex justify-between items-center sf-subhead text-xs">
                    <span className="text-on-surface-variant">Sensor Instrument</span>
                    <span className="text-on-surface font-bold">
                      {hotspot.instrument} ({hotspot.satellite})
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-[10.5px] text-on-surface-variant font-mono mt-0.5">
                    <span>Acquisition: {new Date(hotspot.detectedAt).toUTCString().slice(0, 22)} UTC</span>
                    <span>{hotspot.dayNight === 'D' ? '☀️ Day Pass' : '🌙 Night Pass'}</span>
                  </div>
                </div>
              </div>
            </section>

            {/* 3. Spatial Context & 4. Grounded Evidence */}
            <section className="space-y-4">
              <div className="liquid-glass-interactive p-4 rounded-2xl">
                <h3 className="sf-metadata text-[11px] uppercase font-bold text-slate-300 mb-3 pb-1 border-b border-white/10">
                  3. Spatial Infrastructure Context (OSM)
                </h3>
                <div className="flex items-start gap-2.5">
                  <span className="material-symbols-outlined text-secondary mt-0.5 text-[18px]">
                    location_on
                  </span>
                  <div>
                    <p className="sf-headline text-xs text-on-surface font-bold">
                      {classification?.nearestFacilityId
                        ? typeof classification.nearestFacilityId === 'object'
                          ? (classification.nearestFacilityId as any).name
                          : 'OpenStreetMap Industrial Facility'
                        : 'No Industrial Infrastructure Within 25km'}
                    </p>
                    <p className="sf-metadata text-[10.5px] text-on-surface-variant mt-1 font-mono">
                      {classification?.facilityDistanceMeters !== null && classification?.facilityDistanceMeters !== undefined
                        ? `Distance: ${classification.facilityDistanceMeters}m from centroid`
                        : `Coordinates: ${hotspot.location.coordinates[1].toFixed(4)}° N, ${hotspot.location.coordinates[0].toFixed(4)}° E`}
                    </p>
                  </div>
                </div>
              </div>

              <div className="liquid-glass-interactive p-4 rounded-2xl">
                <h3 className="sf-metadata text-[11px] uppercase font-bold text-slate-300 mb-3 pb-1 border-b border-white/10">
                  4. Grounded Evidence Flags
                </h3>
                <ul className="space-y-2 sf-subhead text-xs text-on-surface">
                  {classification && classification.explanation && classification.explanation.length > 0 ? (
                    classification.explanation.map((e, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-primary text-[15px] mt-0.5 flex-shrink-0">
                          check_circle
                        </span>
                        <span className="text-[11.5px] leading-relaxed">{e}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-on-surface-variant text-xs">
                      No feature explanation available for this observation
                    </li>
                  )}
                </ul>
              </div>
            </section>

            {/* 5. Real FRP Timeline Sparkline */}
            <section className="liquid-glass-interactive p-4 rounded-2xl">
              <div className="flex justify-between items-center mb-3 pb-1 border-b border-white/10">
                <h3 className="sf-metadata text-[11px] uppercase font-bold text-slate-300">
                  5. Historical FRP Trajectory
                </h3>
                <span className="sf-metadata text-primary font-mono text-[10.5px] font-bold">
                  {historicalPasses.length} Overpasses
                </span>
              </div>

              {historyLoading ? (
                <div className="h-24 rounded-xl bg-black/30 flex items-center justify-center text-xs text-on-surface-variant sf-subhead">
                  Loading historical passes...
                </div>
              ) : historicalPasses.length < 2 ? (
                <div className="h-24 rounded-xl bg-black/30 flex flex-col items-center justify-center p-3 text-center">
                  <span className="material-symbols-outlined text-tertiary mb-1 text-[20px]">history_toggle_off</span>
                  <span className="sf-subhead text-xs text-on-surface-variant font-semibold">
                    Single isolated overpass detection
                  </span>
                  <span className="sf-metadata text-[10px] text-on-surface-variant/70 mt-0.5">
                    FRP: {frpVal} MW at this coordinate
                  </span>
                </div>
              ) : (
                <div className="h-28 rounded-xl bg-black/30 relative overflow-hidden flex items-end p-2.5 pt-6 border border-white/5">
                  <div className="absolute bottom-4 left-0 w-full border-b border-dashed border-white/10 z-0" />
                  <svg
                    className="w-full h-full text-industrial-fire absolute inset-0"
                    preserveAspectRatio="none"
                    viewBox="0 0 100 100"
                  >
                    <polyline
                      fill="none"
                      points={svgPoints}
                      stroke="currentColor"
                      strokeWidth="2.5"
                    />
                  </svg>
                  <span className="sf-metadata text-on-surface-variant absolute top-2 left-2 text-[9.5px]">
                    Earliest: {historicalPasses[0]?.frp.toFixed(1)} MW
                  </span>
                  <span className="sf-metadata text-industrial-fire absolute top-2 right-2 font-bold font-mono text-[9.5px]">
                    Peak: {maxFrpInHistory.toFixed(1)} MW
                  </span>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
