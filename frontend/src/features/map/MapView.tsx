import { useRef, useEffect, useMemo, useCallback } from 'react';
import { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ALL_INDIA, CLASS_CONFIG } from '../../types';
import type { Hotspot, Facility, OsmFeature, Classification } from '../../types';
import {
  BASEMAP_STYLES,
  FIRMS_RED,
  OSM_CATEGORY_STYLE,
  geodesicCircle,
} from './basemaps';
import type { MapBasemap, RenderMode } from './basemaps';

interface MapViewProps {
  hotspots: Hotspot[];
  classifications: Map<string, Classification>;
  facilities: Facility[];
  selectedHotspotId: string | null;
  onHotspotSelect: (id: string) => void;
  basemap: MapBasemap;
  renderMode: RenderMode;
  showFacilities: boolean;
  showOsmContext: boolean;
  nearbyOsmFeatures: OsmFeature[];
  /** Number of nearby features promoted to labelled, connected nodes. */
  linkedCount: number;
  targetLocation?: { coordinates: [number, number]; label?: string; zoom?: number } | null;
}

const SRC_HOTSPOTS = 'hotspots';
const SRC_NETWORK = 'investigation-network';
const SRC_FACILITIES = 'facilities';

const EMPTY = { type: 'FeatureCollection' as const, features: [] as any[] };

/**
 * The outline colour for a detection carrying no class. Deliberately achromatic
 * and deliberately not `CLASS_CONFIG.other_or_uncertain.mark` (#8E8E93), so it
 * can never be mistaken for the Uncertain class in the legend.
 */
const UNCLASSIFIED_RING = '#3C4147';

