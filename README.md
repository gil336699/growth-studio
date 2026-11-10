# Growth Studio

Growth Studio is a browser app for differential growth. Start from a flat disk or an open STL such as a Fusion vase base, decide where and when it grows, and watch the rim ruffle and fold. Or switch to **brain mode** and grow a closed shape, such as the built-in brain or your own STL, until it folds like a brain. Save editable projects, and export OBJ or STL back to CAD, or as a solid with walls and rounded rims, ready to print.

**Use it online:** https://gil336699.github.io/growth-studio/

![Growth Studio demo: the Bloom preset is applied to an imported vase and Play growth is pressed. The rim grows into lobes as the view orbits. Then, in the File tab, Add thickness turns the sheet into a white solid with a 3 mm wall on the outside, the rim edge switches between square, soft and round in a close-up, and the solid is exported as an STL.](docs/demo.gif)

The demo is sped up 10 times while the vase grows. [Watch it in HD (MP4)](docs/demo.mp4).

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
- **Top of the 3D view.** Tools (Orbit, Paint, Erase, Smooth, Undo) on the left. Choosing a brush tool shows its size, strength, hardness, and symmetry just below. Color overlay, mesh view, ghost, and framing on the right.
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
7. **Make it printable.** The surface is an open sheet. Turn on **Add thickness** under **File › Export mesh** to export a solid instead (see [Thickness for printing](#thickness-for-printing)).

The app asks before Reset, Upload STL, Default disk, or Open project would discard unsaved work. Growth Lab disk projects also open.

## Brain mode

Brain mode grows a closed shape the way a brain folds. The whole surface grows over a soft core, so the extra surface buckles into folds instead of inflating the shape, and an outer layer rounds the ridges and closes the grooves. It's based on Tallinen et al., "On the growth and form of cortical convolutions" (*Nature Physics*, 2016), where a gel copy of a smooth fetal brain folded in minutes.

1. Switch the Starting surface card from **Sheet** to **Brain**. The built-in brain loads: a smooth brain made from an MRI scan, 150 mm long.
2. Press **Play growth**. It folds and stops at step 420, with the folds from the Instagram reel.
3. Scrub the timeline back to watch it unfold, or export it: **File › Export STL** writes the filled brain with its outer layer, watertight and in millimeters.

| Setting | Effect |
| --- | --- |
| Built-in brain | Loads the built-in brain again. |
| Upload STL | Loads your own closed shape. Brain mode rebuilds it as one smooth, closed surface, scaled so the recipe gives the same fold size, and keeps its millimeters. An open surface, such as a vase, is refused; use Sheet mode and the Brain folds preset instead. |
| Fold size | **Fine**, **Medium** or **Broad**: more, smaller folds, or fewer, wider ones. Medium is the reel. Before growth, it rebuilds the starting shape at a finer or coarser mesh. Once the brain has grown, it keeps its folds and the timeline, and grows on at the new size from that step. If growth had stopped at Stop at, the stop moves 140 steps on. Reset goes back to a smooth brain at the current size. |
| Smoothing | For an upload: **Light** keeps it close to the STL, **Medium** rounds off small bumps, and **Strong** smooths an already folded brain scan back into a smooth one. |

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
| Wall thickness | The total wall, 0.2 to 5 mm. Most filament printers need at least 0.8 mm, and resin printers about 0.5 mm. |
| Wall side | **Both** centers the wall on the surface. **Outside** puts all of it outside, so the grown surface becomes the inner face; **Inside** puts all of it inside, so the outer size doesn't change. On the default disk these are **Top** and **Bottom**. |
| Rim edge | **Round** closes each rim with a half-round edge, like a leaf or petal. **Soft** is a flat edge with rounded corners, and **Square** cuts straight across the wall. |
| Longest side | The default disk has no units, so its solid, wall and rims included, is scaled to this length in millimeters. An uploaded STL keeps its own millimeters. |
| Show in 3D view | Shows the solid while growth is paused. |

Every fold of the grown surface is kept: the wall is offset along the surface, not rebuilt. Where folds come closer together, or bend more tightly, than the wall is thick, the wall passes through itself. The app checks for this after each change and colors those places pink. It also checks that the solid is closed, and says so if the STL pinches to a point or has faces turned inconsistently. Most slicers merge them; for a clean solid, use a thinner wall, or grow with a larger **Repel distance** so folds stay further apart.

On a **closed shape**, such as a brain, Add thickness builds an **outer layer** instead: the inside is filled and a layer of the set thickness wraps the surface, half of it outside. Folds closer together than the layer merge, so Export writes one watertight solid in millimeters, with every edge shared by exactly two faces. The layer is built on a voxel grid in the background each time growth pauses, in a few seconds for a folded brain. While growth runs, the view shows a quick preview: the surface pushed out along its normals.

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
| Repel distance and strength | How far apart folds in the growth field stay when they meet, and how quickly they are pushed back. |
| Remesh edge length, Mesh detail limit (Simulation › Advanced) | Starting triangle size and how many vertices growth can add. |

The **Form** tab reports waves on each growing rim, size compared with the start, and dimensions in millimeters. The **Color** menu above the 3D view switches the overlay between the growth field, growth so far, and recent contact, and **Ghost** shows the starting shape.

In the **Explore** tab, **Presets** set layers and settings for common forms: lettuce edge, petal, coral, collar, bloom, and brain folds. **Explore variants** grows four versions from the current shape with one setting changed, such as Bend stiffness or Core firmness, so you can continue the one you like.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play or stop. On a button reached with Tab, Space presses that button instead. |
| . | Step |
| O, B, E, S | Orbit, paint, erase, smooth |
| [ and ] | Brush size |
| ⌘Z or Ctrl+Z | Undo brush stroke |
| G | Next color overlay |
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
- `src/lib/brain.ts` and `src/assets/brain/`: brain mode's recipe, the built-in brain at three fold sizes, and rebuilding an uploaded STL. `src/lib/voxel.ts` builds the outer layer and the rebuilt shapes on a voxel grid; `src/lib/outerLayer.worker.ts` runs it off the page. The design is in [docs/brain-mode.md](docs/brain-mode.md)

Growth Studio was split out of Growth Lab at commit `2837c65`.

## License

Growth Studio is released under the [MIT License](LICENSE).

The built-in brain in `src/assets/brain/` is based on "Brain Model" by Nevit Dilmen on NIH 3D ([3DPX-002739](https://3d.nih.gov/entries/3dpx-002739)) and is licensed separately under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see [its credits](src/assets/brain/CREDITS.md).
