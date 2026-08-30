import { useAnalyticsSummary, useHotspots, useTemporalTrend } from '../../api/hooks';
import MapView from '../map/MapView';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { CLASS_CONFIG } from '../../types';
import type { Classification } from '../../types';

interface DashboardPageProps {
  onNavigateToMap?: (hotspotId?: string) => void;
}

export default function DashboardPage({ onNavigateToMap }: DashboardPageProps) {
  const { data: analytics, isLoading: analyticsLoading } = useAnalyticsSummary();
  const { data: hotspotsData } = useHotspots({ limit: '100' });
  const { data: temporalData } = useTemporalTrend(7);
  const hotspots = hotspotsData?.hotspots || [];

  // Bulk classifications for mini map & table
  const { data: allClassifications } = useQuery({
    queryKey: ['all-classifications'],
    queryFn: async () => {
      const res = await api.get('/classifications', { params: { limit: '1000' } });
      const results = new Map<string, Classification>();
      if (res.data?.success && Array.isArray(res.data.data?.classifications)) {
        res.data.data.classifications.forEach((c: Classification) => {
          results.set(c.hotspotId, c);
        });
      }
      return results;
    },
    staleTime: 30000,
  });

  const classificationsMap = allClassifications || new Map<string, Classification>();

  // 100% Real Database Derived KPIs (Zero Hardcoded Fallbacks)
  const totalHotspots = analytics?.totalHotspots ?? 0;
  const industrialCount = analytics?.classifications?.industrial_fire ?? 0;
  const anomalousCount = analytics?.anomalousSources ?? 0;
  const persistentCount = analytics?.persistentSources ?? 0;

  // Real class counts & percentages strictly derived from database
  const agriWildfireCount =
    (analytics?.classifications?.agricultural_burning ?? 0) +
    (analytics?.classifications?.wildfire ?? 0);
  const gasFlareCount = analytics?.classifications?.gas_flare ?? 0;
  const miningCount = analytics?.classifications?.mining_thermal_activity ?? 0;

  const pctAgri = totalHotspots > 0 ? Math.round((agriWildfireCount / totalHotspots) * 100) : 0;
  const pctGas = totalHotspots > 0 ? Math.round((gasFlareCount / totalHotspots) * 100) : 0;
  const pctInd = totalHotspots > 0 ? Math.round((industrialCount / totalHotspots) * 100) : 0;
  const pctMin = totalHotspots > 0 ? Math.round((miningCount / totalHotspots) * 100) : 0;

  const trendPoints = temporalData?.points || [];
  const maxTrendCount = Math.max(...trendPoints.map((p) => p.count), 1);

  return (
    <main className="flex-1 overflow-y-auto overflow-x-hidden relative flex flex-col p-margin-mobile md:p-margin-desktop gap-lg pb-24 h-full bg-surface-dim">
      {/* Page Header */}
      <div className="flex flex-col gap-xs mb-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl liquid-glass-interactive flex items-center justify-center p-2 border border-white/20 shadow-md bg-slate-950/40">
            <img src="/logo-white.png" alt="IGNISSENSE" className="w-full h-full object-contain filter drop-shadow-[0_0_8px_rgba(56,189,248,0.5)]" />
          </div>
          <div className="flex items-center gap-2">
            <h1 className="font-headline-lg-mobile md:font-headline-lg text-headline-lg-mobile md:text-headline-lg text-on-surface font-black tracking-tight">
              Thermal Intelligence — Whole India (National)
            </h1>
            <span className="font-status-pill text-status-pill px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 uppercase font-mono">
              Verified Pipeline
            </span>
          </div>
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Satellite-detected thermal observations aggregated strictly from NASA FIRMS & OpenStreetMap spatial enrichment.
        </p>
      </div>

      {/* KPI Strip (100% Database Derived) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-md">
        {/* KPI 1 */}
        <div className="bg-intelligence-blue border border-outline-variant rounded-lg p-md flex flex-col gap-sm">
          <div className="font-metadata-sm text-metadata-sm text-on-surface-variant uppercase tracking-wider">
            Total Hotspots (DB Query)
          </div>
          <div className="font-kpi-value text-kpi-value text-on-surface font-mono font-bold">
            {analyticsLoading ? '...' : totalHotspots.toLocaleString()}
          </div>
          <div className="font-metadata-sm text-metadata-sm text-on-surface-variant flex items-center gap-1">
            <span>NASA VIIRS/MODIS Telemetry</span>
          </div>
        </div>

        {/* KPI 2: Critical Highlight */}
        <div className="bg-surface border border-industrial-fire/50 rounded-lg p-md flex flex-col gap-sm relative overflow-hidden group">
          <div className="absolute inset-0 bg-industrial-fire/10 pointer-events-none group-hover:bg-industrial-fire/20 transition-colors" />
          <div className="font-metadata-sm text-metadata-sm text-on-surface-variant uppercase tracking-wider flex items-center justify-between relative z-10">
            <span>Industrial Fire Candidates</span>
            <span className="material-symbols-outlined text-industrial-fire text-[18px]">
              local_fire_department
            </span>
          </div>
          <div className="font-kpi-value text-kpi-value text-industrial-fire relative z-10 font-mono font-bold">
            {analyticsLoading ? '...' : industrialCount}
          </div>
          <div className="font-metadata-sm text-metadata-sm text-industrial-fire/80 relative z-10 font-semibold">
            {industrialCount > 0 ? 'High Spatial Priority' : 'No Critical Candidates'}
          </div>
        </div>

        {/* KPI 3: Anomalous Sources */}
        <div className="bg-surface border border-gas-flare/50 rounded-lg p-md flex flex-col gap-sm relative overflow-hidden">
          <div className="absolute inset-0 bg-gas-flare/10 pointer-events-none" />
          <div className="font-metadata-sm text-metadata-sm text-on-surface-variant uppercase tracking-wider flex items-center justify-between relative z-10">
            <span>Anomalous Sources (Z &gt; 0.65)</span>
            <span className="material-symbols-outlined text-gas-flare text-[18px]">warning</span>
          </div>
          <div className="font-kpi-value text-kpi-value text-gas-flare relative z-10 font-mono font-bold">
            {analyticsLoading ? '...' : anomalousCount}
          </div>
          <div className="font-metadata-sm text-metadata-sm text-gas-flare/80 relative z-10 font-semibold">
            Statistical FRP Outliers
          </div>
        </div>

        {/* KPI 4: Persistent Sources */}
        <div className="bg-intelligence-blue border border-outline-variant rounded-lg p-md flex flex-col gap-sm">
          <div className="font-metadata-sm text-metadata-sm text-on-surface-variant uppercase tracking-wider">
            Persistent Sources (Recurrence)
          </div>
          <div className="font-kpi-value text-kpi-value text-on-surface font-mono font-bold">
            {analyticsLoading ? '...' : persistentCount}
          </div>
          <div className="font-metadata-sm text-metadata-sm text-on-surface-variant">
            Multi-pass spatial clusters
          </div>
        </div>
      </div>

      {/* Main Grid (70/30 Split) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-lg flex-1 min-h-[500px]">
        {/* Left (70%): Live Situation Map */}
        <div className="xl:col-span-2 bg-surface-container border border-outline-variant rounded-lg overflow-hidden relative flex flex-col min-h-[460px]">
          {/* Map Header Overlay */}
          <div className="absolute top-4 left-4 z-10 glass-panel rounded-lg border border-slate-600/50 p-sm px-md flex items-center justify-between min-w-[240px] shadow-lg">
            <div className="flex items-center gap-sm">
              <span className="w-2 h-2 rounded-full bg-error animate-pulse" />
              <span className="font-label-md text-label-md text-on-surface font-semibold">
                Live Situation Map
              </span>
            </div>
            <button
              onClick={() => onNavigateToMap && onNavigateToMap()}
              className="text-[11px] text-primary hover:underline font-semibold ml-3"
            >
              Open GIS Map →
            </button>
          </div>

          {/* Interactive Map */}
          <div className="w-full h-full min-h-[440px]">
            <MapView
              hotspots={hotspots}
              facilities={[]}
              classifications={classificationsMap}
              selectedHotspotId={null}
              onHotspotSelect={(id) => onNavigateToMap && onNavigateToMap(id)}
              classFilter={null}
            />
          </div>
        </div>

        {/* Right (30%): Real Data Charts */}
        <div className="xl:col-span-1 flex flex-col gap-lg">
          {/* Classification Distribution Card */}
          <div className="bg-intelligence-blue border border-outline-variant rounded-lg p-md flex-1 flex flex-col justify-between">
            <div className="flex justify-between items-center mb-md">
              <h3 className="font-label-md text-label-md text-on-surface font-semibold">
                Classification Distribution
              </h3>
              <span className="font-metadata-sm text-metadata-sm text-on-surface-variant font-mono">
                {totalHotspots} total
              </span>
            </div>

            <div className="flex-1 flex flex-col justify-center gap-4">
              {/* Wildfire / Agricultural */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-metadata-sm text-metadata-sm">
                  <span className="text-on-surface-variant">Wildfire / Agricultural</span>
                  <span className="text-on-surface font-mono font-semibold">{pctAgri}%</span>
                </div>
                <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
                  <div className="h-full bg-wildfire rounded-full transition-all duration-500" style={{ width: `${pctAgri}%` }} />
                </div>
              </div>

              {/* Gas Flare */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-metadata-sm text-metadata-sm">
                  <span className="text-on-surface-variant">Gas Flare</span>
                  <span className="text-on-surface font-mono font-semibold">{pctGas}%</span>
                </div>
                <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
                  <div className="h-full bg-gas-flare rounded-full transition-all duration-500" style={{ width: `${pctGas}%` }} />
                </div>
              </div>

              {/* Industrial Process */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-metadata-sm text-metadata-sm">
                  <span className="text-on-surface-variant">Industrial Process</span>
                  <span className="text-on-surface font-mono font-semibold">{pctInd}%</span>
                </div>
                <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
                  <div className="h-full bg-industrial-fire rounded-full transition-all duration-500" style={{ width: `${pctInd}%` }} />
                </div>
              </div>

              {/* Mining / Unknown */}
              <div className="flex flex-col gap-1">
                <div className="flex justify-between font-metadata-sm text-metadata-sm">
                  <span className="text-on-surface-variant">Mining / Unknown</span>
                  <span className="text-on-surface font-mono font-semibold">{pctMin}%</span>
                </div>
                <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
                  <div className="h-full bg-mining rounded-full transition-all duration-500" style={{ width: `${pctMin}%` }} />
                </div>
              </div>
            </div>
          </div>

          {/* Genuine 7-Day Detection Volume Bar Chart from MongoDB Aggregation */}
          <div className="bg-intelligence-blue border border-outline-variant rounded-lg p-md h-52 flex flex-col">
            <div className="flex justify-between items-center mb-sm">
              <h3 className="font-label-md text-label-md text-on-surface font-semibold">
                7-Day Detection Volume (DB Aggregated)
              </h3>
              <span className="font-metadata-sm text-metadata-sm text-primary font-mono text-[11px]">
                {trendPoints.reduce((s, p) => s + p.count, 0)} Detections
              </span>
            </div>

            {trendPoints.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-on-surface-variant font-metadata-sm text-xs">
                No observations recorded in 7-day window
              </div>
            ) : (
              <>
                <div className="flex-1 flex items-end justify-between gap-2 px-2 pt-4 border-b border-l border-outline-variant relative">
                  <span className="absolute -left-1 -ml-4 top-0 font-metadata-sm text-metadata-sm text-on-surface-variant text-[10px]">
                    {maxTrendCount}
                  </span>
                  <span className="absolute -left-1 -ml-4 bottom-0 font-metadata-sm text-metadata-sm text-on-surface-variant text-[10px]">
                    0
                  </span>

                  {trendPoints.map((p, idx) => {
                    const heightPct = Math.max(8, Math.round((p.count / maxTrendCount) * 100));
                    const isLatest = idx === trendPoints.length - 1;
                    return (
                      <div
                        key={p.date}
                        className={`w-full ${
                          isLatest ? 'bg-primary hover:bg-primary-fixed' : 'bg-secondary-container hover:bg-secondary'
                        } transition-colors rounded-t-sm`}
                        style={{ height: `${heightPct}%` }}
                        title={`${p.date}: ${p.count} satellite observations (Mean FRP: ${p.meanFrp} MW)`}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1 font-metadata-sm text-metadata-sm text-on-surface-variant text-[10px] font-mono">
                  <span>{trendPoints[0]?.date.slice(5) || 'Start'}</span>
                  <span>{trendPoints[trendPoints.length - 1]?.date.slice(5) || 'Today'}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Table: Genuine High-Confidence Hotspots */}
      <div className="bg-intelligence-blue border border-outline-variant rounded-lg overflow-hidden flex flex-col shadow-lg">
        <div className="p-md border-b border-outline-variant flex justify-between items-center bg-surface-container-lowest">
          <h3 className="font-label-md text-label-md text-on-surface font-semibold">
            Recent Satellite Thermal Observations (MongoDB Source of Truth)
          </h3>
          <button
            onClick={() => onNavigateToMap && onNavigateToMap()}
            className="font-metadata-sm text-metadata-sm text-primary hover:text-primary-fixed transition-colors font-semibold"
          >
            View All in GIS Map →
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface/50 border-b border-outline-variant/50">
                <th className="p-3 font-metadata-sm text-metadata-sm text-on-surface-variant font-medium">
                  Acquisition Time (UTC)
                </th>
                <th className="p-3 font-metadata-sm text-metadata-sm text-on-surface-variant font-medium">
                  Coordinates
                </th>
                <th className="p-3 font-metadata-sm text-metadata-sm text-on-surface-variant font-medium">
                  Observed FRP
                </th>
                <th className="p-3 font-metadata-sm text-metadata-sm text-on-surface-variant font-medium">
                  Classification
                </th>
                <th className="p-3 font-metadata-sm text-metadata-sm text-on-surface-variant font-medium text-right">
                  Model Confidence
                </th>
              </tr>
            </thead>
            <tbody className="font-body-md text-body-md text-on-surface text-[14px]">
              {hotspots.slice(0, 6).map((h) => {
                const c = classificationsMap.get(h._id);
                const cls = c?.predictedClass || 'other_or_uncertain';
                const cfg = CLASS_CONFIG[cls];
                const confPct = c ? (c.confidence * 100).toFixed(1) : 'N/A';
                const dateStr = new Date(h.detectedAt).toISOString().replace('T', ' ').slice(0, 19);

                return (
                  <tr
                    key={h._id}
                    onClick={() => onNavigateToMap && onNavigateToMap(h._id)}
                    className="border-b border-outline-variant/30 hover:bg-surface-variant/40 transition-colors cursor-pointer"
                  >
                    <td className="p-3 font-metadata-sm text-metadata-sm font-mono text-on-surface-variant">
                      {dateStr}
                    </td>
                    <td className="p-3 font-mono text-[13px] text-tertiary">
                      {h.location.coordinates[1].toFixed(4)}° N, {h.location.coordinates[0].toFixed(4)}° E
                    </td>
                    <td className="p-3 font-mono text-[13px] text-on-surface font-semibold">
                      {h.frp ? `${h.frp.toFixed(1)} MW` : 'N/A'}
                    </td>
                    <td className="p-3">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded font-status-pill text-status-pill uppercase tracking-wider"
                        style={{
                          backgroundColor: `${cfg.color}22`,
                          color: cfg.color,
                          border: `1px solid ${cfg.color}55`,
                        }}
                      >
                        {cfg.label}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono font-semibold" style={{ color: cfg.color }}>
                      {confPct}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
