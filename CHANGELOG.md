# Growth Studio Changelog

## 0.2.1 2026-11-06

- Reset, Upload STL, Default disk, and Open project now ask in an in-app dialog, with Cancel, Save project first, and continue. Browser confirm dialogs could be blocked, which made Reset do nothing in embedded browsers.
- Save project and Export use the system save dialog where available and fall back to a download. Save project first only continues once the file is saved.
- Two settings changed in quick succession now both apply.

## 0.2.0 2026-11-06

- Growth layers replace openings and rim sources: rim (with lobes), painted, point, line, height ramp, and noise layers, each with strength, start and stop steps, and intensity keyframes. The disk and STLs use the same layers.
- Brush: paint, erase, and smooth on any surface, while growing, with size, strength, hardness, mirror or radial symmetry, pen pressure, and an on-model brush ring. Erase cancels paint first.
- Timeline: automatic and manual snapshots, scrubbing back, and branching from an earlier step. Phase recipes run grow and relax steps in order.
- Form readouts: waves per growing rim, size compared with the start, and dimensions in millimeters. Fold size sets rim width and bend together. Stop at a size, strain, or step.
- View: growth field, growth so far, and recent contact overlays, a ghost of the starting shape, and Frame model. Voronoi cells stay visible while growing.
- Presets (lettuce edge, petal, coral, collar, bloom) and Explore variants, which grows four versions in the background and continues the chosen one.
- Keyboard shortcuts, tooltips on controls, and a shortcuts panel.
- Project format version 2 with layers, paint, timeline step, brush, overlay, phases, and stop settings. Version 1 projects convert on open.

## 0.1.0 2026-11-06

- Split the disk differential growth workspace out of Growth Lab (commit `2837c65`) as a standalone app.
- Includes STL import with open-rim detection, a paint and erase growth brush, linear and compounding growth, gravity on the growth field, growth-field repel controls, a mesh detail limit, Relax only, and Voronoi and triangle views.
- Saves editable `.growthstudio.json` projects and opens Growth Lab disk projects.
- Exports OBJ and binary STL in the input coordinate frame, with an option to center the mesh.
