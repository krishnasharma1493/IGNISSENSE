/**
 * OSM Feature Taxonomy — Controlled Classification Constants
 *
 * Maps raw OpenStreetMap tags into a normalized, bounded taxonomy
 * designed for ML feature engineering. Every OSM feature ingested
 * into the India-wide geospatial context database is classified
 * into one of these categories.
 *
 * IMPORTANT: This taxonomy is the single source of truth for
 * how OSM tags map to ML-relevant categories. Both the extraction
 * pipeline and the enrichment service reference this file.
 */

// ─── Top-Level Feature Categories ────────────────────────────────────────────

export const FEATURE_CATEGORIES = [
  'industrial',
  'oil_gas',
  'mining',
  'power',
  'forest',
  'agriculture',
  'urban',
  'water',
  'other',
] as const;

export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

// ─── Subcategory Definitions ─────────────────────────────────────────────────

export const SUBCATEGORIES: Record<FeatureCategory, readonly string[]> = {
  industrial: [
    'factory',
    'industrial_area',
    'refinery',
    'steel_plant',
    'cement_plant',
    'chemical_plant',
    'manufacturing',
    'warehouse',
    'brick_kiln',
    'works',
    'general_industrial',
  ],
  oil_gas: [
    'refinery',
    'petroleum_well',
    'gas_flare',
    'oil_terminal',
    'pipeline_station',
    'lpg_plant',
    'oil_gas_facility',
  ],
  mining: [
    'quarry',
    'mine',
    'mining_area',
    'extraction_site',
    'coal_mine',
    'opencast_mine',
  ],
  power: [
    'power_plant',
    'thermal_power_station',
    'solar_farm',
    'wind_farm',
    'substation',
    'hydroelectric',
  ],
  forest: [
    'forest',
    'woodland',
    'scrub',
    'nature_reserve',
  ],
  agriculture: [
    'farmland',
    'orchard',
    'vineyard',
    'greenhouse',
    'meadow',
    'grass',
  ],
  urban: [
    'residential',
    'commercial',
    'retail',
    'industrial_land',
    'built_up',
  ],
  water: [
    'water',
    'wetland',
    'reservoir',
    'riverbank',
  ],
  other: [
    'military',
    'railway_yard',
    'waste_disposal',
    'landfill',
    'unknown',
  ],
};

// ─── Land Cover Encoding (ML Feature) ────────────────────────────────────────
// Maps feature categories to land cover encodings aligned with feature_schema.json.

export const LANDCOVER_ENCODING: Record<string, number> = {
  built_up: 0,
  cropland: 1,
  forest: 2,
  bare: 3,
  water: 4,
  other: 5,
};

// Maps FeatureCategory → landcover encoding for contextual inference
export const CATEGORY_TO_LANDCOVER: Record<FeatureCategory, string> = {
  industrial: 'built_up',
  oil_gas: 'built_up',
  mining: 'bare',
  power: 'built_up',
  forest: 'forest',
  agriculture: 'cropland',
  urban: 'built_up',
  water: 'water',
  other: 'other',
};

// ─── OSM Tag → Category Classifier ──────────────────────────────────────────
// Deterministic function mapping raw OSM tags to our controlled taxonomy.

