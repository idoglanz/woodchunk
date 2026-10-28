# Woodchunk Design Guide

Direction **Tape** (chosen 2026-10-22), refined toward an Apple-like calm: fewer borders, more space, one accent used with restraint. Light and dark are both first-class.

## Principles

1. **Quiet chrome, loud content.** The cut diagrams, numbers and parts are the interface. Chrome is neutral, separators are hairlines, and there is no decoration for its own sake.
2. **One accent.** Tape yellow marks *the* primary action on a screen, the selected state and focus. Never more than one yellow button in view.
3. **Red means a cut or a problem.** The saw-kerf red appears only in diagrams (the kerf line) and in errors or "doesn't fit" warnings.
4. **Numbers are first-class.** Use tabular figures everywhere digits align. Show units next to values, quieter than the value (`800` **mm**).
5. **Progressive disclosure.** Defaults are visible; settings live one click away in a popover or sheet, never on the main canvas.
6. **Direct manipulation, no save buttons.** Edits apply instantly, autosave, and undo is ⌘Z.
7. **Phones in the store and at the saw.** The Buy and Shop sheet views are designed for one-handed use: 44 px targets and a sticky total.

## Color tokens

Every color is a CSS variable defined in `frontend/src/app/globals.css`. Components use only tokens.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F5F3` | `#000000` | App background |
| `--surface` | `#FFFFFF` | `#1C1C1E` | Cards, panels |
| `--surface-2` | `#EEEEEB` | `#2C2C2E` | Inset areas, segmented control track, inputs at rest |
| `--surface-3` | `#E4E4E0` | `#3A3A3C` | Hover on surface-2 |
| `--ink` | `#1D1D1F` | `#F5F5F7` | Primary text |
| `--ink-2` | `#6E6E73` | `#A1A1A6` | Secondary text |
| `--ink-3` | `#8E8E93` | `#7C7C80` | Tertiary text, placeholders (large text only) |
| `--line` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.10)` | Hairline separators |
| `--line-strong` | `rgba(0,0,0,0.16)` | `rgba(255,255,255,0.18)` | Input borders, diagram outlines |
| `--accent` | `#FFCC00` | `#FFD60A` | Tape yellow: primary action, selection, focus |
| `--accent-ink` | `#1D1D1F` | `#1D1D1F` | Text on accent |
| `--accent-soft` | `#FFF4C2` | `rgba(255,214,10,0.16)` | Selected rows, highlights |
| `--kerf` | `#FF3B30` | `#FF453A` | Kerf lines, errors |
| `--ok` | `#248A3D` | `#30D158` | Success, "bought" |
| `--info` | `#0A66C2` | `#64D2FF` | Links in body copy, "info" |

**Assembly fills** (diagrams, part labels) cycle in this order and are tuned so dark ink text passes 4.5:1 in light mode and light text in dark mode:

| | Light fill / text | Dark fill / text |
|---|---|---|
| A | `#FFE38A` / ink | `#5E4B00` / `#FFF1B8` |
| B | `#CFE3F7` / ink | `#173A5C` / `#D6E9FF` |
| C | `#D3EBC6` / ink | `#1F4A1C` / `#D9F5CF` |
| D | `#F6D7C3` / ink | `#5A2E14` / `#FFE0CC` |
| E | `#E3D7F5` / ink | `#3B2A5E` / `#EADFFF` |
| F | `#F7D3DD` / ink | `#5C2133` / `#FFDCE6` |

Waste is a fine diagonal hatch on `--surface-2`. A **kept offcut** is `--surface` with a 1.5 px dashed `--line-strong` border and a "→ inventory" label.

## Typography

The system font stack shows SF Pro on Apple devices and falls back cleanly everywhere else:

```
--font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
```

| Style | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| Large title | 34 / 40 | 700 | -0.02em | Page title (project name) |
| Title | 22 / 28 | 600 | -0.01em | Section titles |
| Headline | 17 / 22 | 600 | 0 | Card titles |
| Body | 15 / 22 | 400 | 0 | Default |
| Callout | 14 / 20 | 400 | 0 | Secondary text |
| Caption | 12 / 16 | 500 | 0.01em | Labels, metadata |
| Figure | 28 / 32 | 600 | -0.01em, tabular | Summary numbers |
| Mono | 11–12 | 500 | 0 | Dimensions inside diagrams only |

