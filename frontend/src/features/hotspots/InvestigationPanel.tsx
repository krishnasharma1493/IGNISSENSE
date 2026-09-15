import { useState } from 'react';
import { CLASS_CONFIG, CLASSIFICATION_CLASSES } from '../../types';
import type { Classification, Hotspot, OsmFeature } from '../../types';
import { useHotspotHistory, useReverseGeocode } from '../../api/hooks';
import Panel from '../../components/ui/Panel';
import { Section } from '../../components/ui/Provenance';
import { Bar, Field, Metric, MISSING } from '../../components/ui/Readout';
import {
  formatDistance,
  formatFirmsConfidence,
  formatLandCover,
  formatUtc,
  titleise,
} from '../../lib/format';
import { CandidateChip, ClassChip, NotClassifiedChip } from '../../components/ui/Chip';
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
  /** Playing its exit animation; the panel is inert until it unmounts. */
  exiting?: boolean;
  /** Still showing the previous detection while a new selection loads. */
  pending?: boolean;
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
  exiting = false,
  pending = false,
}: InvestigationPanelProps) {
  const [copied, setCopied] = useState(false);

  const { data: historyData, isLoading: historyLoading } = useHotspotHistory(hotspot._id);
  const passes = historyData?.points ?? [];

  const [lng, lat] = hotspot.location.coordinates;
  const eventId = `HS-${hotspot._id.slice(-6).toUpperCase()}`;

  const { data: place } = useReverseGeocode(lat, lng);

  const predicted = classification?.predictedClass ?? null;

  const nearestFacility =
    classification?.nearestFacilityId && typeof classification.nearestFacilityId === 'object'
      ? classification.nearestFacilityId
      : null;

  // The pipeline no longer substitutes a 25 km sentinel for an unmeasured
  // distance — an unresolved facility distance arrives as null and the whole
  // row is gated to `unclassified_insufficient_features`.
  const facilityDistance = classification?.facilityDistanceMeters ?? null;

  // `landCover` defaults to 'other' on the schema and enrichHotspot returns
  // 'other' for no OSM coverage, so on an unclassified row it is a schema
  // default wearing the clothes of a measurement. Only shown when the
  // classifier actually ran on measured spatial features.
  const isClassified = classification?.pipelineStatus === 'classified';

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
      className={`${
        exiting ? 'panel-exit' : 'panel-enter'
      } absolute right-4 top-[60px] bottom-4 z-40 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl`}
      aria-label={`Details for detection ${eventId}`}
      inert={exiting || undefined}
    >
      {/* ── Anchor ─────────────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
        <div
          className={`min-w-0 flex-1 transition-opacity ${pending ? 'opacity-50' : ''}`}
          inert={pending || undefined}
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {predicted ? <ClassChip cls={predicted} size="md" /> : null}
            {classification?.pipelineStatus === 'classified' ? (
              <CandidateChip />
            ) : classification ? (
              <NotClassifiedChip />
            ) : null}
          </div>

          <h2 className="num truncate text-[15px] font-semibold leading-tight text-ink">{eventId}</h2>

          <button
            type="button"
            onClick={copyCoordinates}
            className="ctl -ml-1 mt-1 rounded-md px-1 py-0.5"
            title={copied ? 'Copied' : 'Copy coordinates'}
          >
            <span className="num text-[11px] text-ink-2">
              {lat.toFixed(5)}°N, {lng.toFixed(5)}°E
            </span>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }} aria-hidden="true">
              {copied ? 'check' : 'content_copy'}
            </span>
            <span className="sr-only">{copied ? 'Coordinates copied' : 'Copy coordinates'}</span>
          </button>

          {place ? (
            <div className="mt-0.5">
              <p
                className="truncate text-[11px] leading-snug text-ink-2"
                title={place.displayName ?? undefined}
              >
                {[place.locality, place.city, place.district, place.state]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {/* Attribution is a licence obligation, so it sits outside the
                  truncated element and can never be clipped by a long name. */}
              <p className="text-[10px] leading-snug text-ink-3">{place.attribution}</p>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="ctl h-7 w-7 shrink-0 rounded-md"
          aria-label="Close details"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 17 }} aria-hidden="true">
            close
          </span>
        </button>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {/* Keyed on the detection: switching fades the new one in from the top. */}
      <div
        key={hotspot._id}
        className={`tab-enter flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 transition-opacity ${
          pending ? 'opacity-50' : ''
        }`}
        inert={pending || undefined}
        aria-busy={pending || undefined}
      >
        {/* 1. Thermal signal — straight off the FIRMS record */}
        <Section
          title="Satellite reading"
          kind="observed"
          meta={`${hotspot.instrument} · ${hotspot.satellite}`}
        >
          <div className="grid grid-cols-3 gap-2">
            <Metric
              label="Fire power"
              value={hotspot.frp?.toFixed(1)}
              unit="MW"
              tone="var(--color-cls-industrial-ink)"
            />
            <Metric
              label={hotspot.instrument?.toUpperCase().includes('VIIRS') ? 'Brightness I4' : 'Brightness'}
              value={hotspot.brightness ? Math.round(hotspot.brightness) : null}
              unit="K"
            />
            <Metric
              label={hotspot.instrument?.toUpperCase().includes('VIIRS') ? 'Brightness I5' : 'Brightness T31'}
              value={hotspot.brightnessTi5 ? Math.round(hotspot.brightnessTi5) : null}
              unit="K"
            />
          </div>

          <dl className="divide-y divide-hairline">
            <Field label="Detected" value={formatUtc(hotspot.detectedAt)} numeric />
            <Field
              label="Satellite pass"
              value={hotspot.dayNight === 'D' ? 'Day' : hotspot.dayNight === 'N' ? 'Night' : null}
            />
            <Field label="Detection confidence" value={formatFirmsConfidence(hotspot.confidence)} />
            <Field label="Pixel size" value={
              hotspot.scan !== null && hotspot.track !== null
                ? `${hotspot.scan} × ${hotspot.track}`
                : null
            } unit="km" numeric />
            <Field label="Data version" value={hotspot.version} numeric />
            <Field label="Received" value={formatUtc(hotspot.ingestedAt)} numeric />
          </dl>
        </Section>

        {/* 2. Model output — a prediction, labelled as such */}
        <Section
          title="Fire type"
          kind="model"
          meta={classification?.modelVersion ?? undefined}
        >
          {isLoading ? (
            <p className="text-[11px] text-ink-3">Loading prediction…</p>
          ) : !classification ? (
            <p className="inset-surface rounded-md px-3 py-2.5 text-[11px] leading-relaxed text-ink-2">
              No prediction is available for this detection yet. The satellite readings above are
              still accurate.
            </p>
          ) : classification.pipelineStatus === 'unclassified_insufficient_features' ? (
            <div className="inset-surface rounded-md px-3 py-2.5">
              <p className="text-[12px] font-medium text-ink">Couldn&rsquo;t classify this fire</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
                The model needs to know what&rsquo;s nearby — industrial sites, mines, power plants —
                and none are mapped within 25 km of this spot. The satellite readings above are still
                accurate; check the location on the map to judge it yourself.
              </p>
              <p className="num mt-1.5 text-[10px] text-ink-3">
                Missing inputs: {classification.featureCompleteness.unresolved.join(', ')}
              </p>
            </div>
          ) : classification.pipelineStatus === 'unclassified_model_unavailable' ? (
            <div className="inset-surface rounded-md px-3 py-2.5">
              <p className="text-[12px] font-medium text-ink">Couldn&rsquo;t classify this fire</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-2">
                We had everything the model needed, but the classification service didn&rsquo;t
                respond when this detection came in, so there&rsquo;s no prediction for it. The
                satellite readings above are still accurate.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] text-ink-3">Model confidence</span>
                <span className="num text-[15px] font-semibold text-ink">
                  {classification.confidence !== null
                    ? `${Math.round(classification.confidence * 100)}%`
                    : MISSING}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                {CLASSIFICATION_CLASSES.map((c, i) => (
                  <Bar
                    key={c}
                    index={i}
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
        <Section title="History at this spot" kind="heuristic">
          <p className="text-[11px] leading-relaxed text-ink-3">
            <strong className="font-medium text-ink-2">Persistence</strong> is how often fires have
            been detected here before. <strong className="font-medium text-ink-2">Anomaly</strong> is
            how unusual this reading is for this spot. They&rsquo;re scored separately: a steel plant
            can burn every day and still look completely normal.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Metric
              label="Persistence"
              value={classification ? classification.persistenceScore.toFixed(2) : null}
              band={classification ? band(classification.persistenceScore) : undefined}
            />
            <Metric
              label="Anomaly"
              value={
                classification?.anomalyScore != null
                  ? classification.anomalyScore.toFixed(2)
                  : null
              }
              band={
                classification?.anomalyScore != null
                  ? band(classification.anomalyScore)
                  : undefined
              }
            />
          </div>
        </Section>

        {/* 4. Spatial context */}
        <Section
          title="What's nearby"
          kind="context"
          meta={isNearbyOsmLoading ? 'searching…' : `${nearbyOsmFeatures.length} within 20 km`}
        >
          <dl className="divide-y divide-hairline">
            <Field
              label="Nearest site"
              value={nearestFacility?.name ?? (nearbyOsmFeatures[0]?.name || null)}
            />
            <Field
              label="Site type"
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
              value={formatDistance(facilityDistance ?? nearbyOsmFeatures[0]?.distance_m)}
              numeric
            />
            <Field
              label="Land cover"
              value={isClassified ? formatLandCover(classification?.landCover) : null}
            />
          </dl>

          {/* Investigation network control */}
          {nearbyOsmFeatures.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2 pt-1">
                <label htmlFor="linked-count" className="text-[11px] text-ink-3">
                  Connect on map
                </label>
                <select
                  id="linked-count"
                  value={linkedCount}
                  onChange={(e) => onLinkedCountChange(Number(e.target.value))}
                  className="num inset-surface cursor-pointer rounded-md px-1.5 py-1 text-[11px] text-ink"
                >
                  {[3, 6, 10, 15].map((n) => (
                    <option key={n} value={n}>
                      {n} closest
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
                            {f.name || 'Unnamed site'}
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
              No mapped sites within 20 km of this fire.
            </p>
          ) : null}
        </Section>

        {/* 5. Detection history */}
        <Section
          title="Past detections"
          kind="observed"
          meta={historyLoading ? 'loading…' : `${passes.length} passes`}
        >
          {historyLoading ? (
            <div className="inset-surface h-[88px] rounded-md" aria-hidden="true" />
          ) : (
            <FrpTrajectory points={passes} />
          )}
          <p className="text-[11px] leading-relaxed text-ink-3">
            Every satellite detection within 1.5 km of this spot, from all sensors.
          </p>
        </Section>

        {/* 6. Evidence */}
        <Section title="Why the model thinks so" kind="model">
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
              No supporting evidence was recorded for this detection.
            </p>
          )}
        </Section>
      </div>
    </Panel>
  );
}
