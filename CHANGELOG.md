# Growth Studio Changelog

## 0.8.3 2026-11-09

- The wall check no longer reports overlaps at points where a grown sheet crumples. There its faces turn more than 90° apart, so no wall direction suits them all, and the wall overlaps within its own thickness of the point, whatever the wall. Slicers merge this, but it showed as pink spots that a thinner wall couldn't remove: 114 of them on a painted vase at 0.2 mm. Folds that meet, and bends tighter than the wall, are still reported.
- The crossing message now names both causes: folds closer together, or bends tighter, than the wall is thick.

## 0.8.2 2026-11-09

- Number boxes take what you type. The text is applied on Enter or when you leave the box, and clamped to its range then. Before, each keystroke was clamped: typing 80 over 100 in Longest side gave 100, and typing 300 into a cleared Stop at step gave 1,300. This covers Longest side, Stop at step, phase steps, and layer timing.
- The default disk's solid is now its chosen longest side with the wall and rims included. Before, only the sheet was measured, so a 100 mm disk with a 5 mm wall exported 105 mm long.
- Outside and Inside keep to the same side as an STL grows. They are now worked out from the starting surface, and a nearly flat STL counts as a sheet facing up. Before, a flat STL could switch sides between pauses.
- The solid check also reports when the solid isn't closed, for an STL that pinches to a point or has faces turned inconsistently. Before, those showed as "Closed solid with no crossings."
- A rim edge on a zero-area triangle keeps its rounded edge instead of folding flat into the sheet, and zero-area triangles no longer count as crossings.
- Exactly 1,000 crossings reads as 1,000, not "more than 1,000". If the check can't run, the panel says so instead of showing "Checking the wall…" forever.
- A project file with a list where a wall side or rim edge name belongs is refused, instead of opening and leaving the page blank.

## 0.8.1 2026-11-09

- Run phases always shows each phase in the status, however short. The worker sends the page one frame at a time, so a phase of a few steps could start and end between two frames and never be shown. Each phase change is now sent on its own. This also fixes a test that failed now and then in CI.

## 0.8.0 2026-11-09

- **Wall side** under Add thickness: put the wall on both sides of the surface, all outside, or all inside, so the grown surface stays the outer face (Inside) or the inner face (Outside). On the default disk the choices are Top and Bottom. Inside and outside follow the way the surface faces, so they mean the same on an STL wound either way.
- The last export's message clears when the thickness settings change or another model is loaded, instead of describing a file made with other settings.
- Projects saved by 0.7.0 open with the wall on both sides.

## 0.7.1 2026-11-09

- Simulation › Advanced stays open while you drag Mesh detail limit. Before, raising the limit past the current vertex count folded the section shut, because it was held open only while the limit was reached. It still opens by itself when growth reaches the limit, and closes only when you close it.

## 0.7.0 2026-11-09

- **Add thickness** under File › Export mesh turns the grown sheet into a solid for printing: a wall centered on the surface, closed along every open rim, which exports watertight.
  - Wall thickness from 0.2 to 5 mm. An STL keeps its own millimeters; the default disk is scaled to a chosen longest side, 100 mm by default.
  - Rim edge: Round (half-round, like a leaf), Soft (rounded corners), or Square.
  - The 3D view shows the solid while growth is paused, with the overlay colors carried over.
  - After each change the app checks, in a background worker, whether the wall passes through itself where folds are close together, and colors those places pink.
  - The settings are saved with the project. Older projects open with thickness off.
- Uploaded STLs draw white and shaded. Before, an STL that replaced the default disk drew in flat grey with no light from the lamp, because its material kept the disk's shading.

## 0.6.1 2026-11-09

- The model is white instead of pale grey-green, in the 3D view and in the variant thumbnails. The view now uses neutral tone mapping, which keeps white white; the default made it light grey. The growth field, growth so far, and contact colors also show slightly closer to their true color.

## 0.6.0 2026-11-08

- Growth runs in a background worker, so the view, orbiting, and the controls stay smooth however long a step takes. Before, the page could only redraw between steps. In Chrome:
  - The closed SpringPot with a painted band draws 54 frames per second while it grows, instead of 8.
  - The weave vase at 4× mesh detail draws 50 to 60 frames per second up to 3,800 vertices, instead of 16.
  - The page keeps drawing at 59 frames per second during Step 10 on a 181,000-triangle STL, which used to freeze it for about 6 seconds.
- Light models play closer to the set Playback speed, because playback no longer waits for each redraw. The default disk grows about 70 steps a second instead of 40.
- Stop takes effect after the step in progress. On a dense mesh that can take a few hundred milliseconds, and the status reads Stopping… until then.
- Results are unchanged. A model handed to the worker in the middle of contact continues exactly as it would have on the page, which a new test checks.
- Painting, layer and setting changes, undo, Snapshot, scrubbing, variants, Save, and Export all work during or after playback as before.
- On very large meshes, the warning no longer says the app pauses while each step runs.

