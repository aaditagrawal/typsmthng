# typsmthng Design System

## Intent
A brutal, no-nonsense writing tool for Typst. Sharp edges, high contrast, monospace everything. The interface is a machine — precise, utilitarian, unapologetic. Dark by default.

## Who
Writers, students, academics who want a tool that feels like a terminal, not a toy. No soft corners, no gentle gradients. Just sharp lines and clear type.

## Feel
Industrial. Like a code editor that was carved, not polished. Every edge is intentional. Brutalism — raw structure over decoration. The content is still the star, but the frame makes no attempt to hide.

## Direction
- **Brutalism**: Sharp corners (0-2px radius max), bold visible borders, monospace typography everywhere
- Reference: Terminal UIs, brutalist web design, raw concrete architecture
- One accent color used boldly — not sparingly, but with purpose
- No rounded-md, no rounded-lg, no soft anything

## Palette
- **Accent:** #FF4D00 (vibrant orange-red, used for cursor, active states, compile button, active indicators, accent borders)
- **Neutrals:** Near-black to near-white scale, no color tint. Slightly boosted contrast vs typical dark themes.
- **Status:** Red (#dc2626 light, #f87171 dark), yellow (#d97706/#fbbf24), green (#16a34a/#4ade80)
- **Borders:** rgba-based — bold and visible. Dark: 0.08-0.25 alpha. Light: 0.08-0.25 alpha. NOT whisper-quiet — borders define structure.

## Depth
Borders-only. No shadows except context menus and the document page preview. Borders are the primary structural element — they should be visible and confident.

## Surfaces (Dark, default)
- `--bg-app`: #0A0A0A — deepest background, the void
- `--bg-surface`: #141414 — panels, toolbar, status bar
- `--bg-elevated`: #1E1E1E — dropdowns, menus, overlays
- `--bg-hover`: #1E1E1E — interactive hover state
- `--bg-active`: #262626 — pressed/active state
- `--bg-inset`: #0A0A0A — recessed areas

## Surfaces (Light)
- `--bg-app`: #F5F5F5
- `--bg-surface`: #FFFFFF
- `--bg-elevated`: #FFFFFF
- `--bg-hover`: #EBEBEB
- `--bg-active`: #E0E0E0

## Borders
- Dark default: `rgba(255,255,255,0.15)` — clearly visible
- Dark strong: `rgba(255,255,255,0.25)` — bold structural lines
- Dark subtle: `rgba(255,255,255,0.08)` — minimum visibility
- Light default: `rgba(0,0,0,0.15)`
- Light strong: `rgba(0,0,0,0.25)`
- Light subtle: `rgba(0,0,0,0.08)`

## Typography
- **Everything**: JetBrains Mono. Editor, toolbar, status bar, sidebar, file tabs — all mono.
- **Editor:** 15px, 1.6 line-height, ligatures enabled
- **Chrome (toolbar, status, sidebar):** 11-12px mono
- **Data:** Mono, tabular-nums
- No sans-serif in the UI. The monospace font IS the brand.

## Corners
- **Maximum border-radius: 2px.** Period.
- Buttons: 2px
- Scrollbar thumb: 2px
- Everything else: 0px
- NO rounded-md, NO rounded-lg, NO rounded-full anywhere in the UI

## Spacing
4px base unit. All spacing is multiples of 4.

## Layout
- Top toolbar: 40px height, icons left (sidebar toggle, theme, settings), file tab center, downloads right
- Sidebar: 200px wide, toggled from toolbar, same bg as surface
- Editor/Preview: 50/50 split with resizable separator
- Status bar: 24px height, mono font, connection status left, cursor/errors right
- Preview has its own toolbar: Compile button (accent bg, sharp corners), page nav + zoom controls right

## Component Patterns
- **Toolbar buttons:** 28x28, 2px radius, transparent bg, 1px transparent border that becomes visible on hover. Sharp rectangles.
- **Rail buttons:** 32x32, same sharp treatment. Active state: accent color + accent border.
- **File items:** Full-width, 2-3px left border (accent when active, transparent otherwise), accent-muted bg when active
- **Compile button:** Accent background, white text, 28px height, 2px radius, sharp rectangle
- **Context menus:** bg-elevated, border-default, 12px shadow in dark
- **Page nav overlay:** Floating bottom-right of preview, 2px radius, border
- **Active states:** Bold accent usage — 2-3px accent borders, accent color text/icons

## Panel Separator
- 1px width by default, border-default color
- On hover/active: expands to 2px, accent color
- Wider invisible hit target (8px) for easy grabbing

## Scrollbar
Custom webkit scrollbar: 8px, transparent track, border-default thumb with 2px radius, border-strong on hover. Sharp, not rounded.

## Dark Mode (default)
- Borders: rgba(255,255,255,0.08-0.25) — visible and structural
- Active line: accent at 14% alpha
- Selection: accent at 15% alpha
- Status colors slightly brighter/desaturated
- Text contrast slightly boosted (--text-primary uses neutral-50 not neutral-100)

## CodeMirror
- Gutters: bg-surface background, border-default right border
- Cursor: accent color
- Active line: accent-muted background
