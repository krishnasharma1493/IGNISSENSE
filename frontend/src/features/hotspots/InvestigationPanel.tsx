import { useState } from 'react';
import { CLASS_CONFIG, CLASSIFICATION_CLASSES } from '../../types';
import type { Classification, Hotspot, OsmFeature } from '../../types';
import { useHotspotHistory } from '../../api/hooks';
import Panel from '../../components/ui/Panel';
import { Section } from '../../components/ui/Provenance';
import { Bar, Field, Metric } from '../../components/ui/Readout';
import {
  formatDistance,
  formatFirmsConfidence,
  formatLandCover,
  formatUtc,
  titleise,
} from '../../lib/format';
import { CandidateChip, ClassChip } from '../../components/ui/Chip';
import FrpTrajectory from './FrpTrajectory';

interface InvestigationPanelProps {
  hotspot: Hotspot;
  classification: Classification | null;
  isLoading: boolean;
  nearbyOsmFeatures: OsmFeature[];
  isNearbyOsmLoading: boolean;
  /** How many nearby features are drawn as linked nodes on the map. */
  linkedCount: number;
  onLinkedCountChange: (n: number) => void;
  onFocusFeature: (coordinates: [number, number], label: string) => void;
  onClose: () => void;
}

/** Bands for the two independent heuristic axes. PRD §21 and §22. */
const band = (score: number) => (score >= 0.7 ? 'High' : score >= 0.4 ? 'Medium' : 'Low');