## 0.5.4 2026-11-08

- On touch screens the controls are at least 44 px tall, as in Apple's guidelines. Before, Play, Step, Reset, Phases, and Snapshot in the timeline dock were 28 to 34 px.
- On touch screens the hint under the 3D view describes gestures, such as "Drag to turn · Pinch to zoom · Two fingers to pan", instead of mouse buttons and the scroll wheel.
- On phones each bar above the 3D view stays on one line and scrolls sideways if needed, instead of wrapping over the model. On the narrowest phones the gesture hint is hidden.
- On tablets and phones the 3D view grows to fit its bars and timeline dock, which before could spill over the panels below it on a small screen.

## 0.5.3 2026-11-08

- Layer rows describe what each layer covers, such as "16% wide · 6 lobes", "Radius 20%", "70% to 100% of height", or "Not drawn yet" for a line, instead of repeating the layer's name.
- On a model without open rims, rim layers are dimmed and say "No open rims on this model".
- When an STL or project can't be opened, the message names the file and says the current model is unchanged. Old messages clear once another model or project opens.

## 0.5.2 2026-11-07

- The model no longer flashes black while it grows. Each time growth added triangles, the new mesh could be drawn once before its colors were filled in.
- The view stays smooth while growing. Playback now waits for the browser to draw a frame between batches of steps. On the weave vase at the detail limit, Chrome drew 54 frames per second instead of 14, and orbiting stays responsive.
- Growth steps are about 2.6 times faster, with identical results. The contact search reads triangles straight from the mesh, measures each nearby edge once, and skips edges that are clearly too far away. The crossing check builds triangles only for pairs that are close.

## 0.5.1 2026-11-07

- Growth Studio is online at https://gil336699.github.io/growth-studio/. Each push to `main` publishes the latest version to GitHub Pages.
- The build uses relative paths, so it works from a subfolder, another static host, or a custom domain.

## 0.5.0 2026-11-07

- New look in the style of Apple's Liquid Glass. The 3D view fills the window, and the app name, both panels, the tool bars, and the timeline float above it on translucent glass that blurs the model behind it.
- Play growth, Step, and Reset moved into the timeline dock at the bottom of the 3D view, next to the scrubber, as in a media player. The status line is there too.
- Controls follow Apple conventions: capsule buttons, segmented controls for tabs and options, sliders with a tinted track and a white knob, switches for layer visibility and Center exported mesh, and grouped lists for layers, presets, and readouts. Blue marks primary actions and current values; red stays for the growth field on the model.
- The system font replaces the downloaded web fonts.
- Light and dark mode follow the system. Reduce transparency makes the panels nearly opaque, and Increase contrast strengthens edges and secondary text.
- On narrower windows Step and Reset show only their symbols. On phones the status and the scrubber each get their own line.
- The keyboard shortcuts dialog now focuses Close instead of the first button.

## 0.4.0 2026-11-07

- Every control shows a short description on hover or keyboard focus, with its shortcut. The tooltip appears after a short pause, then right away as you move along a row of controls. It replaces the browser's slow native tooltips, which some embedded browsers don't show.
- Unavailable buttons say why: Play and Step explain what to turn on, Undo says there is nothing to undo, and Save or Export ask you to stop the simulation first.
- Readouts such as Target strain, Blocked steps, and Vertices have a dotted underline and explain themselves on hover.
- Add a layer is a row of buttons instead of a menu, and each one describes its layer type. Layer rows describe their type too.
- A quick start guide shows three steps on the first visit. Reopen it from the ? button.

## 0.3.0 2026-11-07

- New layout. The left panel has the starting surface at the top and two tabs: Growth field (layers) and Simulation. The right panel has Form, Explore (presets and variants), and File tabs. Each tab scrolls on its own, so the tabs stay in reach. Before, each panel was about 2,000 px tall.
- Tools and brush settings float over the top left of the 3D view, and appear as soon as you press B, E, or S. Color overlay, mesh view, ghost, and framing are at the top right.
- Placing a point or drawing a line shows a Done button over the 3D view. A painted layer has a Paint on model button.
- Phases open from a button in the timeline header, and Run phases is always visible there once phases exist. The 3D view is taller as a result.
- The File tab shows a dot when there are unsaved changes, and saving with ⌘S reports the result in the header.
- When Play is unavailable because nothing grows, the status says so, for example on a closed STL with no open rims.
- On tablets the 3D view takes half the screen, with both panels side by side below. On phones, display options hide while you brush.

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