Hebrew uses the same stack (SF Hebrew / Arial Hebrew), with `dir="rtl"` on Hebrew content blocks and pages. Layout uses logical properties only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`).

## Space, shape, depth

- **Spacing scale (px):** 4, 8, 12, 16, 20, 24, 32, 48. Page gutter is 24 on desktop and 16 on phones. Content max width is 1200.
- **Radius:** 8 for inputs and small controls, 12 for buttons, 16 for cards and panels, 999 for pills.
- **Depth (light):** cards use `0 1px 2px rgba(0,0,0,.04), 0 2px 12px rgba(0,0,0,.04)`, with no border. Popovers and sheets use `0 12px 40px rgba(0,0,0,.14)`.
- **Depth (dark):** no shadows. Elevation comes from `--surface` / `--surface-2` and a 1 px `--line` border.
- **Navigation bar:** translucent `color-mix(in srgb, var(--bg) 72%, transparent)` with `backdrop-filter: saturate(180%) blur(20px)`, sticky, and a hairline bottom border.

## Components

- **Button:**
  - *primary* (accent fill, accent-ink text);
  - *secondary* (surface-2 fill);
  - *plain* (text only, ink-2 → ink on hover);
  - *destructive* (kerf text on surface-2).
  - Height 36 (small) or 44 (regular), radius 12, weight 600.
- **Segmented control:** surface-2 track, the selected item is a surface pill with a shadow. Used for the project tabs (Build · Buy · Shop sheet), units and language.
- **Field:** label above in Caption/ink-2, input on surface-2 with no border at rest and a 2 px accent focus ring. Units sit as a suffix inside the field.
- **Stepper (×qty):** a − / value / + cluster on surface-2, used for assembly quantity.
- **Pill / status:**
  - Planning (accent dot)
  - Bought (info dot)
  - Cut (kerf dot)
  - Done (ok dot)
- **Part label:** rounded 6 px chip in the assembly fill showing a bold letter+index (`A1`).
- **Card:** surface, radius 16, padding 20/24, no border in light mode.
- **Popover / Sheet:** cutting settings, material picker and AI panel. On phones these become a bottom sheet.
- **Toast:** bottom-center (top on phones, clear of the tab bar), ink background, surface text, auto-dismiss after 4 s, with an "Undo" action where relevant.
- **Empty state:** one line explaining what will appear and one primary action.

## Diagrams

- **Lumber bar:** one row per *pattern* (identical boards are grouped as "3.0 m ×4"). The bar width is proportional to the longest stock in that material, so a 2.4 m board is visibly shorter. Segments use the assembly fill; a 2 px kerf gap shows `--kerf`. Labels show the part label and its length; labels are hidden below about 48 px of width (they stay in the tooltip).
- **Ruler:** above the first bar of each material, ticks every 100 mm, labels every 500 mm, `--ink-3`. This is the only place the "tape" motif appears.
- **Sheet layout:** drawn to scale with x along the sheet length and grain. Grain direction shows as a small arrow label. Part rectangles have 1 px `--line-strong` edges. Kerf gaps show `--kerf`. Offcuts are dashed.
- **Cut sequence:** numbered list in accent circles. Hovering a step highlights its cut line on the sheet.
- **Interaction:** hover or tap a part to see a tooltip (label, name, assembly, dimensions). Editing or hovering a part row outlines its pieces and fades the rest; clicking a piece jumps to its row.
- **Build tab layout:** parts on the left, the live cutting plan in a sticky panel on the right (≥1024 px), which can go full width. Below that the plan lives in a bottom drawer that peeks with the totals and snaps to half and full height. On desktop the assistant opens in the same panel. Part rows size by their column (container queries), not the window.

## Motion

Use 150–250 ms ease-out for state changes, popovers and sheet slide-ins. While the plan recomputes, the previous plan dims to 60% opacity; there is no spinner unless it takes longer than 800 ms. Respect `prefers-reduced-motion` (no slides, only fades).

## Voice

Plain, specific and short: "Buy 4 × 3.0 m", "Doesn't fit: B2 is 2500 mm but the longest board you allow is 2400 mm. Allow 3.0 m boards or split the part." Buttons say what happens: "Apply", "Mark as bought", "Add assembly". Units are always shown.
