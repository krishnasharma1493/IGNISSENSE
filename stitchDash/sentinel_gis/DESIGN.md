---
name: Sentinel-GIS
colors:
  surface: '#101415'
  surface-dim: '#101415'
  surface-bright: '#363a3b'
  surface-container-lowest: '#0b0f10'
  surface-container-low: '#191c1e'
  surface-container: '#1d2022'
  surface-container-high: '#272a2c'
  surface-container-highest: '#323537'
  on-surface: '#e0e3e5'
  on-surface-variant: '#c6c6cd'
  inverse-surface: '#e0e3e5'
  inverse-on-surface: '#2d3133'
  outline: '#909097'
  outline-variant: '#45464d'
  surface-tint: '#bec6e0'
  primary: '#bec6e0'
  on-primary: '#283044'
  primary-container: '#0f172a'
  on-primary-container: '#798098'
  inverse-primary: '#565e74'
  secondary: '#b9c7e0'
  on-secondary: '#233144'
  secondary-container: '#3c4a5e'
  on-secondary-container: '#abb9d2'
  tertiary: '#b9c8de'
  on-tertiary: '#233143'
  tertiary-container: '#081828'
  on-tertiary-container: '#738296'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d5e3fd'
  secondary-fixed-dim: '#b9c7e0'
  on-secondary-fixed: '#0d1c2f'
  on-secondary-fixed-variant: '#3a485c'
  tertiary-fixed: '#d4e4fa'
  tertiary-fixed-dim: '#b9c8de'
  on-tertiary-fixed: '#0d1c2d'
  on-tertiary-fixed-variant: '#39485a'
  background: '#101415'
  on-background: '#e0e3e5'
  surface-variant: '#323537'
  industrial-fire: '#ef4444'
  gas-flare: '#f59e0b'
  wildfire: '#fbbf24'
  agri: '#facc15'
  mining: '#a855f7'
  other-status: '#64748b'
  intelligence-blue: '#0f172a'
  shell-slate: '#1e293b'
typography:
  display-xl:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '900'
    lineHeight: '1.1'
    letterSpacing: -0.04em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '900'
    lineHeight: '1.2'
    letterSpacing: -0.03em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '900'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  kpi-value:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: '1.4'
    letterSpacing: 0.01em
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
    letterSpacing: '0'
  metadata-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.5'
    letterSpacing: 0.02em
  status-pill:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

The design system is a premium geospatial intelligence platform designed for high-stakes operational environments. It facilitates rapid decision-making through a "Hybrid Analytical" theme—merging a dark, focused operational "shell" with neutral, high-contrast map surfaces for maximum data legibility.

The brand personality is **Precise, Authoritative, and Technical**. It targets intelligence analysts, environmental researchers, and logistics directors who require a UI that recedes to prioritize complex spatial data.

The visual direction follows a **Corporate / Modern** style with **Minimalist** and **Glassmorphic** influences:
- **Operational Shell:** Deep indigo and slate backgrounds provide a non-distracting environment.
- **Glassmorphic Overlays:** Map filters and legends use subtle backdrop blurs to maintain spatial context.
- **Precision Engineering:** Sharp 8px grid alignment and rigorous typographic hierarchy evoke a sense of reliability and scientific rigor.

## Colors