export default function InvestigationPanel({
  hotspot,
  classification,
  isLoading,
  nearbyOsmFeatures,
  isNearbyOsmLoading,
  linkedCount,
  onLinkedCountChange,
  onFocusFeature,
  onClose,
}: InvestigationPanelProps) {
  const [copied, setCopied] = useState(false);

  const { data: historyData, isLoading: historyLoading } = useHotspotHistory(hotspot._id);
  const passes = historyData?.points ?? [];

  const [lng, lat] = hotspot.location.coordinates;
  const eventId = `HS-${hotspot._id.slice(-6).toUpperCase()}`;

  const predicted = classification?.predictedClass ?? null;
  const isOffline = Boolean(classification?.modelVersion?.endsWith('-OFFLINE'));

  const nearestFacility =
    classification?.nearestFacilityId && typeof classification.nearestFacilityId === 'object'
      ? classification.nearestFacilityId
      : null;

  // The backend substitutes 25 km when a hotspot falls outside OSM tile coverage.
  // Presenting that as a measured distance would be misleading, so it is called out.
  const facilityDistance = classification?.facilityDistanceMeters ?? null;
  const isCoverageSentinel = facilityDistance === 25000 && !nearestFacility;

  const copyCoordinates = async () => {
    try {
      await navigator.clipboard.writeText(`${lat.toFixed(5)}, ${lng.toFixed(5)}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the coordinates remain selectable as text */
    }
  };

  return (
    <Panel
      as="aside"
      level="panel"
      className="arrive absolute right-4 top-[60px] bottom-4 z-40 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl"
      aria-label={`Investigation: event ${eventId}`}
    >
      {/* ── Anchor ─────────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {predicted ? <ClassChip cls={predicted} size="md" /> : null}
            <CandidateChip />
          </div>

          <h2 className="num truncate text-[15px] font-semibold leading-tight text-ink">{eventId}</h2>

          <button
            type="button"
            onClick={copyCoordinates}
            className="ctl -ml-1 mt-1 rounded-md px-1 py-0.5"
            title="Copy coordinates"
          >
            <span className="num text-[11px] text-ink-2">
              {lat.toFixed(5)}°N, {lng.toFixed(5)}°E
            </span>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden="true">
              {copied ? 'check' : 'content_copy'}
            </span>
            <span className="sr-only">Copy coordinates</span>
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="ctl h-7 w-7 shrink-0 rounded-md"
          aria-label="Close investigation"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 17 }} aria-hidden="true">
            close
          </span>
        </button>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        {/* 1. Thermal signal — straight off the FIRMS record */}
        <Section
          title="Thermal signal"
          kind="observed"
          meta={`${hotspot.instrument} · ${hotspot.satellite}`}
        >
          <div className="grid grid-cols-3 gap-2">
            <Metric
              label="FRP"
              value={hotspot.frp?.toFixed(1)}
              unit="MW"
              tone="var(--color-cls-industrial-ink)"
            />
            <Metric
              label={hotspot.instrument?.toUpperCase().includes('VIIRS') ? 'Bright Ti4' : 'Brightness'}
              value={hotspot.brightness ? Math.round(hotspot.brightness) : null}
              unit="K"
            />
            <Metric
              label={hotspot.instrument?.toUpperCase().includes('VIIRS') ? 'Bright Ti5' : 'Bright T31'}
              value={hotspot.brightnessTi5 ? Math.round(hotspot.brightnessTi5) : null}
              unit="K"
            />
          </div>

          <dl className="divide-y divide-hairline">
            <Field label="Acquired" value={formatUtc(hotspot.detectedAt)} numeric />
            <Field
              label="Overpass"
              value={hotspot.dayNight === 'D' ? 'Daytime' : hotspot.dayNight === 'N' ? 'Night' : null}
            />
            <Field label="FIRMS confidence" value={formatFirmsConfidence(hotspot.confidence)} />
            <Field label="Scan / track" value={
              hotspot.scan !== null && hotspot.track !== null
                ? `${hotspot.scan} × ${hotspot.track}`
                : null
            } numeric />
            <Field label="Collection" value={hotspot.version} numeric />
            <Field label="Ingested" value={formatUtc(hotspot.ingestedAt)} numeric />
          </dl>
        </Section>

        {/* 2. Model output — a prediction, labelled as such */}
        <Section
          title="Classification"
          kind="model"
          meta={classification?.modelVersion ?? undefined}
        >
          {isLoading ? (
            <p className="text-[11px] text-ink-3">Loading classification…</p>
          ) : !classification ? (
            <p className="inset-surface rounded-md px-3 py-2.5 text-[11px] text-ink-2">
              This detection has not been classified yet. The pipeline classifies newly ingested
              hotspots in batches, so a very recent detection may not have a result.
            </p>
          ) : (
            <>
              {isOffline ? (
                <p className="flex items-start gap-1.5 rounded-md border border-[rgba(138,97,0,0.26)] bg-warn-soft px-2.5 py-2 text-[11px] leading-relaxed text-warn">
                  <span className="material-symbols-outlined mt-px shrink-0" style={{ fontSize: 13 }} aria-hidden="true">
                    warning
                  </span>
                  <span>
                    The inference service was unreachable. This is the pipeline&rsquo;s fallback
                    result, not a model prediction — treat the class and probabilities as unset.
                  </span>
                </p>
              ) : null}

              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink-3">Predicted class confidence</span>
                <span className="num text-[15px] font-semibold text-ink">
                  {Math.round(classification.confidence * 100)}%
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {CLASSIFICATION_CLASSES.map((c) => (
                  <Bar
                    key={c}
                    label={CLASS_CONFIG[c].label}
                    value={classification.classProbabilities?.[c] ?? 0}
                    color={CLASS_CONFIG[c].ink}
                    emphasis={c === classification.predictedClass}
                  />
                ))}
              </div>
            </>
          )}
        </Section>

        {/* 3. Two independent axes — PRD §23 forbids collapsing these into one */}
        <Section title="Persistence &amp; anomaly" kind="heuristic">
          <p className="text-[11px] leading-relaxed text-ink-3">
            Computed from detection history, not by the classifier. These are separate properties:
            a source can be persistent and unremarkable, or new and highly anomalous.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Persistence"
              value={classification ? classification.persistenceScore.toFixed(2) : null}
              band={classification ? band(classification.persistenceScore) : undefined}
            />
            <Metric
              label="Anomaly"
              value={classification ? classification.anomalyScore.toFixed(2) : null}
              band={classification ? band(classification.anomalyScore) : undefined}
            />
          </div>
        </Section>

        {/* 4. Spatial context */}
        <Section
          title="Spatial context"
          kind="context"
          meta={isNearbyOsmLoading ? 'querying…' : `${nearbyOsmFeatures.length} within 20 km`}
        >
          <dl className="divide-y divide-hairline">
            <Field
              label="Nearest facility"
              value={nearestFacility?.name ?? (nearbyOsmFeatures[0]?.name || null)}
            />
            <Field
              label="Facility type"
              value={
                nearestFacility?.facilityType
                  ? titleise(nearestFacility.facilityType)
                  : nearbyOsmFeatures[0]
                  ? titleise(nearbyOsmFeatures[0].featureSubcategory || nearbyOsmFeatures[0].featureCategory)
                  : null
              }
            />
            <Field
              label="Distance"
              value={
                isCoverageSentinel
                  ? null
                  : formatDistance(facilityDistance ?? nearbyOsmFeatures[0]?.distance_m)
              }
              numeric
            />
            <Field label="Land cover" value={formatLandCover(classification?.landCover)} />
          </dl>

          {isCoverageSentinel ? (
            <p className="inset-surface rounded-md px-2.5 py-2 text-[11px] leading-relaxed text-ink-2">
              No OpenStreetMap coverage has been extracted for this tile yet, so facility distance is
              unmeasured. The classifier received a 25 km placeholder for this detection.
            </p>
          ) : null}

          {/* Investigation network control */}
          {nearbyOsmFeatures.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2 pt-1">
                <label htmlFor="linked-count" className="text-[11px] text-ink-3">
                  Linked on map
                </label>
                <select
                  id="linked-count"
                  value={linkedCount}
                  onChange={(e) => onLinkedCountChange(Number(e.target.value))}
                  className="num inset-surface cursor-pointer rounded-md px-1.5 py-1 text-[11px] text-ink"
                >
                  {[3, 6, 10, 15].map((n) => (
                    <option key={n} value={n}>
                      {n} nearest
                    </option>
                  ))}
                </select>
              </div>

              <ul className="flex flex-col gap-1">
                {nearbyOsmFeatures.slice(0, linkedCount).map((f, i) => (
                  <li key={f.sourceId || f._id}>
                    <button
                      type="button"
                      onClick={() =>
                        onFocusFeature([f.longitude, f.latitude], `${f.name} · ${titleise(f.featureCategory)}`)
                      }
                      className="ctl w-full justify-between gap-2 rounded-md px-2 py-1.5 text-left"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="num w-4 shrink-0 text-[10px] text-ink-4">{i + 1}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-medium text-ink">
                            {f.name || 'Unnamed feature'}
                          </span>
                          <span className="block truncate text-[10px] text-ink-3">
                            {titleise(f.featureCategory)}
                            {f.featureSubcategory ? ` · ${titleise(f.featureSubcategory)}` : ''}
                          </span>
                        </span>
                      </span>
                      <span className="num shrink-0 text-[11px] text-ink-2">
                        {formatDistance(f.distance_m) ?? ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : !isNearbyOsmLoading ? (
            <p className="inset-surface rounded-md px-2.5 py-2 text-[11px] text-ink-2">
              No mapped infrastructure within 20 km of this detection.
            </p>
          ) : null}
        </Section>

        {/* 5. Detection history */}
        <Section
          title="Detection history"
          kind="observed"
          meta={historyLoading ? 'loading…' : `${passes.length} overpasses`}
        >
          {historyLoading ? (
            <div className="inset-surface h-[88px] rounded-md" aria-hidden="true" />
          ) : (
            <FrpTrajectory points={passes} />
          )}
          <p className="text-[11px] leading-relaxed text-ink-3">
            Every FIRMS detection recorded within 1.5 km of this point, across all sensors.
          </p>
        </Section>

        {/* 6. Evidence */}
        <Section title="Classification evidence" kind="model">
          {classification?.explanation?.length ? (
            <ul className="flex flex-col gap-1.5">
              {classification.explanation.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
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
          ) : (
            <p className="text-[11px] text-ink-3">
              No feature-level explanation was recorded for this classification.
            </p>
          )}
        </Section>
      </div>
    </Panel>
  );
}
