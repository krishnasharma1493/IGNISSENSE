import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import {
  useAlerts,
  useClassification,
  useHotspots,
  useNearbyOsmFeatures,
  useUpdateAlertStatus,
} from '../../api/hooks';
import { CLASS_CONFIG } from '../../types';
import type { Alert, Classification, Hotspot } from '../../types';
import { CandidateChip, ClassChip, SeverityChip, StatusChip } from '../../components/ui/Chip';
import { Section } from '../../components/ui/Provenance';
import { Field, Metric, MISSING } from '../../components/ui/Readout';
import {
  formatDistance,
  formatFirmsConfidence,
  formatLandCover,
  formatUtc,
  stripAlertPrefix,
  titleise,
} from '../../lib/format';

interface AlertsPageProps {
  onInvestigate: (hotspotId: string) => void;
}

type StatusFilter = 'all' | 'open' | 'acknowledged' | 'resolved';
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type SortKey = 'latest' | 'severity' | 'anomaly';

const SEVERITY_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

/** Alerts store `hotspotId` either populated or as a bare id, depending on route. */
const hotspotIdOf = (a: Alert): string =>
  typeof a.hotspotId === 'object' ? (a.hotspotId as Hotspot)._id : (a.hotspotId as string);

export default function AlertsPage({ onInvestigate }: AlertsPageProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('latest');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: alertsData, isLoading } = useAlerts();
  const { data: hotspotsData } = useHotspots({ limit: '5000' });
  const updateStatus = useUpdateAlertStatus();

  const alerts = alertsData?.alerts ?? [];
  const hotspotsById = useMemo(
    () => new Map((hotspotsData?.hotspots ?? []).map((h) => [h._id, h])),
    [hotspotsData]
  );

  const { data: classificationsData } = useQuery({
    queryKey: ['all-classifications'],
    queryFn: async () => {
      const res = await api.get('/classifications', { params: { limit: '5000' } });
      const map = new Map<string, Classification>();
      if (res.data?.success && Array.isArray(res.data.data?.classifications)) {
        for (const c of res.data.data.classifications as Classification[]) map.set(c.hotspotId, c);
      }
      return map;
    },
    staleTime: 30_000,
  });
  const classifications = classificationsData ?? new Map<string, Classification>();

  const resolve = (a: Alert) => {
    const id = hotspotIdOf(a);
    const hotspot =
      typeof a.hotspotId === 'object' ? (a.hotspotId as Hotspot) : hotspotsById.get(id) ?? null;
    return { id, hotspot, classification: classifications.get(id) ?? null };
  };

  const visible = useMemo(() => {
    const list = alerts.filter(
      (a) =>
        (statusFilter === 'all' || a.status === statusFilter) &&
        (severityFilter === 'all' || a.severity === severityFilter)
    );
    return list.sort((a, b) => {
      if (sortKey === 'severity') {
        return (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
      }
      if (sortKey === 'anomaly') {
        return (
          (resolve(b).classification?.anomalyScore ?? 0) -
          (resolve(a).classification?.anomalyScore ?? 0)
        );
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, statusFilter, severityFilter, sortKey, classifications]);

  const selected = visible.find((a) => a._id === selectedId) ?? visible[0] ?? null;
  const base = selected ? resolve(selected) : null;

  /* The bulk classifications endpoint returns `nearestFacilityId` as a raw
     ObjectId, so the facility's name and type are only available from the
     single-hotspot route, which populates it. Without this the detail pane can
     show a measured distance next to an empty facility name. */
  const { data: populated } = useClassification(base?.id ?? null);

  /* `nearestFacilityId` references the legacy Delhi-NCR facilities collection,
     but distance is measured against the India-wide OSM features. For most
     detections that leaves a real distance with no linked facility record, so
     the name is resolved from the same OSM layer the distance came from. */
  const { data: osm } = useNearbyOsmFeatures(
    base?.hotspot?.location.coordinates[0] ?? null,
    base?.hotspot?.location.coordinates[1] ?? null,
    20000
  );
  const nearestOsm = osm?.features?.[0] ?? null;

  const detail = base
    ? { ...base, classification: populated ?? base.classification }
    : null;

  return (
    <div className="mx-auto flex h-[calc(100vh-100px)] max-w-[1400px] flex-col gap-3">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">Alerts</h1>
          <p className="mt-0.5 max-w-[62ch] text-[12px] leading-relaxed text-ink-2">
            Rule-generated candidates raised where anomaly score and facility proximity cross
            threshold. These are decision support for an analyst to triage — none of them is a
            confirmed incident.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Filter by status"
            className="cursor-pointer rounded-md border border-hairline bg-white/60 px-2 py-1 text-[12px] text-ink"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="acknowledged">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            aria-label="Filter by severity"
            className="cursor-pointer rounded-md border border-hairline bg-white/60 px-2 py-1 text-[12px] text-ink"
          >
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label="Sort alerts"
            className="cursor-pointer rounded-md border border-hairline bg-white/60 px-2 py-1 text-[12px] text-ink"
          >
            <option value="latest">Newest first</option>
            <option value="severity">Severity</option>
            <option value="anomaly">Anomaly score</option>
          </select>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* ── List ─────────────────────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-hairline bg-white/60">
          <div className="flex items-center justify-between border-b border-hairline px-3.5 py-2">
            <h2 className="text-[12px] font-semibold text-ink">Candidates</h2>
            <span className="num text-[11px] text-ink-3">
              {visible.length} of {alerts.length}
            </span>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <li className="px-3.5 py-6 text-[12px] text-ink-3">Loading alerts…</li>
            ) : visible.length === 0 ? (
              <li className="px-3.5 py-6 text-[12px] text-ink-3">
                No alerts match these filters.
              </li>
            ) : (
              visible.map((a) => {
                const { id, hotspot, classification } = resolve(a);
                const isActive = selected?._id === a._id;
                return (
                  <li key={a._id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a._id)}
                      aria-current={isActive ? 'true' : undefined}
                      className={`flex w-full flex-col gap-1.5 border-b border-hairline px-3.5 py-2.5 text-left transition-colors ${
                        isActive ? 'bg-accent-soft' : 'hover:bg-[rgba(15,18,22,0.04)]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <SeverityChip severity={a.severity} />
                        <StatusChip status={a.status} />
                        {classification?.predictedClass ? (
                          <ClassChip cls={classification.predictedClass} />
                        ) : null}
                        <span className="num ml-auto text-[10px] text-ink-3">
                          {formatUtc(a.createdAt)}
                        </span>
                      </div>

                      <p className="line-clamp-2 text-[12px] leading-relaxed text-ink-2">
                        {stripAlertPrefix(a.reason)}
                      </p>

                      <div className="num flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-ink-3">
                        <span>
                          {hotspot
                            ? `${hotspot.location.coordinates[1].toFixed(3)}, ${hotspot.location.coordinates[0].toFixed(3)}`
                            : `Detection ${id.slice(-6).toUpperCase()}`}
                        </span>
                        {hotspot?.frp != null ? <span>{hotspot.frp.toFixed(1)} MW</span> : null}
                        {classification ? (
                          <span>
                            anomaly{' '}
                            {classification.anomalyScore != null
                              ? classification.anomalyScore.toFixed(2)
                              : MISSING}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        {/* ── Detail ───────────────────────────────────────────────────────── */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-hairline bg-white/60">
          {!selected || !detail ? (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <p className="text-[12px] text-ink-3">Select an alert to see its evidence.</p>
            </div>
          ) : (
            <>
              <header className="flex items-start justify-between gap-2 border-b border-hairline px-3.5 py-3">
                <div className="min-w-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <SeverityChip severity={selected.severity} />
                    <CandidateChip />
                  </div>
                  <h2 className="num text-[14px] font-semibold text-ink">
                    {detail.id.slice(-6).toUpperCase()}
                  </h2>
                  <p className="num mt-0.5 text-[11px] text-ink-3">
                    Raised {formatUtc(selected.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onInvestigate(detail.id)}
                  className="ctl h-7 shrink-0 border border-hairline px-2.5 text-[11px]"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }} aria-hidden="true">
                    travel_explore
                  </span>
                  Investigate
                </button>
              </header>

              <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-3.5">
                {/* Triage */}
                <Section title="Triage" kind="heuristic">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusChip status={selected.status} />
                  </div>
                  {/* A segmented state control: each button names the state it
                      moves the alert into, and the current one is held down. */}
                  <div role="group" aria-label="Alert status" className="flex gap-1.5">
                    {(
                      [
                        ['open', 'Open'],
                        ['acknowledged', 'Investigating'],
                        ['resolved', 'Resolved'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected.status === value}
                        disabled={selected.status === value || updateStatus.isPending}
                        onClick={() => updateStatus.mutate({ id: selected._id, status: value })}
                        className="ctl h-7 flex-1 border border-hairline text-[11px] disabled:cursor-default"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="rounded-md border border-hairline bg-[rgba(15,18,22,0.035)] px-2.5 py-2 text-[11px] leading-relaxed text-ink-2">
                    {stripAlertPrefix(selected.reason)}
                  </p>
                </Section>

                {/* Observed */}
                <Section
                  title="Thermal signal"
                  kind="observed"
                  meta={detail.hotspot ? `${detail.hotspot.instrument} · ${detail.hotspot.satellite}` : undefined}
                >
                  {detail.hotspot ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Metric
                          label="FRP"
                          value={detail.hotspot.frp?.toFixed(1)}
                          unit="MW"
                          tone="var(--color-cls-industrial-ink)"
                        />
                        <Metric
                          label="Brightness"
                          value={detail.hotspot.brightness ? Math.round(detail.hotspot.brightness) : null}
                          unit="K"
                        />
                      </div>
                      <dl className="divide-y divide-hairline">
                        <Field label="Acquired" value={formatUtc(detail.hotspot.detectedAt)} numeric />
                        <Field
                          label="Position"
                          value={`${detail.hotspot.location.coordinates[1].toFixed(4)}, ${detail.hotspot.location.coordinates[0].toFixed(4)}`}
                          numeric
                        />
                        <Field label="FIRMS confidence" value={formatFirmsConfidence(detail.hotspot.confidence)} />
                      </dl>
                    </>
                  ) : (
                    <p className="text-[11px] text-ink-3">
                      The detection behind this alert is outside the currently loaded set.
                    </p>
                  )}
                </Section>

                {/* Model */}
                <Section
                  title="Classification"
                  kind="model"
                  meta={detail.classification?.modelVersion}
                >
                  {detail.classification ? (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        {detail.classification.predictedClass ? (
                          <ClassChip cls={detail.classification.predictedClass} size="md" />
                        ) : null}
                        <span className="num text-[13px] font-semibold text-ink">
                          {detail.classification.confidence !== null
                            ? `${Math.round(detail.classification.confidence * 100)}%`
                            : MISSING}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Metric
                          label="Persistence"
                          value={detail.classification.persistenceScore.toFixed(2)}
                        />
                        <Metric
                          label="Anomaly"
                          value={
                            detail.classification.anomalyScore != null
                              ? detail.classification.anomalyScore.toFixed(2)
                              : null
                          }
                        />
                      </div>
                    </>
                  ) : (
                    <p className="text-[11px] text-ink-3">No classification recorded.</p>
                  )}
                </Section>

                {/* Context */}
                <Section title="Facility context" kind="context">
                  <dl className="divide-y divide-hairline">
                    <Field
                      label="Nearest feature"
                      value={
                        detail.classification?.nearestFacilityId &&
                        typeof detail.classification.nearestFacilityId === 'object'
                          ? detail.classification.nearestFacilityId.name
                          : nearestOsm?.name || null
                      }
                    />
                    <Field
                      label="Type"
                      value={
                        detail.classification?.nearestFacilityId &&
                        typeof detail.classification.nearestFacilityId === 'object'
                          ? titleise(detail.classification.nearestFacilityId.facilityType)
                          : nearestOsm
                          ? titleise(nearestOsm.featureSubcategory || nearestOsm.featureCategory)
                          : null
                      }
                    />
                    <Field
                      label="Distance"
                      value={formatDistance(detail.classification?.facilityDistanceMeters)}
                      numeric
                    />
                    <Field label="Land cover" value={formatLandCover(detail.classification?.landCover)} />
                  </dl>
                </Section>

                {/* Evidence */}
                {detail.classification?.explanation?.length ? (
                  <Section title="Evidence" kind="model">
                    <ul className="flex flex-col gap-1.5">
                      {detail.classification.explanation.map((line, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2"
                        >
                          <span
                            className="material-symbols-outlined mt-px shrink-0 text-ink-4"
                            style={{ fontSize: 13 }}
                            aria-hidden="true"
                          >
                            chevron_right
                          </span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                ) : null}

                <p className="rounded-md border border-hairline bg-[rgba(15,18,22,0.035)] px-2.5 py-2 text-[11px] leading-relaxed text-ink-3">
                  Severity is assigned by rule from the anomaly score and facility distance, not by
                  the classifier. Confirmation requires ground verification.
                  {detail.classification?.predictedClass ? (
                    <>
                      {' '}
                      Class colour key:{' '}
                      <span style={{ color: CLASS_CONFIG[detail.classification.predictedClass].ink }}>
                        {CLASS_CONFIG[detail.classification.predictedClass].label}
                      </span>
                      .
                    </>
                  ) : null}
                </p>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
