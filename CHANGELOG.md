# Growth Studio Changelog

## 0.2.3 2026-11-06

- Contact is checked only where the sheet grows, moved, or recently touched. A step on a 181,000-triangle STL dropped from 51 seconds to under a second, with the same fold spacing on the weave vase.
- STLs that cross themselves, such as several bodies exported together, explain the problem and offer Grow anyway: existing crossings and a small margin around them are left as they are, and only new crossings are blocked. The choice is saved with the project.
- STLs above 30,000 triangles show a speed warning and open on the Surface view. STLs above 500,000 triangles are refused before preparation, with advice to reduce them.
- Dialogs move focus inside, keep Tab within the dialog, and return focus to the button that opened them.
- Long layer names are cut off with an ellipsis and limited to 40 characters. The timeline readout shows the current step unless you are viewing a snapshot.

## 0.2.2 2026-11-06

- A layer that starts at a timeline step now becomes active at that step. Before, playback was unavailable at the start step and growth could not begin.
- The stop message stays visible after playback stops, instead of being replaced by contact status. Routine contact corrections no longer show as a warning.
- Presets stop at a target strain, which works on vases as well as disks. Lettuce edge notes how to get finer frills.
- Layer rows are left-aligned and show On or Off. Waves are listed only for rims that are growing. Timing curve labels are larger.
- On touch screens, one finger paints while a brush tool is active; two fingers zoom and turn.

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
