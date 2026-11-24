# Growth Studio

Growth Studio is a browser app for differential growth. Start from a flat disk or an open STL such as a Fusion vase base, decide where and when it grows, and watch the rim ruffle and fold. Or switch to **brain mode** and grow a closed shape, such as the built-in brain or your own STL, until it folds like a brain. Save editable projects, and export OBJ or STL back to CAD, or as a solid with walls and rounded rims, ready to print. The **print check** colors what a slicer would need to support, so you can grow shapes that print without it.

**Use it online:** https://gil336699.github.io/growth-studio/

![Growth Studio demo: the Collar preset is applied to an uploaded vase, and P turns on the print check, which colors the vase green where it prints and yellow where it only just prints. Play growth grows a wide brim that droops and turns red where it needs support. In the File tab, Add thickness gives it a 1.2 mm wall, and the bar above the view reads "Needs support 3.2%". From below turns the view to look up at the red under the brim and the round bottom rim. After Reset, the Collar, upright preset grows the same flare with gravity pulling up, so it stands up in pleats, and the bar reads "Needs support 0.4%". From below, only the round bottom rim is red.](docs/demo.gif)

The demo is sped up 7 times while the vase grows. [Watch it in HD (MP4)](docs/demo.mp4).

Everything runs in your browser. Models you upload and the shapes you grow stay on your computer.

## Run

Requirements: Node.js 22 or newer and a current desktop browser with WebGL.

```bash
npm install
npm run dev
```

Open the address Vite prints, normally `http://localhost:5173`.

To build static files you can host anywhere, run `npm run build`. The site is written to `dist/`. Preview it with `npm run preview`.

## Publish

Each push to `main` builds the app and publishes it to GitHub Pages through `.github/workflows/pages.yml`. The site is live about a minute later. The build uses relative paths, so `dist/` also works on any other static host, in a subfolder, or on a custom domain.

## Layout

The 3D view fills the window, and the controls float above it on translucent glass, in the style of Apple's Liquid Glass. The look follows the system's light or dark appearance, and its Reduce transparency and Increase contrast settings.

- **Top left.** The app name and the **?** button for shortcuts and the quick start.
- **Left panel.** The starting surface, with the **Sheet / Brain** switch, Upload STL, Default disk or the brain's settings, and any warnings about the mesh. Below it, the **Growth field** tab holds the growth layers and the **Simulation** tab holds growth rate, stopping, gravity, contact, and advanced settings.
- **Top of the 3D view.** Tools (Orbit, Paint, Erase, Smooth, Undo) on the left. Choosing a brush tool shows its size, strength, hardness, and symmetry just below. Color overlay, mesh view, ghost, and framing on the right. Choosing **Print check** shows the support angle and what it counted just below.
- **Bottom of the 3D view.** The timeline dock: **Play growth**, **Step**, and **Reset**, the status, scrubbing, snapshots, and phases.
- **Right panel.** **Form** shows measurements, Fold size, and stats. **Explore** has presets and variants. **File** saves, opens, and exports, and shows a dot when there are unsaved changes.

On tablets the 3D view sits on top, with both panels below it. On phones everything is in one column.

## Help in the app

- **Hover any control**, or move to it with Tab, to see a short description of what it does, with its keyboard shortcut. Buttons that are unavailable say why, for example why Play is off.
- **Terms with a dotted underline**, such as Target strain, explain themselves on hover.
- **Quick start** shows three steps on the first visit. Reopen it from the **?** button.

## Workflow

