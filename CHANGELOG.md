# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-04

First public release.

### Added

- **Host half** (`index.js`, `host/**`): `scifig` agent tool (`draft` / `patch` /
  `nl` / `state` / `export` / `code` / `list` / `delete`), the `/scifig` HTTP API,
  a figure registry with render history, a serialized render scheduler
  (90 s timeout, merged pending patches), Chinese natural-language parameter
  parsing, and a system-prompt section that teaches the agent the workflow.
- **Client half** (`client.js`): left taskbar entry plus a full-page workbench
  with a left session/figure list, a middle preview/code area, and a right
  **tool area** that switches between map tools, chart tools and general tools
  based on the figure kind.
- **Map tooling**: 11 cartopy projections with projection chips, central
  longitude / latitude and standard parallels, extent presets, graticule
  (spacing, degree-minute format, label sides), layers (country borders,
  province borders, coastline, lakes, rivers, South China Sea inset), colorbars,
  scale bar, north arrow, point/bubble/choropleth symbology.
- **Chart tooling**: line (multi-series, dual axis), bar (grouped, stacked),
  scatter (fit line with equation), heatmap and box plots with axis, legend,
  line/marker and annotation controls.
- **Palette system**: 33 curated palettes (16 categorical, 8 sequential,
  9 diverging) extracted from a reference slide deck, wired into series colors,
  continuous fills, colorbars and heatmaps; `scripts/extract_palettes.py`
  regenerates the library from any `.pptx`.
- **Journal presets**: generic SCI, Nature, Science, Elsevier, IEEE, Acta
  Geographica Sinica, Journal of Remote Sensing — with single-column 89 mm and
  double-column 180 mm widths, 6–9 pt type, inward ticks and consistent
  colorbar number formats.
- **Code artifacts**: every figure ships a standalone `component.py` that
  reproduces the rendered PNG byte-for-byte (`codegen` shares the engine path).
- **Auto-adjust reporting**: engine-side polish (central-meridian snapping,
  corner fill, scale-bar degradation, categorical label rotation) is reported
  separately from real warnings.

### Removed

- Multi-panel composition (`compose` / `decompose` / component library): the
  plugin focuses on single-figure editing; those endpoints now answer with an
  explicit “feature removed” message.

### Notes

- Output is PNG only (300 dpi default, 600 dpi supported).
- No machine-specific paths are stored in the repository; the Python
  interpreter is resolved from plugin config → `SCIFIG_PYTHON` →
  `.scifig-config.json` → bundle-local venv → `PATH`.
