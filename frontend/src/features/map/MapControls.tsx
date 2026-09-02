import Panel from '../../components/ui/Panel';
import { BASEMAP_META } from './basemaps';
import type { MapBasemap, RenderMode } from './basemaps';

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string; icon: string; title?: string }[];
  onChange: (v: T) => void;
}

function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          title={o.title ?? o.label}
          className="ctl h-7 px-2 text-[11px]"
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 14 }}
            data-filled={value === o.value ? 'true' : undefined}
            aria-hidden="true"
          >
            {o.icon}
          </span>
          <span className="hidden lg:inline">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

interface MapControlsProps {
  basemap: MapBasemap;
  onBasemapChange: (b: MapBasemap) => void;
  renderMode: RenderMode;
  onRenderModeChange: (m: RenderMode) => void;
}

/**
 * The two decisions that change what the map looks like, and nothing else.
 * Layer visibility and filtering live in the drawer, so this cluster stays small
 * enough not to compete with the investigation panel beneath it.
 */
export default function MapControls({
  basemap,
  onBasemapChange,
  renderMode,
  onRenderModeChange,
}: MapControlsProps) {
  return (
    <Panel level="chrome" className="flex items-center gap-1 rounded-lg px-1 py-1">
      <Segmented<MapBasemap>
        label="Basemap"
        value={basemap}
        onChange={onBasemapChange}
        options={(Object.keys(BASEMAP_META) as MapBasemap[]).map((k) => ({
          value: k,
          label: BASEMAP_META[k].label,
          icon: BASEMAP_META[k].icon,
        }))}
      />

      <span className="h-4 w-px bg-hairline" aria-hidden="true" />

      <Segmented<RenderMode>
        label="Marker colouring"
        value={renderMode}
        onChange={onRenderModeChange}
        options={[
          {
            value: 'firms',
            label: 'FIRMS',
            icon: 'local_fire_department',
            title: 'Uniform red, as NASA FIRMS renders thermal anomalies',
          },
          {
            value: 'classified',
            label: 'Classified',
            icon: 'category',
            title: 'Colour each detection by its predicted class',
          },
        ]}
      />
    </Panel>
  );
}