1. **Starting surface.** Use the default disk, or choose **Upload STL**. Open rims are detected automatically. For a closed shape that folds like a brain, switch to **Brain** (see [Brain mode](#brain-mode)).
2. **Growth layers.** Decide where growth comes from. Each layer has a strength, its own settings, and optional timing.
3. **Brush.** Pick Paint, Erase, or Smooth above the 3D view and brush growth onto the model, even while it grows.
4. **Grow.** Press **Play growth** in the timeline dock, step in batches, or run a recipe of phases. **Relax only** lets the form settle without adding growth.
5. **Look back.** Scrub the timeline to any snapshot and continue from there.
6. **Save and export.** **Save project** writes an editable `.growthstudio.json` file. **Export OBJ** or **Export STL** writes the current surface in the STL's original coordinates, unless **Center exported mesh** is checked.
7. **Make it printable.** The surface is an open sheet. Turn on **Add thickness** under **File › Export mesh** to export a solid instead (see [Thickness for printing](#thickness-for-printing)). Choose **Print check** in the Color menu, or press P, to see what will need support (see [Print check](#print-check)).

The app asks before Reset, Upload STL, Default disk, or Open project would discard unsaved work. Growth Lab disk projects also open.

## Brain mode

Brain mode grows a closed shape the way a brain folds. The whole surface grows over a soft core, so the extra surface buckles into folds instead of inflating the shape, and an outer layer rounds the ridges and closes the grooves. It's based on Tallinen et al., "On the growth and form of cortical convolutions" (*Nature Physics*, 2016), where a gel copy of a smooth fetal brain folded in minutes.

1. Switch the Starting surface card from **Sheet** to **Brain**. The built-in brain loads: a smooth brain made from an MRI scan, 150 mm long.
2. Press **Play growth**. It folds and stops at step 420, with the folds from the Instagram reel.
3. Scrub the timeline back to watch it unfold, or export it: **File › Export STL** writes the filled brain with its outer layer, watertight and in millimeters.

| Setting | Effect |
| --- | --- |
| Built-in brain | Loads the built-in brain again. |
| Upload STL | Loads your own closed shape. Brain mode rebuilds it as one smooth, closed surface, scaled so the recipe gives the same fold size, and keeps its millimeters. Walls thinner than the rebuild's grid, about the fold size, don't survive it. A shape that mostly disappears is refused with what to try, and one that loses part of itself loads with a note saying how much was kept. An open surface, such as a vase, is refused. For both, Sheet mode with the Brain folds preset keeps the mesh as it is. For an open surface, the refusal has a button, **Open in Sheet mode with Brain folds**, that does this in one click. If the STL stands on a flat bottom, the bottom and the lowest fifth of the wall don't grow and are held still, so it keeps standing flat on the bed: a pen holder grown 300 steps kept all 55 cm² of its flat bottom, where the preset alone left none of it flat. |
| Fold size | **Fine**, **Medium** or **Broad**: more, smaller folds, or fewer, wider ones. Medium is the reel. Before growth, it rebuilds the starting shape at a finer or coarser mesh. Once the brain has grown, it keeps its folds and the timeline, and grows on at the new size from that step. If growth had stopped at Stop at, the stop moves 140 steps on. Reset goes back to a smooth brain at the current size. |
| Smoothing | For an upload: **Light**, the default, keeps it close to the STL and its thin walls; **Medium** rounds off small bumps; **Strong** smooths an already folded brain scan back into a smooth one. |

Brain mode sets everything else from the reel's recipe, and each setting can still be changed:

| Setting | Value |
| --- | --- |
| Growth field | A **Whole surface** layer named Cortex. On the built-in brain, the inner walls between the halves and the middle of the base are erased, as in the paper. |
| Core | Firmness 0.5%, growth 10% |
| Bend stiffness | 20% |
| Stop at | Step 420 |
| Mesh detail limit | 3.5× |
| Outer layer | 2.7 mm on the built-in brain, about a real cortex's thickness |

The built-in brain is based on "Brain Model" by Nevit Dilmen on NIH 3D ([3DPX-002739](https://3d.nih.gov/entries/3dpx-002739)), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It was smoothed, the cerebellum and brainstem were removed, and the halves were joined. See [docs/brain-mode.md](docs/brain-mode.md) for the design.

## Growth layers

Where layers overlap, the strongest one wins. Erase and noise apply on top.

| Layer | What it does |
| --- | --- |
| Rim | Grows inward from an open rim (or all rims) over a set width. Lobes grow from evenly spaced spots around the rim instead. |
| Whole surface | Grows every part of the surface evenly. Use it for closed shapes, such as a brain, that have no rim to grow from. |
| Painted | Growth painted with the brush. Erase removes paint first, then masks other layers. |
| Point | A growing spot you place on the model, with a radius. |
| Line | A band of growth along a line you draw on the model. |
| Height ramp | Growth that increases from one height of the starting shape to another. |
| Noise | Organic variation applied to the other layers, with a pattern size and seed. |

Every layer can start and stop at timeline steps, and intensity keyframes ramp it up or down over time.

## Thickness for printing

**Add thickness** gives the sheet a wall and closes every open rim, so Export writes a watertight solid that slicers accept. Growth always runs on the thin sheet; thickness is applied to the view and to the export only, and is saved with the project.

| Setting | Effect |
| --- | --- |
| Smooth surface | **Off** adds the wall to the surface as it grew. **Light** smooths the sheet once before the wall is added: four times the triangles, and most facets gone. **Strong** smooths it twice: sixteen times the triangles, smooth even on a coarse sheet. Smoothing is Loop subdivision; open rims follow a smooth curve through their own points, so a flat bottom rim stays flat. Edges that bend more than the Sharp edge angle in the starting shape, 30° by default, such as the edge around a vase base's flat bottom, stay sharp, so the print still sits flat on the bed. A very coarse sheet whose facets bend more than that keeps them too, unless you raise Sharp edge angle or Bevel. Folds soften a little: the upright Collar's solid is about 0.5 mm narrower. A level that would pass 400,000 triangles is unavailable, and its button says why. |
| Sharp edge angle | How sharp an edge must be in the starting shape to stay sharp when smoothing: 30° by default, from 10° to 60°. Lower it to catch softer edges, such as a shallow chamfer; raise it to smooth the facets of a coarse mesh. On a pen holder whose 3 mm bottom chamfer bends 45° at the bed and 35° at the wall, Strong smoothing at 40° moved the outside of the chamfer's top edge by up to 0.5 mm; at 30° the exported solid matches the unsmoothed one within 0.07 mm. The tooltip says how many mesh edges are sharp at that angle. Projects saved with 0.12.0 open at 40°, the rule that version used. |
| Bevel sharp edges | Rounds those sharp edges: **0%** keeps them sharp, higher values round them more, and **100%** rounds them like the rest of the surface, as 0.11 did. On a vase base with a flat bottom 60 mm across, grown with Lettuce edge and given a 1.2 mm wall, the Light-smoothed solid stands on a circle 61 mm across at 0%, and about 59 mm from 50% up. The tooltip says how many mesh edges are sharp, and the status line under the solid says whether they're kept, beveled or rounded. With Smooth surface off, on a sheet too large to smooth, or on a shape with no sharp edges (the default disk, the weave vase), it's unavailable and says why. Projects saved with 0.11 that use smoothing open at 100%, so they export as before. |
| Wall thickness | The total wall, 0.2 to 5 mm. Most filament printers need at least 0.8 mm, and resin printers about 0.5 mm. |
| Wall side | **Both** centers the wall on the surface. **Outside** puts all of it outside, so the grown surface becomes the inner face; **Inside** puts all of it inside, so the outer size doesn't change. On the default disk these are **Top** and **Bottom**. |
| Rim edge | **Round** closes each rim with a half-round edge, like a leaf or petal. **Soft** is a flat edge with rounded corners, and **Square** cuts straight across the wall. |
| Longest side | The default disk has no units, so its solid, wall and rims included, is scaled to this length in millimeters. An uploaded STL keeps its own millimeters. |
| Show in 3D view | Shows the solid while growth is paused. |

With Smooth surface off, every fold of the grown surface is kept: the wall is offset along the surface, not rebuilt. With it on, the wall follows the smoothed surface. Where folds come closer together, or bend more tightly, than the wall is thick, the wall passes through itself. The app checks for this after each change and colors those places pink. It also checks that the solid is closed, and says so if the STL pinches to a point or has faces turned inconsistently. Most slicers merge them; for a clean solid, use a thinner wall, or grow with a larger **Repel distance** so folds stay further apart.

On a **closed shape**, such as a brain, Add thickness builds an **outer layer** instead: the inside is filled and a layer of the set thickness wraps the surface, half of it outside. Folds closer together than the layer merge, so Export writes one watertight solid in millimeters, with every edge shared by exactly two faces. The layer is built on a voxel grid in the background each time growth pauses, in a few seconds for a folded brain. While growth runs, the view shows a quick preview: the surface pushed out along its normals. **Flat base** cuts the solid flat at the bottom, **Base cut** mm up (5 mm by default), so a print stands on the bed without supports under it.

## Print check

Choose **Print check** in the **Color** menu above the 3D view, or press **P**, to see what a slicer would need to support. The colors are those of the Parametric Viewer prototype.

| Color | Means |
| --- | --- |
| Green, **Printable** | Prints without support. |
| Yellow, **Marginal** | Up to 10° steeper than the support angle: it prints, but only just. |
| Red, **Needs support** | Faces down and leans out flatter than the support angle. |
| Blue, **Touches the bed** | Faces straight down within 0.2 mm of the lowest point, Bambu Studio's first layer. |
| Dark dot, **Low point** | Lower than everything around it, on a surface facing down, so it hangs in the air. It needs a support to start on, even when its sides are steep. |

**Support angle** is counted up from the bed, as Bambu Studio and PrusaSlicer count it: 45° by default, the classic rule, and Bambu Studio's own default is 30°. Cura counts from vertical, so only 45° means the same in both. The bar below the menu says what was counted, for example "Needs support 15.1% · 6 low points in the air · 5.7 cm² on the bed" for the built-in brain's outer layer with a 5 mm flat base. **From below** turns the view to look up at the undersides, where supports go; **Frame** turns it back.

The check counts the surface the view shows: the solid or the outer layer when it's shown, otherwise the sheet, read as a wall with two sides, both of which count, so a sheet reads about as its solid will. Before the default disk grows, the crests of its starting ripple sit up to 0.3 mm above the bed, so a few of them show red. While growth runs it counts a few times a second, and growth is no slower for it: the Collar grew to its target in about 19 s with the check on or off.

To grow a vase that prints without supports, let it grow upward: under **Simulation › Gravity**, set **Strength** to 35% and **Tilt from down** to 180°, or use the **Collar, upright** preset. On the weave vase at 45°, with a 1.2 mm wall, the Collar needs support on 3.2% of its surface and the upright Collar on 0.4%, all of it the round bottom rim of the wall. For a closed shape, **Flat base** gives the print a footprint on the bed.

## Controls

| Control | Effect |
| --- | --- |
| Growth field width | How far a rim layer reaches in. Narrower fields give smaller, more numerous folds. |
| Brush size, strength, hardness | Brush radius, how much a pass adds, and how evenly it paints. A pen's pressure scales strength. |
| Symmetry | Mirror strokes across the vertical axis, or repeat them radially. |
| Growth rate and curve | Expansion per step. **Linear** adds the same amount each step; **Compounding** adds a share of the current size. |
| Bend stiffness | Resistance to tight folds. |
| Core firmness, Core growth (Simulation › Core) | A soft core under the surface: how firmly it holds each point near its starting place, and how fast it grows compared with the surface. With a core, a growing closed shape buckles into folds instead of inflating. Off by default. |
| Stop at | Stops playback at a size, target strain, or step. |
| Fold size (Form) | Sets rim width and bend stiffness together, from fine to broad. |
| Gravity | Pulls on the growth field only. The rest of the model stays in place. |
| Hold parts that don't grow | Under Gravity. Holds the parts with no growth exactly where they are, as gravity does, so an erased flat bottom stays on the bed while the rest folds. On whenever gravity is. |
| Repel distance and strength | How far apart folds in the growth field stay when they meet, and how quickly they are pushed back. |
| Remesh edge length, Mesh detail limit (Simulation › Advanced) | Starting triangle size and how many vertices growth can add. |

The **Form** tab reports waves on each growing rim, size compared with the start, and dimensions in millimeters. The **Color** menu above the 3D view switches the overlay between the growth field, growth so far, recent contact, and the [print check](#print-check), and **Ghost** shows the starting shape.

In the **Explore** tab, **Presets** set layers and settings for common forms: lettuce edge, petal, coral, collar, collar upright, bloom, and brain folds. **Explore variants** grows four versions from the current shape with one setting changed, such as Bend stiffness or Core firmness, so you can continue the one you like.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play or stop. On a button reached with Tab, Space presses that button instead. |
| . | Step |
| O, B, E, S | Orbit, paint, erase, smooth |
| [ and ] | Brush size |
| ⌘Z or Ctrl+Z | Undo brush stroke |
| G | Next color overlay |
| P | Print check on or off |
| F | Frame the model |
| 1 to 4 | Mesh view |
| ⌘S or Ctrl+S | Save project |
| Esc | Back to orbit |
| ? | Show shortcuts |

## How the simulation works

Each edge in the growth field has a target length that increases as the sheet grows. Stretching and bending constraints move the surface toward those targets, and new triangles are added when edges grow long. Self-contact pushes apart vertices and faces, edges, and folds at sharp creases before they meet. When a step would still pass the surface through itself, the step is undone, the touching parts are separated, and growth slows until steps are accepted again.

With a core, each solver pass also pulls every point a little toward its place on the starting shape, scaled about the shape's center as the core grows. That is what makes a closed shape fold the way a brain does in Tallinen et al.'s gel and simulations. A thin sheet on a spring core makes rounded, wave-like folds; the paper's solid cortex creases inward, so its grooves are narrower and deeper.

This is a position-based design model. It is not a validated thin-shell or biological simulation.

## Known limits

- Each step takes longer as the vertex count rises. On the weave vase the physics takes about 12 ms a step at 1,200 vertices and about 39 ms at 3,500. Growth runs in a background worker, so the view, orbiting, and the controls stay smooth while steps slow down: Chrome draws about 54 frames per second on a closed pot whose steps take about 100 ms. The shape itself updates only as fast as the steps finish.
- Stop takes effect after the step in progress, which on a dense mesh can take a few hundred milliseconds. The status reads Stopping… until then.
- Opening a very large STL still pauses the page while the surface is prepared, about 6 seconds for 181,000 triangles.
- Very dense growth, such as compounding beyond about 15 times the original size, blocks more steps and slows to a few steps per second.
- STL files carry no units. Dimensions, and the wall of a thickened STL, are in millimeters.
- The print check counts faces on the mesh. It doesn't know your slicer's settings: a slicer skips very small overhangs, bridges short gaps, and adds supports only when they're switched on, so its result can differ a little. Turn on Add thickness to check the solid with its rims rather than the sheet.
- The wall has one thickness everywhere; it cannot yet vary across the model.
- Browsers may slow work in hidden tabs, so growth can slow down while the tab is hidden. The view catches up when you return.
- Brain mode's built-in brain grows its 420 steps in about a minute and a half in Chrome (89 s on an M1 Max, 4.7 steps a second), ending at 16,508 points. Fine folds start from 9,564 points instead of 6,288 and take about 2½ minutes (161 s), ending at 24,592 points. The outer layer takes about 2 to 4 seconds to build after each pause, and has about 590,000 triangles on a folded brain.
- Rebuilding an uploaded STL in brain mode takes about 2 seconds for a 250,000-triangle MRI brain, on the page.
- Brain mode suits chunky closed shapes. Thin parts get thinner when smoothed, and they fold into themselves, so growth slows: a 7 mm tag became 5 mm thick and had 95 blocked steps in 420, against 15 on the built-in brain.

## Development

```bash
npm run lint
npm test
npm run build
```

- `src/App.tsx`: the workspace, timeline, and project files
- `src/lib/diskSession.ts`: the page's handle on the model. The model moves into `src/physics/simulation.worker.ts` on the first Play, and the page keeps a mirror for the view
- `src/components/`: the viewport, layers, timeline, and variant panels
- `src/physics/`: the growing surface, growth layers, contact, bending, remeshing, and Voronoi views
- `src/lib/`: STL import, project files, export, thickness for printing (`thicken.ts`), presets, readouts, and symmetry
- `src/lib/printCheck.ts`: the print check (what needs support, what sits on the bed, and low points), counted for the view by `usePrintCheck.ts` and colored by `src/components/printShader.ts`
- `src/lib/brain.ts` and `src/assets/brain/`: brain mode's recipe, the built-in brain at three fold sizes, and rebuilding an uploaded STL. `src/lib/voxel.ts` builds the outer layer and the rebuilt shapes on a voxel grid; `src/lib/outerLayer.worker.ts` runs it off the page. The design is in [docs/brain-mode.md](docs/brain-mode.md)

Growth Studio was split out of Growth Lab at commit `2837c65`.

## License

Growth Studio is released under the [MIT License](LICENSE).

The built-in brain in `src/assets/brain/` is based on "Brain Model" by Nevit Dilmen on NIH 3D ([3DPX-002739](https://3d.nih.gov/entries/3dpx-002739)) and is licensed separately under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see [its credits](src/assets/brain/CREDITS.md).