export function classifyOsmTags(tags: Record<string, string>): {
  category: FeatureCategory;
  subcategory: string;
} {
  // Priority order: most specific tags first

  // 1. Mining / Quarry
  if (tags.landuse === 'quarry') {
    return { category: 'mining', subcategory: 'quarry' };
  }
  if (tags.mining || tags.resource === 'coal' || tags['resource:type'] === 'coal') {
    const sub = tags.mining === 'opencast' ? 'opencast_mine'
      : tags.resource === 'coal' ? 'coal_mine' : 'mine';
    return { category: 'mining', subcategory: sub };
  }

  // 2. Oil & Gas
  if (tags.industrial === 'refinery' || tags.petroleum === 'refinery') {
    return { category: 'oil_gas', subcategory: 'refinery' };
  }
  if (tags.man_made === 'petroleum_well' || tags.man_made === 'oil_well') {
    return { category: 'oil_gas', subcategory: 'petroleum_well' };
  }
  if (tags.man_made === 'flare' || tags.man_made === 'gas_flare') {
    return { category: 'oil_gas', subcategory: 'gas_flare' };
  }
  if (tags.pipeline === 'substation' || tags.man_made === 'pipeline') {
    return { category: 'oil_gas', subcategory: 'pipeline_station' };
  }
  if (tags.industrial === 'oil' || tags.industrial === 'gas' || tags.product === 'gas') {
    return { category: 'oil_gas', subcategory: 'oil_gas_facility' };
  }

  // 3. Power infrastructure
  if (tags.power === 'plant' || tags.power === 'generator') {
    const source = tags['plant:source'] || tags['generator:source'] || '';
    if (source === 'solar') return { category: 'power', subcategory: 'solar_farm' };
    if (source === 'wind') return { category: 'power', subcategory: 'wind_farm' };
    if (source === 'hydro') return { category: 'power', subcategory: 'hydroelectric' };
    if (source === 'coal' || source === 'gas' || source === 'nuclear') {
      return { category: 'power', subcategory: 'thermal_power_station' };
    }
    return { category: 'power', subcategory: 'power_plant' };
  }
  if (tags.power === 'substation' && tags.voltage) {
    return { category: 'power', subcategory: 'substation' };
  }

  // 4. Industrial
  if (tags.industrial === 'steel_mill' || tags.product === 'steel') {
    return { category: 'industrial', subcategory: 'steel_plant' };
  }
  if (tags.industrial === 'cement' || tags.product === 'cement') {
    return { category: 'industrial', subcategory: 'cement_plant' };
  }
  if (tags.industrial === 'chemical' || tags.product === 'chemical') {
    return { category: 'industrial', subcategory: 'chemical_plant' };
  }
  if (tags.craft === 'brickmaker' || tags.industrial === 'brickyard') {
    return { category: 'industrial', subcategory: 'brick_kiln' };
  }
  if (tags.man_made === 'works') {
    return { category: 'industrial', subcategory: 'works' };
  }
  if (tags.building === 'warehouse' || tags.building === 'industrial') {
    return { category: 'industrial', subcategory: 'warehouse' };
  }
  if (tags.building === 'factory' || tags.man_made === 'factory') {
    return { category: 'industrial', subcategory: 'factory' };
  }
  if (tags.industrial) {
    return { category: 'industrial', subcategory: 'general_industrial' };
  }
  if (tags.landuse === 'industrial') {
    return { category: 'industrial', subcategory: 'industrial_area' };
  }

  // 5. Environmental — Forest
  if (tags.landuse === 'forest' || tags.natural === 'wood') {
    return { category: 'forest', subcategory: 'forest' };
  }
  if (tags.natural === 'scrub' || tags.natural === 'heath') {
    return { category: 'forest', subcategory: 'scrub' };
  }
  if (tags.leisure === 'nature_reserve' || tags.boundary === 'national_park') {
    return { category: 'forest', subcategory: 'nature_reserve' };
  }

  // 6. Agriculture
  if (tags.landuse === 'farmland' || tags.landuse === 'farm') {
    return { category: 'agriculture', subcategory: 'farmland' };
  }
  if (tags.landuse === 'orchard') {
    return { category: 'agriculture', subcategory: 'orchard' };
  }
  if (tags.landuse === 'vineyard') {
    return { category: 'agriculture', subcategory: 'vineyard' };
  }
  if (tags.landuse === 'meadow' || tags.landuse === 'grass') {
    return { category: 'agriculture', subcategory: 'meadow' };
  }
  if (tags.building === 'greenhouse' || tags.landuse === 'greenhouse_horticulture') {
    return { category: 'agriculture', subcategory: 'greenhouse' };
  }

  // 7. Urban
  if (tags.landuse === 'residential') {
    return { category: 'urban', subcategory: 'residential' };
  }
  if (tags.landuse === 'commercial' || tags.landuse === 'retail') {
    return { category: 'urban', subcategory: 'commercial' };
  }

  // 8. Water
  if (tags.natural === 'water' || tags.natural === 'lake') {
    return { category: 'water', subcategory: 'water' };
  }
  if (tags.natural === 'wetland') {
    return { category: 'water', subcategory: 'wetland' };
  }
  if (tags.landuse === 'reservoir' || tags.water === 'reservoir') {
    return { category: 'water', subcategory: 'reservoir' };
  }

  // 9. Other relevant
  if (tags.landuse === 'landfill' || tags.landuse === 'brownfield') {
    return { category: 'other', subcategory: 'waste_disposal' };
  }
  if (tags.landuse === 'military') {
    return { category: 'other', subcategory: 'military' };
  }
  if (tags.landuse === 'railway') {
    return { category: 'other', subcategory: 'railway_yard' };
  }

  return { category: 'other', subcategory: 'unknown' };
}

/**
 * Derive a human-readable name from OSM tags.
 * Falls back through: name → name:en → operator → descriptive default.
 */
export function deriveOsmName(tags: Record<string, string>, category: FeatureCategory, subcategory: string): string {
  if (tags.name) return tags.name;
  if (tags['name:en']) return tags['name:en'];
  if (tags.operator) return tags.operator;

  // Generate descriptive default
  const sub = subcategory.replace(/_/g, ' ');
  return `${capitalize(sub)}`;
}

function capitalize(s: string): string {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
