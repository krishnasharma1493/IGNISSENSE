import { useRef, useEffect, useState, useMemo } from 'react';
import { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DELHI_NCR, ALL_INDIA, CLASS_CONFIG } from '../../types';
import type { Hotspot, Facility, Classification, ClassificationClass } from '../../types';
import LiveStreamHUD from './LiveStreamHUD';


export type MapBasemap = 'dark' | 'satellite' | 'voyager';

export const BASEMAP_STYLES: Record<MapBasemap, any> = {
  dark: {
    version: 8,
    sources: {
      'carto-dark': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
          'https://d.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}@2x.png',
        ],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      },
    },
    layers: [
      {
        id: 'carto-dark-layer',
        type: 'raster',
        source: 'carto-dark',
        minzoom: 0,
        maxzoom: 20,
      },
    ],
  },
  satellite: {
    version: 8,
    sources: {
      'esri-sat': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: '&copy; Esri, Earthstar Geographics',
      },
    },
    layers: [
      {
        id: 'esri-sat-layer',
        type: 'raster',
        source: 'esri-sat',
        minzoom: 0,
        maxzoom: 20,
      },
    ],
  },
  voyager: {
    version: 8,
    sources: {
      'carto-voyager': {
        type: 'raster',
        tiles: [
          'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
          'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
          'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
          'https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        ],
        tileSize: 256,
        attribution: '&copy; OpenStreetMap &copy; CARTO',
      },
    },
    layers: [
      {
        id: 'carto-voyager-layer',
        type: 'raster',
        source: 'carto-voyager',
        minzoom: 0,
        maxzoom: 20,
      },
    ],
  },
};

interface MapViewProps {
  hotspots: Hotspot[];
  facilities: Facility[];
  classifications: Map<string, Classification>;
  selectedHotspotId: string | null;
  onHotspotSelect: (id: string) => void;
  classFilter: ClassificationClass | null;
  targetLocation?: { coordinates: [number, number]; label?: string; zoom?: number } | null;
}