export default function MapView({
  hotspots,
  classifications,
  facilities,
  selectedHotspotId,
  onHotspotSelect,
  basemap,
  renderMode,
  showFacilities,
  showOsmContext,
  nearbyOsmFeatures,
  linkedCount,
  targetLocation,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const anchorMarkerRef = useRef<Marker | null>(null);
  const nodeMarkersRef = useRef<Marker[]>([]);
  const targetMarkerRef = useRef<Marker | null>(null);
  const selectHandlerRef = useRef(onHotspotSelect);
  selectHandlerRef.current = onHotspotSelect;

  /* ── Layer data ───────────────────────────────────────────────────────────
     Held in refs as well as memos. Style events fire outside React's render
     cycle, so the listener that rebuilds layers after a basemap swap has to be
     able to read the current data without closing over a stale render. */

  const hotspotGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      // Properties carry only what the record actually contains. A detection
      // with no FRP reports no FRP; nothing is substituted.
      features: hotspots.map((h) => {
        const c = classifications.get(h._id);
        // No class was assigned: the gate short-circuited inference for want of
        // measured spatial features, the inference service did not answer, or
        // the row has not been through the pipeline yet. None is a model verdict.
        const isUnclassified = !c || c.pipelineStatus !== 'classified' || !c.predictedClass;
        const cls = isUnclassified ? 'other_or_uncertain' : c!.predictedClass!;
        const classLabel = isUnclassified ? '' : CLASS_CONFIG[cls].label;
        // Saturated colour only ever encodes a real thermal-event class. An
        // unclassified detection is drawn as a hollow achromatic ring, which no
        // legend entry and no class marker can be confused with — filling it
        // with the `other_or_uncertain` grey made ~92% of India read as a model
        // verdict of that class.
        const showAsUnclassified = renderMode !== 'firms' && isUnclassified;
        return {
          type: 'Feature' as const,
          geometry: h.location,
          properties: {
            id: h._id,
            // Heatmap weighting needs a number; unmeasured FRP takes the floor.
            frpWeight: h.frp ?? 0,
            frp: h.frp === null ? '' : h.frp.toFixed(1),
            brightness: h.brightness === null ? '' : String(Math.round(h.brightness)),
            satellite: h.satellite ?? '',
            instrument: h.instrument ?? '',
            confidence: h.confidence === null ? '' : String(h.confidence),
            classLabel,
            unclassified: showAsUnclassified,
            color: showAsUnclassified
              ? UNCLASSIFIED_RING
              : renderMode === 'firms'
                ? FIRMS_RED
                : CLASS_CONFIG[cls].mark,
          },
        };
      }),
    }),
    [hotspots, classifications, renderMode]
  );

  const facilityGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: facilities.map((f) => ({
        type: 'Feature' as const,
        geometry: f.location,
        properties: { name: f.name ?? '' },
      })),
    }),
    [facilities]
  );

  const selectedHotspot = useMemo(
    () => (selectedHotspotId ? hotspots.find((h) => h._id === selectedHotspotId) ?? null : null),
    [hotspots, selectedHotspotId]
  );

  const linkedFeatures = useMemo(
    () => (selectedHotspot && showOsmContext ? nearbyOsmFeatures.slice(0, linkedCount) : []),
    [selectedHotspot, showOsmContext, nearbyOsmFeatures, linkedCount]
  );

  /** Perimeter ring, connector lines and the quiet dots for unlinked features. */
  const networkGeoJson = useMemo(() => {
    if (!selectedHotspot || !showOsmContext) return EMPTY;
    const anchor = selectedHotspot.location.coordinates as [number, number];
    const unlinked = nearbyOsmFeatures.slice(linkedCount);

    const links = linkedFeatures.map((f) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: [anchor, [f.longitude, f.latitude]],
      },
      properties: { kind: 'link' },
    }));

    // The ring reports the real extent of the network rather than a fixed radius.
    const furthestKm = linkedFeatures.length
      ? Math.max(...linkedFeatures.map((f) => f.distance_m ?? 0)) / 1000
      : 0;

    return {
      type: 'FeatureCollection' as const,
      features: [
        ...(furthestKm > 0
          ? [
              {
                type: 'Feature' as const,
                geometry: {
                  type: 'Polygon' as const,
                  coordinates: [geodesicCircle(anchor, furthestKm * 1.08)],
                },
                properties: { kind: 'ring' },
              },
            ]
          : []),
        ...links,
        ...unlinked.map((f) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [f.longitude, f.latitude] },
          properties: { kind: 'dot' },
        })),
      ],
    };
  }, [selectedHotspot, showOsmContext, nearbyOsmFeatures, linkedCount, linkedFeatures]);

  const dataRef = useRef({ hotspotGeoJson, facilityGeoJson, networkGeoJson, showFacilities });
  dataRef.current = { hotspotGeoJson, facilityGeoJson, networkGeoJson, showFacilities };

  /**
   * Idempotent: creates whatever is missing and pushes the latest data in.
   *
   * Safe to call at any time, from a style event or from a data effect. It has
   * to be, because `setStyle` discards every source and layer, and because
   * `isStyleLoaded()` reports false while raster tiles are still in flight —
   * deferring to a one-shot `styledata` listener in that window silently drops
   * the update if the event has already passed.
   */
  const syncLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.style) return;

    const { hotspotGeoJson: hs, facilityGeoJson: fac, networkGeoJson: net, showFacilities: showFac } =
      dataRef.current;

    const upsert = (id: string, data: any) => {
      const src = map.getSource(id) as GeoJSONSource | undefined;
      if (src) src.setData(data);
      else map.addSource(id, { type: 'geojson', data });
    };

    try {
      upsert(SRC_HOTSPOTS, hs);
      upsert(SRC_FACILITIES, fac);
      upsert(SRC_NETWORK, net);

      if (!map.getLayer('hotspot-heat')) {
        map.addLayer({
          id: 'hotspot-heat',
          type: 'heatmap',
          source: SRC_HOTSPOTS,
          maxzoom: 8,
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'frpWeight'], 0, 0.15, 60, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 0.7, 8, 1.5],
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0, 'rgba(255,45,32,0)',
              0.3, 'rgba(255,138,0,0.35)',
              0.6, 'rgba(255,59,48,0.6)',
              1, 'rgba(179,38,30,0.85)',
            ],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 10, 8, 24],
            // Density underlay; it hands over to the points as they grow.
            'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 6, 0.4, 8, 0],
          },
        });
      }

      if (!map.getLayer('facility-point')) {
        map.addLayer({
          id: 'facility-point',
          type: 'circle',
          source: SRC_FACILITIES,
          minzoom: 8,
          paint: {
            'circle-radius': 3,
            'circle-color': '#0A6C8C',
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(255,255,255,0.85)',
            'circle-opacity': 0.85,
          },
        });
      }
      map.setLayoutProperty('facility-point', 'visibility', showFac ? 'visible' : 'none');

      if (!map.getLayer('network-ring')) {
        map.addLayer({
          id: 'network-ring',
          type: 'line',
          source: SRC_NETWORK,
          filter: ['==', ['get', 'kind'], 'ring'],
          paint: {
            'line-color': '#ffffff',
            'line-width': 1,
            'line-dasharray': [3, 4],
            'line-opacity': 0.5,
          },
        });
      }
      // Casing beneath the connector keeps it legible over bright desert and
      // pale scrub, where a plain white line disappears entirely.
      if (!map.getLayer('network-link-casing')) {
        map.addLayer({
          id: 'network-link-casing',
          type: 'line',
          source: SRC_NETWORK,
          filter: ['==', ['get', 'kind'], 'link'],
          paint: {
            'line-color': 'rgba(15,18,22,0.45)',
            'line-width': 3,
            'line-blur': 1,
          },
        });
      }
      if (!map.getLayer('network-link')) {
        map.addLayer({
          id: 'network-link',
          type: 'line',
          source: SRC_NETWORK,
          filter: ['==', ['get', 'kind'], 'link'],
          paint: { 'line-color': '#ffffff', 'line-width': 1.2, 'line-opacity': 0.9 },
        });
      }
      if (!map.getLayer('network-dot')) {
        map.addLayer({
          id: 'network-dot',
          type: 'circle',
          source: SRC_NETWORK,
          filter: ['==', ['get', 'kind'], 'dot'],
          paint: {
            'circle-radius': 2.5,
            'circle-color': 'rgba(255,255,255,0.85)',
            'circle-stroke-width': 1,
            'circle-stroke-color': 'rgba(15,18,22,0.35)',
          },
        });
      }

      // Detections sit above the network so the anchor's neighbourhood stays readable.
      if (!map.getLayer('hotspot-point')) {
        map.addLayer({
          id: 'hotspot-point',
          type: 'circle',
          source: SRC_HOTSPOTS,
          paint: {
            // Visible at every zoom. At the national view these dots are the
            // product; hiding them behind a heatmap leaves the map looking empty.
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.8, 5, 2.6, 10, 4.5, 14, 7],
            // Hollow ring for a detection with no assigned class: no fill, a
            // neutral outline, and a white halo so it stays legible on dark
            // imagery. Form, not hue, carries the distinction.
            'circle-color': ['get', 'color'],
            // A `zoom` expression is only legal at the top level of a paint
            // property, so the interpolation wraps the per-feature `case`
            // rather than sitting inside one. Nested the other way round,
            // MapLibre rejects the whole layer at addLayer time — the dots
            // never render and the click handler bound to this layer id never
            // fires.
            'circle-stroke-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              5, ['case', ['boolean', ['get', 'unclassified'], false], 1.3, 0.4],
              9, ['case', ['boolean', ['get', 'unclassified'], false], 1.3, 1],
            ],
            'circle-stroke-color': [
              'case',
              ['boolean', ['get', 'unclassified'], false],
              UNCLASSIFIED_RING,
              'rgba(255,255,255,0.9)',
            ],
            'circle-opacity': [
              'case',
              ['boolean', ['get', 'unclassified'], false],
              0,
              0.95,
            ],
          },
        });
      }
    } catch (err) {
      // A style swap can land mid-call and the next styledata event re-runs
      // this, so a throw here is usually harmless. It is not always: a bad
      // layer definition throws on every pass and the layer simply never
      // exists, which is silent on the map and silent in the console. A
      // rejected `hotspot-point` cost the detection dots and every click
      // handler bound to them. Log it rather than discard it.
      console.warn('[MapView] syncLayers failed; a layer may be missing:', err);
    }
  }, []);

  /* ── Init ─────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLES[basemap] as StyleSpecification,
      center: ALL_INDIA.center,
      zoom: ALL_INDIA.zoom,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // `styledata` fires on load and again after every setStyle, so one listener
    // covers both first paint and basemap swaps.
    map.on('styledata', syncLayers);
    map.on('load', syncLayers);

    const popup = new Popup({ offset: 12, closeButton: false, closeOnClick: false, maxWidth: '260px' });

    const onEnter = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    };
    const onMove = (e: any) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties as Record<string, string>;
      const [lng, lat] = (f.geometry as any).coordinates;
      const row = (label: string, value: string) =>
        value
          ? `<div style="display:flex;justify-content:space-between;gap:12px;padding:1px 0">
               <span style="color:var(--color-ink-3)">${label}</span>
               <span style="font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--color-ink);font-weight:500">${value}</span>
             </div>`
          : '';

      popup
        .setLngLat([lng, lat])
        .setHTML(
          `<div style="font-size:11.5px;line-height:1.5">
             <div style="font-weight:600;color:${p.classLabel ? 'var(--color-ink)' : 'var(--color-ink-3)'};margin-bottom:4px">
               ${p.classLabel || 'Not classified'}
             </div>
             ${row('Fire power', p.frp ? `${p.frp} MW` : '')}
             ${row('Brightness', p.brightness ? `${p.brightness} K` : '')}
             ${row('Sensor', p.instrument && p.satellite ? `${p.instrument} · ${p.satellite}` : '')}
             ${row('Location', `${lat.toFixed(4)}, ${lng.toFixed(4)}`)}
             <div style="margin-top:5px;padding-top:5px;border-top:1px solid var(--color-hairline);color:var(--color-accent);font-weight:600;font-size:10.5px">
               Click for details
             </div>
           </div>`
        )
        .addTo(map);
    };
    const onClick = (e: any) => {
      const id = e.features?.[0]?.properties?.id;
      if (id) selectHandlerRef.current(id);
    };

    map.on('mouseenter', 'hotspot-point', onEnter);
    map.on('mouseleave', 'hotspot-point', onLeave);
    map.on('mousemove', 'hotspot-point', onMove);
    map.on('click', 'hotspot-point', onClick);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Mount-only; basemap changes go through setStyle below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.setStyle(BASEMAP_STYLES[basemap] as StyleSpecification);
  }, [basemap]);

  /* Push new data straight in. The styledata listener is the safety net for the
     window where the style is still settling. */
  useEffect(() => {
    syncLayers();
  }, [hotspotGeoJson, facilityGeoJson, networkGeoJson, showFacilities, syncLayers]);

  /* ── Anchor and linked nodes ──────────────────────────────────────────────
     The anchor carries the most visual weight. Only the nearest `linkedCount`
     features become labelled, connected nodes; the rest stay quiet dots.
     Labels appear on hover or focus rather than being permanently pinned, which
     is what keeps this a readable network instead of a spiderweb. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    anchorMarkerRef.current?.remove();
    anchorMarkerRef.current = null;
    nodeMarkersRef.current.forEach((m) => m.remove());
    nodeMarkersRef.current = [];

    if (!selectedHotspot) return;

    const anchor = selectedHotspot.location.coordinates as [number, number];
    const selectedClassification = classifications.get(selectedHotspot._id);
    const selectedClass = selectedClassification?.predictedClass ?? null;
    const color =
      renderMode === 'firms'
        ? FIRMS_RED
        : selectedClass
          ? CLASS_CONFIG[selectedClass].mark
          : UNCLASSIFIED_RING;

    const anchorEl = document.createElement('div');
    anchorEl.style.cssText = 'width:44px;height:44px;display:grid;place-items:center;pointer-events:none';
    anchorEl.innerHTML = `
      <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
        <circle cx="22" cy="22" r="17" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.55"/>
        <circle cx="22" cy="22" r="17" fill="none" stroke="${color}" stroke-width="1.5"/>
        <line x1="22" y1="1" x2="22" y2="9" stroke="${color}" stroke-width="1.5"/>
        <line x1="22" y1="35" x2="22" y2="43" stroke="${color}" stroke-width="1.5"/>
        <line x1="1" y1="22" x2="9" y2="22" stroke="${color}" stroke-width="1.5"/>
        <line x1="35" y1="22" x2="43" y2="22" stroke="${color}" stroke-width="1.5"/>
        <circle cx="22" cy="22" r="4" fill="${
          selectedClass || renderMode === 'firms' ? color : 'none'
        }" stroke="${selectedClass || renderMode === 'firms' ? '#ffffff' : color}" stroke-width="1.5"/>
      </svg>`;
    anchorMarkerRef.current = new Marker({ element: anchorEl }).setLngLat(anchor).addTo(map);

    linkedFeatures.forEach((f, i) => {
      const theme = OSM_CATEGORY_STYLE[f.featureCategory] ?? OSM_CATEGORY_STYLE.other;
      const dist =
        f.distance_m != null
          ? f.distance_m >= 1000
            ? `${(f.distance_m / 1000).toFixed(1)} km`
            : `${Math.round(f.distance_m)} m`
          : '';

      const el = document.createElement('div');
      el.className = 'map-node';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `${f.name || 'Unnamed feature'}, ${theme.label}, ${dist}`);
      el.innerHTML = `
        <span class="map-node-badge material-symbols-outlined" style="color:${theme.color}">${theme.icon}</span>
        <span class="map-node-label">${i + 1}. ${f.name || 'Unnamed'}${dist ? ` \u00b7 ${dist}` : ''}</span>`;

      nodeMarkersRef.current.push(
        new Marker({ element: el }).setLngLat([f.longitude, f.latitude]).addTo(map)
      );
    });

    return () => {
      anchorMarkerRef.current?.remove();
      anchorMarkerRef.current = null;
      nodeMarkersRef.current.forEach((m) => m.remove());
      nodeMarkersRef.current = [];
    };
  }, [selectedHotspot, classifications, renderMode, linkedFeatures]);

  /* ── Camera ───────────────────────────────────────────────────────────────
     Frames the whole network, not just its anchor. Nearby infrastructure is
     routinely 10–20 km out, so a fixed zoom would put every linked node
     off-screen and make the network look like it failed to draw. The OSM query
     resolves after the selection, so this moves twice: to the anchor, then
     wider once the network arrives. */
  const framedRef = useRef<{ id: string | null; linked: number }>({ id: null, linked: -1 });

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedHotspot) {
      framedRef.current = { id: null, linked: -1 };
      return;
    }

    const id = selectedHotspot._id;
    const prev = framedRef.current;
    if (prev.id === id && prev.linked === linkedFeatures.length) return;
    framedRef.current = { id, linked: linkedFeatures.length };

    const anchor = selectedHotspot.location.coordinates as [number, number];
    // Keep the anchor clear of the drawer on the left and the panel on the right.
    const padding = { top: 90, bottom: 90, left: 340, right: 410 };

    if (linkedFeatures.length === 0) {
      map.flyTo({ center: anchor, zoom: 12.5, speed: 1.1, curve: 1.4, padding });
      return;
    }

    let [west, south] = anchor;
    let [east, north] = anchor;
    for (const f of linkedFeatures) {
      west = Math.min(west, f.longitude);
      east = Math.max(east, f.longitude);
      south = Math.min(south, f.latitude);
      north = Math.max(north, f.latitude);
    }

    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding, maxZoom: 13.5, duration: 900 }
    );
  }, [selectedHotspot, linkedFeatures]);

  /* ── Search target ────────────────────────────────────────────────────── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !targetLocation) return;

    targetMarkerRef.current?.remove();
    const el = document.createElement('div');
    el.style.cssText = 'width:28px;height:28px;display:grid;place-items:center;pointer-events:none';
    el.innerHTML = `
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <circle cx="14" cy="14" r="9" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.6"/>
        <circle cx="14" cy="14" r="9" fill="none" stroke="#0A6C8C" stroke-width="1.5"/>
        <circle cx="14" cy="14" r="3" fill="#0A6C8C"/>
      </svg>`;
    targetMarkerRef.current = new Marker({ element: el })
      .setLngLat(targetLocation.coordinates)
      .addTo(map);

    map.flyTo({
      center: targetLocation.coordinates,
      zoom: targetLocation.zoom ?? 13,
      speed: 1.2,
      curve: 1.4,
    });
  }, [targetLocation]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-canvas-sunk">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Sits above MapLibre's attribution strip rather than on top of it. */}
      <div className="absolute bottom-9 right-4 z-20 flex flex-col overflow-hidden rounded-md glass">
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn()}
          className="ctl h-8 w-8 rounded-none"
          aria-label="Zoom in"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 17 }} aria-hidden="true">
            add
          </span>
        </button>
        <span className="h-px bg-hairline" aria-hidden="true" />
        <button
          type="button"
          onClick={() => mapRef.current?.zoomOut()}
          className="ctl h-8 w-8 rounded-none"
          aria-label="Zoom out"
        >
          <span className="material-symbols-outlined" style={{ fontSize: 17 }} aria-hidden="true">
            remove
          </span>
        </button>
      </div>
    </div>
  );
}
