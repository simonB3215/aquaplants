# Dashboard Page Overrides

> **PROJECT:** AquaPlants
> **Generated:** 2026-11-03 20:30:20 (UI UX Pro Max `--design-system --persist --page dashboard`)
> **Page Type:** Dashboard / Data View
> **Project overrides added:** 2026-11-03 — derived from supplementary skill searches listed at the end.

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/aquaplants/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1400px or full-width
- **Grid:** 12-column grid for data flexibility
- **Desktop (≥1024px):** floating left sidebar with icon + visible text label (no hover-only labels); content area with KPI row (4 cards), wide chart card + side panel, then tables.
- **Tablet/Phone (<1024px):** floating bottom pill navigation (max 5 destinations + «Más»), stacked cards, one column at ≤600px. Content gets bottom inset so nothing hides behind the bar (safe-area aware).
- Reference widths verified: 360, 390, 768, 1024, 1440 px. No horizontal page scroll; wide tables scroll inside their own container.

### Spacing Overrides

- **Content Density:** High — optimize for information display (Master density 7/10 spacing tokens are kept).

### Typography Overrides

- Headings and **numeric readings** use Fira Code (tabular figures keep values from jumping during the 5 s refresh). Body, labels and forms use Fira Sans. Body ≥ 16px on inputs (prevents iOS zoom); minimum UI text 12px.
- Fonts are self-hosted (`@fontsource`) so the PWA shell renders offline and no third-party request is made.

### Color Overrides

The Master palette is kept (primary `#15803D`, accent `#A16207`, background `#F0FDF4`, foreground `#14532D`). Added semantic tokens for monitoring states — **always paired with an icon and a text label** (UX rule "Color Only", severity High):

| Token | Hex | Meaning | Icon (Lucide) |
|-------|-----|---------|---------------|
| `--estado-normal` | `#15803D` | Normal / Conectado | `CircleCheck` / `Wifi` |
| `--estado-advertencia` | `#A16207` | Advertencia | `TriangleAlert` |
| `--estado-critico` | `#B91C1C` | Crítico | `OctagonAlert` |
| `--estado-sin-senal` | `#475569` | Sin señal (cause unknown) | `WifiOff` |
| `--estado-sincronizando` | `#1D4ED8` | Sincronizando (blue: water/info) | `RefreshCw` |
| `--estado-servidor` | `#7C2D12` | Error de servidor (client-side) | `ServerCrash` |
| `--estado-neutro` | `#64748B` | Sin umbral / sin datos | `CircleDashed` |
| `--color-info` | `#0369A1` | Informational accents, charts series 2 | — |

Each state color is used on a tinted background (≈10 % alpha) with ≥ 4.5:1 text contrast.

### Component Overrides

- **Cards:** subtle glassmorphism inspired by the user reference image (style search: Glassmorphism, `backdrop-filter: blur(14px)`, translucent white 72 %, 1px white border 60 %) over a calm light green/blue organic background. Opacity is high enough to keep text ≥ 4.5:1; `@supports not (backdrop-filter)` falls back to solid white. Cards are **not** clickable by default (Master `cursor:pointer` applies only to interactive cards). Radius 20px (Master «Rounded corners 16–24px»).
- **Buttons:** Master primary (accent gold) for the main action of a view; secondary outline green; icon buttons ≥ 44×44 px with `aria-label`.
- **Motion:** 150–250 ms color/opacity/shadow transitions only (no layout-shifting transforms); everything disabled under `prefers-reduced-motion`. GSAP from the Master is **not** used (dashboard has no scroll storytelling; avoids a dependency).

---

## Page-Specific Components

- **KPI card** (icon chip + value + label + context line), like the reference image's top row, with monitoring content: «Mis torres», «Dispositivos conectados», «Sin señal», «Alertas activas».
- **Tower card**: crop, variables (value + unit + state badge + thresholds + timestamp), device connectivity, stale-data notice.
- **History chart**: Chart.js line (skill chart search «line chart trend threshold» → Line Chart, Chart.js); threshold band (warning) shaded + critical limits dashed; data gaps shown as breaks (never interpolated); legend + tooltip; series also distinguished by dash pattern, not hue alone.
- **Connectivity indicator** in the top bar: device-independent client states «Sin Internet» (phone) and «Sin conexión con el servidor» (API) — never marks towers as disconnected by itself.

---

## Recommendations

- Effects: Hover tooltips, chart zoom on click, row highlighting on hover, smooth filter animations, data loading spinners
- Loading: stable skeletons with `aria-busy` (UX «Loading Indicators»).
- Forms: inline error below each field linked with `aria-describedby` (UX «Error Placement»).
- Telemetry is labelled as live only when backed by a current source, with update time and stale state (skill pattern «Real-Time / Operations»).

### Skill searches used for these overrides (reproducible)

```
search.py "agriculture IoT monitoring dashboard hydroponic sensors realtime" --design-system --persist -p "AquaPlants" --density 7 --variance 4 --motion 3 --page dashboard
search.py "smart farming monitoring admin dashboard" --design-system      # retry: pattern «Real-Time / Operations» (only its telemetry rule adopted)
search.py "glassmorphism light dashboard" --domain style
search.py "line chart trend threshold" --domain chart
search.py "status indicator color not only" --domain ux
search.py "touch target size" --domain ux
search.py "loading skeleton" --domain ux
search.py "error message near field" --domain ux
search.py "dashboard performance memo polling" --stack react
```
Searches «stale data live update timestamp» and «live data freshness» returned off-topic rows (Bulk Actions / Auto-Play); per the skill's query contract they were not persisted.