export default function MapView({
  hotspots,
  facilities,
  classifications,
  selectedHotspotId,
  onHotspotSelect,
  targetLocation,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const facilityMarkersRef = useRef<Marker[]>([]);
  const targetMarkerRef = useRef<Marker[]>([]);

  const [basemap, setBasemap] = useState<MapBasemap>('satellite');
  const [showFacilities, setShowFacilities] = useState(true);
  const [isLiveIndia, setIsLiveIndia] = useState(true);
  const [renderMode, setRenderMode] = useState<'ai_classified' | 'firms_classic'>('firms_classic');
  const [activeClassFilter, setActiveClassFilter] = useState<string>('all');
  const [isLiveStreamOpen, setIsLiveStreamOpen] = useState<boolean>(true);


  // Classification summary statistics
  const stats = useMemo(() => {
    let industrial = 0;
    let gasFlare = 0;
    let agri = 0;
    let wildfire = 0;
    let mining = 0;

    hotspots.forEach((h) => {
      const c = classifications.get(h._id);
      const cls = c?.predictedClass || 'agricultural_burning';
      if (cls === 'industrial_fire') industrial++;
      else if (cls === 'gas_flare') gasFlare++;
      else if (cls === 'agricultural_burning') agri++;
      else if (cls === 'wildfire') wildfire++;
      else if (cls === 'mining_thermal_activity') mining++;
    });

    return { total: hotspots.length, industrial, gasFlare, agri, wildfire, mining };
  }, [hotspots, classifications]);

  // Filtered hotspots for map display
  const displayedHotspots = useMemo(() => {
    if (activeClassFilter === 'all') return hotspots;
    return hotspots.filter((h) => {
      const c = classifications.get(h._id);
      const cls = c?.predictedClass || 'agricultural_burning';
      return cls === activeClassFilter;
    });
  }, [hotspots, classifications, activeClassFilter]);

  // Convert hotspots to GeoJSON for high-performance WebGL rendering
  const geojsonData = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: displayedHotspots.map((h) => {
        const c = classifications.get(h._id);
        const cls = c?.predictedClass || 'agricultural_burning';
        const cfg = CLASS_CONFIG[cls] || { color: '#EF4444', label: 'Fire', icon: '🔥' };

        // In FIRMS classic mode: vibrant glowing red fire square/dot (#FF2222)
        // In AI Classified mode: color-coded by class
        const pointColor = renderMode === 'firms_classic' ? '#FF2222' : cfg.color;

        return {
          type: 'Feature' as const,
          geometry: h.location,
          properties: {
            id: h._id,
            frp: h.frp || 12.0,
            brightness: h.brightness || 320.0,
            satellite: h.satellite || 'Aqua',
            instrument: h.instrument || 'MODIS',
            confidence: h.confidence || 'Nominal',
            detectedAt: h.detectedAt || '',
            predictedClass: cls,
            classLabel: cfg.label,
            classIcon: cfg.icon,
            color: pointColor,
            anomalyScore: c?.anomalyScore?.toFixed(2) || '0.75',
            facilityDistance: c?.facilityDistanceMeters ? `${Math.round(c.facilityDistanceMeters)}m` : 'N/A',
          },
        };
      }),
    };
  }, [displayedHotspots, classifications, renderMode]);

  // Initialize MapLibre
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLES[basemap],
      center: ALL_INDIA.center,
      zoom: ALL_INDIA.zoom,
      attributionControl: false,
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update style when basemap changes & re-add GeoJSON layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(BASEMAP_STYLES[basemap]);
  }, [basemap]);

  // Add / Update MapLibre WebGL Live Fire Layers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const setupLayers = () => {
      // 1. Source
      if (map.getSource('firms-india-source')) {
        (map.getSource('firms-india-source') as any).setData(geojsonData);
      } else {
        map.addSource('firms-india-source', {
          type: 'geojson',
          data: geojsonData,
        });
      }

      // 2. Heatmap Density Layer (Visible at overview zooms 3 to 8)
      if (!map.getLayer('firms-heat-layer')) {
        map.addLayer({
          id: 'firms-heat-layer',
          type: 'heatmap',
          source: 'firms-india-source',
          maxzoom: 9,
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['get', 'frp'], 0, 0.2, 50, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 1.8],
            'heatmap-color': [
              'interpolate',
              ['linear'],
              ['heatmap-density'],
              0,
              'rgba(0,0,0,0)',
              0.2,
              'rgba(245, 158, 11, 0.4)',
              0.4,
              'rgba(239, 68, 68, 0.7)',
              0.8,
              'rgba(255, 34, 34, 0.9)',
              1,
              'rgba(255, 255, 255, 0.95)',
            ],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 8, 18],
            'heatmap-opacity': 0.75,
          },
        });
      }

      // 3. Glowing Halo Circle Layer (NASA FIRMS Style Glow)
      if (!map.getLayer('firms-glow-layer')) {
        map.addLayer({
          id: 'firms-glow-layer',
          type: 'circle',
          source: 'firms-india-source',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 4.5, 7, 7.5, 12, 14],
            'circle-color': ['get', 'color'],
            'circle-blur': 0.6,
            'circle-opacity': 0.75,
          },
        });
      }

      // 4. Sharp Fire Core Point Layer
      if (!map.getLayer('firms-point-layer')) {
        map.addLayer({
          id: 'firms-point-layer',
          type: 'circle',
          source: 'firms-india-source',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2.5, 7, 4.5, 12, 7.5],
            'circle-color': ['get', 'color'],
            'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 7, 1, 12, 1.5],
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.95,
          },
        });
      }

      // 5. Click & Hover Handlers
      map.on('mouseenter', 'firms-point-layer', () => {
        map.getCanvas().style.cursor = 'pointer';
      });

      map.on('mouseleave', 'firms-point-layer', () => {
        map.getCanvas().style.cursor = '';
      });

      const popup = new Popup({
        offset: 12,
        closeButton: false,
        closeOnClick: false,
        maxWidth: '280px',
      });

      map.on('mousemove', 'firms-point-layer', (e) => {
        if (!e.features || e.features.length === 0) return;
        const f = e.features[0];
        const props = f.properties as any;
        const coords = (f.geometry as any).coordinates;

        popup
          .setLngLat(coords)
          .setHTML(
            `<div style="font-family:sans-serif;padding:2px 0;">
               <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                 <span style="font-weight:800;color:${props.color};font-size:12px;display:flex;align-items:center;gap:4px;">
                   <span>${props.classIcon}</span> <span>${props.classLabel}</span>
                 </span>
                 <span style="font-size:9.5px;background:rgba(255,255,255,0.15);padding:1px 5px;border-radius:4px;color:#cbd5e1;font-family:monospace;">
                   ${props.satellite} (${props.instrument})
                 </span>
               </div>
               <div style="font-size:11px;color:#e2e8f0;margin-bottom:2px;">
                 FRP: <strong style="color:#f87171">${parseFloat(props.frp).toFixed(1)} MW</strong> • Conf: <strong>${props.confidence}</strong>
               </div>
               <div style="font-size:10.5px;color:#94a3b8;font-family:monospace;">
                 📍 ${coords[1].toFixed(4)}°N, ${coords[0].toFixed(4)}°E
               </div>
               <div style="font-size:10px;color:#38bdf8;margin-top:4px;font-weight:600;">
                 Click to inspect telemetry →
               </div>
             </div>`
          )
          .addTo(map);
      });

      map.on('mouseleave', 'firms-point-layer', () => {
        popup.remove();
      });

      map.on('click', 'firms-point-layer', (e) => {
        if (!e.features || e.features.length === 0) return;
        const f = e.features[0];
        const hotspotId = f.properties?.id;
        if (hotspotId) {
          onHotspotSelect(hotspotId);
        }
      });
    };

    if (map.isStyleLoaded()) {
      setupLayers();
    } else {
      map.once('style.load', setupLayers);
    }
  }, [geojsonData, basemap, onHotspotSelect]);

  // Render Selected Hotspot Detailed Focus Marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    if (!selectedHotspotId) return;

    const hotspot = hotspots.find((h) => h._id === selectedHotspotId);
    if (!hotspot) return;

    const classification = classifications.get(hotspot._id);
    const cls = classification?.predictedClass || 'other_or_uncertain';
    const config = CLASS_CONFIG[cls] || { color: '#EF4444' };
    const [lng, lat] = hotspot.location.coordinates;

    const wrapper = document.createElement('div');
    wrapper.className = 'selected-fire-pin';
    wrapper.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      z-index: 100;
      transform: translate(-50%, -50%);
    `;

    const ring = document.createElement('div');
    ring.className = 'w-14 h-14 rounded-full border-2 border-dashed flex items-center justify-center relative animate-spin-slow';
    ring.style.borderColor = config.color;

    const core = document.createElement('div');
    core.className = 'w-4 h-4 rounded-full animate-pulse z-10';
    core.style.backgroundColor = config.color;
    core.style.boxShadow = `0 0 16px ${config.color}`;
    ring.appendChild(core);
    wrapper.appendChild(ring);

    const label = document.createElement('div');
    label.className = 'mt-1 bg-black/85 backdrop-blur-md px-2 py-0.5 rounded border border-white/30 text-white font-mono text-[10px] shadow-lg whitespace-nowrap';
    label.textContent = `LIVE: ${config.label} (${hotspot.frp?.toFixed(1) || '12'} MW)`;
    wrapper.appendChild(label);

    const marker = new Marker({ element: wrapper })
      .setLngLat([lng, lat])
      .addTo(map);

    markersRef.current.push(marker);
  }, [selectedHotspotId, hotspots, classifications]);

  // Update Facility Markers (when zoomed in)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    facilityMarkersRef.current.forEach((m) => m.remove());
    facilityMarkersRef.current = [];

    if (!showFacilities) return;

    facilities.forEach((facility) => {
      const [lng, lat] = facility.location.coordinates;

      const wrapper = document.createElement('div');
      wrapper.className = 'facility-marker-wrapper';
      wrapper.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        cursor: pointer;
        user-select: none;
      `;

      const box = document.createElement('div');
      box.className = 'facility-marker-box';
      box.style.cssText = `
        width: 7px;
        height: 7px;
        background: #38bdf8;
        border: 1.5px solid rgba(255,255,255,0.9);
        border-radius: 2px;
        transform: rotate(45deg);
        box-shadow: 0 0 8px rgba(56, 189, 248, 0.7);
      `;
      wrapper.appendChild(box);

      const marker = new Marker({ element: wrapper })
        .setLngLat([lng, lat])
        .addTo(map);

      facilityMarkersRef.current.push(marker);
    });
  }, [facilities, showFacilities]);

  // Target searched location pin
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    targetMarkerRef.current.forEach((m) => m.remove());
    targetMarkerRef.current = [];

    if (!targetLocation) return;

    const [lng, lat] = targetLocation.coordinates;

    const el = document.createElement('div');
    el.style.cssText = 'display: flex; flex-direction: column; align-items: center; z-index: 120; transform: translate(-50%, -50%);';

    const ring = document.createElement('div');
    ring.className = 'w-12 h-12 rounded-full border-2 border-primary flex items-center justify-center animate-ping relative';
    ring.style.boxShadow = '0 0 20px #38bdf8';

    const core = document.createElement('div');
    core.className = 'w-4 h-4 rounded-full bg-primary border-2 border-white shadow-[0_0_12px_#38bdf8] flex items-center justify-center text-[10px] text-black font-bold';
    core.textContent = '📍';

    const label = document.createElement('div');
    label.className = 'mt-1 bg-black/90 backdrop-blur-md px-2 py-0.5 rounded border border-primary text-primary font-mono text-[11px] font-bold shadow-lg whitespace-nowrap';
    label.textContent = targetLocation.label || `${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`;

    el.appendChild(ring);
    el.appendChild(core);
    el.appendChild(label);

    const marker = new Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    targetMarkerRef.current.push(marker);

    map.flyTo({
      center: [lng, lat],
      zoom: targetLocation.zoom || 13.5,
      speed: 1.3,
      curve: 1.4,
    });
  }, [targetLocation]);

  // Fly to selected hotspot
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedHotspotId) return;

    const hotspot = hotspots.find((h) => h._id === selectedHotspotId);
    if (hotspot) {
      map.flyTo({
        center: hotspot.location.coordinates,
        zoom: 13.5,
        speed: 1.2,
        curve: 1.4,
      });
    }
  }, [selectedHotspotId, hotspots]);

  // View Controls
  const handleZoomIn = () => mapRef.current?.zoomIn();
  const handleZoomOut = () => mapRef.current?.zoomOut();

  const handleToggleLiveIndia = () => {
    const map = mapRef.current;
    if (!map) return;
    setIsLiveIndia(true);
    setBasemap('satellite');
    map.flyTo({
      center: ALL_INDIA.center,
      zoom: ALL_INDIA.zoom,
      speed: 1.2,
      curve: 1.4,
    });
  };

  const handleFocusDelhiNcr = () => {
    const map = mapRef.current;
    if (!map) return;
    setIsLiveIndia(false);
    map.flyTo({
      center: DELHI_NCR.center,
      zoom: DELHI_NCR.zoom,
      speed: 1.2,
      curve: 1.4,
    });
  };

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0a0f12]">
      <div ref={containerRef} className="absolute inset-0" />

      {/* Subtle Map Grid Overlay */}
      <div
        className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)',
          backgroundSize: '80px 80px',
        }}
      />

      {/* ── Top Floating Action Island (macOS 26 Liquid Glass) ── */}
      <div className="absolute top-[80px] right-6 z-20 flex items-center gap-2 pointer-events-auto">
        {/* Live India Pan-Zoom Mode Toggle */}
        <button
          onClick={handleToggleLiveIndia}
          className={`liquid-btn px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
            isLiveIndia
              ? 'bg-red-600/85 text-white font-bold border-t border-white/40 shadow-[0_4px_16px_rgba(239,68,68,0.45)]'
              : 'liquid-glass-interactive text-on-surface hover:text-white'
          }`}
          title="Switch to Pan-India Complete Satellite Fire Grid"
        >
          <span className="w-2 h-2 rounded-full bg-white shadow-[0_0_8px_#ffffff] animate-ping" />
          <span className="tracking-wide uppercase sf-headline">LIVE INDIA ({stats.total})</span>
        </button>

        {/* Delhi NCR Focus Button */}
        <button
          onClick={handleFocusDelhiNcr}
          className={`liquid-btn px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
            !isLiveIndia
              ? 'liquid-glass-interactive bg-primary/25 text-primary border-t border-white/40 font-bold shadow-[0_4px_16px_rgba(112,210,255,0.25)]'
              : 'liquid-glass-interactive text-on-surface hover:text-white'
          }`}
          title="Focus Camera on Delhi NCR Focus Region"
        >
          <span className="material-symbols-outlined text-[16px]">my_location</span>
          <span className="sf-subhead">Delhi NCR</span>
        </button>

        {/* Basemap Switcher Pill */}
        <div className="liquid-glass-interactive p-1 rounded-xl flex items-center gap-1">
          <button
            onClick={() => setBasemap('satellite')}
            className={`liquid-btn px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 ${
              basemap === 'satellite'
                ? 'bg-primary/20 text-primary font-bold border-t border-white/30 shadow-sm'
                : 'text-on-surface-variant hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">satellite_alt</span>
            <span className="sf-subhead">Satellite</span>
          </button>
          <button
            onClick={() => setBasemap('dark')}
            className={`liquid-btn px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 ${
              basemap === 'dark'
                ? 'bg-primary/20 text-primary font-bold border-t border-white/30 shadow-sm'
                : 'text-on-surface-variant hover:text-white'
            }`}
          >
            <span className="material-symbols-outlined text-[14px]">dark_mode</span>
            <span className="sf-subhead">Dark</span>
          </button>
        </div>

        {/* Render Mode Switcher: FIRMS Classic (Red) vs AI Classified */}
        <div className="liquid-glass-interactive p-1 rounded-xl flex items-center gap-1">
          <button
            onClick={() => setRenderMode('firms_classic')}
            className={`liquid-btn px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 ${
              renderMode === 'firms_classic'
                ? 'bg-red-600/80 text-white font-bold border-t border-white/40 shadow-sm'
                : 'text-on-surface-variant hover:text-white'
            }`}
            title="Render all fires in uniform NASA FIRMS Satellite Red"
          >
            <span className="material-symbols-outlined text-[14px]">local_fire_department</span>
            <span className="sf-subhead">FIRMS Red</span>
          </button>
          <button
            onClick={() => setRenderMode('ai_classified')}
            className={`liquid-btn px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 ${
              renderMode === 'ai_classified'
                ? 'bg-primary/25 text-primary font-bold border-t border-white/40 shadow-sm'
                : 'text-on-surface-variant hover:text-white'
            }`}
            title="Render with ML Classification Color Badges (Industrial, Agri, Wildfire)"
          >
            <span className="material-symbols-outlined text-[14px]">psychology</span>
            <span className="sf-subhead">AI Classified</span>
          </button>
        </div>

        {/* Live Stream Console Toggle */}
        <button
          onClick={() => setIsLiveStreamOpen(!isLiveStreamOpen)}
          className={`liquid-btn px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 ${
            isLiveStreamOpen
              ? 'liquid-glass-interactive bg-emerald-500/20 text-emerald-300 border-t border-emerald-400/40 font-bold shadow-[0_2px_12px_rgba(16,185,129,0.2)]'
              : 'liquid-glass-interactive text-on-surface-variant hover:text-white'
          }`}
          title="Toggle Real-Time Satellite Detection & ML Classification Console"
        >
          <span className="material-symbols-outlined text-[16px] text-emerald-400 animate-pulse">radar</span>
          <span className="sf-subhead">Live Feed {isLiveStreamOpen ? 'ON' : 'OFF'}</span>
        </button>

        {/* Facilities Toggle */}
        <button
          onClick={() => setShowFacilities(!showFacilities)}
          className={`liquid-btn px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1 ${
            showFacilities
              ? 'liquid-glass-interactive text-primary border-t border-primary/40 font-bold'
              : 'liquid-glass-interactive text-on-surface-variant hover:text-white'
          }`}
          title="Toggle OSM industrial facility infrastructure points"
        >
          <span className="material-symbols-outlined text-[16px]">factory</span>
          <span className="sf-subhead">Facilities {showFacilities ? 'ON' : 'OFF'}</span>
        </button>
      </div>

      {/* ── Live ML Telemetry Feed Stream HUD ── */}
      <LiveStreamHUD
        hotspots={displayedHotspots}
        classifications={classifications}
        onSelectHotspot={(id) => onHotspotSelect(id)}
        isOpen={isLiveStreamOpen}
        onClose={() => setIsLiveStreamOpen(false)}
      />

      {/* ── Top Center Live Ticker HUD Banner ── */}
      <div className="absolute top-[88px] left-24 z-10 flex items-center gap-2 pointer-events-auto">
        <div className="liquid-glass-interactive px-4 py-1.5 rounded-full flex items-center gap-3 shadow-lg">
          <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444] animate-ping" />
            <span className="sf-metadata text-[10px]">NASA FIRMS TELEMETRY</span>
          </div>
          <span className="w-1 h-3 bg-white/20 rounded-full" />
          <div className="text-xs text-on-surface flex items-center gap-1.5 sf-subhead">
            <span className="font-bold text-white font-mono">{displayedHotspots.length}</span> active thermal observations
          </div>
        </div>
      </div>

      {/* ── Live Classification Filter Pills Bar (Floating Bottom-Center) ── */}
      <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-30 pointer-events-auto">
        <div className="liquid-glass-interactive p-1.5 rounded-2xl flex items-center gap-1 shadow-2xl">
          <button
            onClick={() => setActiveClassFilter('all')}
            className={`liquid-btn px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
              activeClassFilter === 'all'
                ? 'bg-white/20 text-white border-t border-white/40 shadow-sm'
                : 'text-on-surface-variant hover:text-white'
            }`}
          >
            <span className="sf-subhead">All Fires ({stats.total})</span>
          </button>

          <button
            onClick={() => setActiveClassFilter('industrial_fire')}
            className={`liquid-btn px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeClassFilter === 'industrial_fire'
                ? 'bg-red-500/90 text-white border-t border-white/40 shadow-[0_2px_12px_rgba(239,68,68,0.4)]'
                : 'text-red-400 hover:bg-red-500/10'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span className="sf-subhead">🏭 Industrial ({stats.industrial})</span>
          </button>

          <button
            onClick={() => setActiveClassFilter('agricultural_burning')}
            className={`liquid-btn px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeClassFilter === 'agricultural_burning'
                ? 'bg-amber-500/90 text-black border-t border-white/40 font-extrabold shadow-[0_2px_12px_rgba(245,158,11,0.4)]'
                : 'text-amber-400 hover:bg-amber-500/10'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span className="sf-subhead">🌾 Agri ({stats.agri})</span>
          </button>

          <button
            onClick={() => setActiveClassFilter('wildfire')}
            className={`liquid-btn px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              activeClassFilter === 'wildfire'
                ? 'bg-emerald-500/90 text-white border-t border-white/40 shadow-[0_2px_12px_rgba(16,185,129,0.4)]'
                : 'text-emerald-400 hover:bg-emerald-500/10'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="sf-subhead">🌲 Wildfire ({stats.wildfire})</span>
          </button>
        </div>
      </div>

      {/* Zoom Control Buttons */}
      <div className="absolute right-6 bottom-20 z-20 flex flex-col gap-1.5">
        <button
          onClick={handleZoomIn}
          className="liquid-btn w-9 h-9 liquid-glass-interactive rounded-xl text-on-surface hover:text-white flex items-center justify-center shadow-lg"
          title="Zoom In"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
        </button>
        <button
          onClick={handleZoomOut}
          className="liquid-btn w-9 h-9 liquid-glass-interactive rounded-xl text-on-surface hover:text-white flex items-center justify-center shadow-lg"
          title="Zoom Out"
        >
          <span className="material-symbols-outlined text-[18px]">remove</span>
        </button>
      </div>
    </div>
  );
}