The palette is anchored by **Intelligence Blue** (#0f172a), used for the primary operational shell and structural navigation. This is supported by a range of **Slates** to create depth within the dark interface. 

The system utilizes a specific **Classification Palette** for geospatial markers and data visualization. These colors are selected for high chroma to ensure they remain distinct when overlaid on varied map textures (satellite, topographic, or dark-mode vectors). 

- **Primary Shell:** Intelligence Blue (#0f172a)
- **Secondary Surfaces:** Slate (#334155)
- **Neutral/Text:** Off-white (#f8fafc) for high-contrast legibility against dark backgrounds.
- **Data Classifications:** High-visibility tones for Industrial (Red), Gas (Amber), and Agri (Yellow) to facilitate instant pattern recognition.

## Typography

This design system uses **Inter** exclusively to ensure a technical, utilitarian aesthetic. 

The typographic strategy relies on **extreme weight contrast** to establish hierarchy:
- **Major Titles:** Use Inter 900 with tight tracking (-0.04em) to create dense, impactful headers that feel like headlines.
- **KPIs and Labels:** Use Inter 600 for clarity and mid-level emphasis.
- **Body & Metadata:** Use Inter 400. Metadata should utilize a slightly increased letter spacing to maintain legibility at smaller sizes (12px).
- **Numbers:** When used in data tables or coordinate displays, use tabular sizing (tnum) features of Inter where possible to ensure vertical alignment.

## Layout & Spacing

The layout is built on a **12-column fluid grid** for the main content areas, but utilizes **fixed-width sidebars** for the operational "shell" to preserve the utility of technical tools.

- **Grid Model:** 8px base rhythm.
- **The Investigation Drawer:** A prominent right-side fixed drawer (width: 400px) handles detailed asset analysis.
- **Map Overlays:** Use a "No Grid" contextual approach, anchored to the corners of the viewport with a 24px safe-area margin.
- **Breakpoints:**
  - **Mobile (<768px):** Sidebars collapse into a bottom sheet; margins reduce to 16px.
  - **Tablet (768px - 1280px):** Investigation drawer becomes a collapsible overlay.
  - **Desktop (>1280px):** All panels are expanded; 32px external margins for high-density layouts.

## Elevation & Depth

Depth in the design system is communicated through **Tonal Layering** and **Glassmorphism**, rather than traditional drop shadows, to keep the UI feeling "flat" and integrated with the map.

- **Level 0 (Base):** The map surface itself.
- **Level 1 (Operational Shell):** Intelligence Blue (#0f172a) with solid opacity. No shadows; separation is achieved through 1px slate borders.
- **Level 2 (Overlays & Legends):** Semi-transparent Slate backgrounds with a `backdrop-filter: blur(12px)`. This allows the user to perceive map movement behind the UI.
- **Level 3 (Modals & Investigation Drawer):** Solid surfaces with a subtle, extra-diffused ambient shadow (15% opacity, 20px blur) to indicate the highest level of the hierarchy.

## Shapes

The shape language is a "Technical Rounded" aesthetic. It balances the precision of geo-data with the modern feel of premium software.

- **Major Cards:** 16px - 24px corners create a distinct container for high-density KPI data.
- **Inputs & Controls:** 12px corners (Standardized `rounded-lg`).
- **Status Badges:** Full pill-shape (9999px) to clearly differentiate status indicators from interactive buttons.
- **Interactive Elements:** Buttons follow the 12px corner radius of inputs for consistency in the "control" family.

## Components

### Buttons
- **Primary:** Intelligence Blue fill with 1px border of Slate-400. Text is Inter 600.
- **Map Tools:** 40x40px square icon buttons with 12px roundedness, using the Glassmorphic overlay style.

### KPI Cards
High visual density cards.
- **Top:** 12px Metadata Label (Inter 400).
- **Middle:** 24px Large Value (Inter 600).
- **Bottom:** Micro-sparkline or percentage change indicator.
- **Style:** 16px padding, Intelligence Blue background, 1px Slate border.

### Status Badges (Pills)
- Small, uppercase text (Inter 600).
- Backgrounds use the **Named Colors** at 20% opacity with 100% opacity text of the same hue for a "glow" effect that remains legible.

### Investigation Drawer
- **Header:** Sticky header with 24px padding and a "Close" affordance.
- **Content:** Vertically scrolling sections separated by 1px slate dividers.
- **Typography:** Uses `metadata-sm` for technical specs (lat/long, timestamps).

### Map-Overlay Filters
- Floating horizontal bar or vertical stack.
- Uses `backdrop-filter: blur(12px)` and semi-transparent Slate backgrounds to avoid obscuring map features.

### Inputs
- **Base:** Dark slate background (#1e293b) with 1px border.
- **Focus State:** 1px border of `secondary_color` with a subtle outer glow.