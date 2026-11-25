# Growth Studio

Growth Studio is a browser app for differential growth. Start from a flat disk or an open STL such as a Fusion vase base, decide where and when it grows, and watch the rim ruffle and fold. Or start from a closed shape, the built-in brain or your own STL, and its whole surface folds like a brain. Save editable projects, and export OBJ or STL back to CAD, or as a solid with walls and rounded rims, ready to print. The **print check** colors what a slicer would need to support, so you can grow shapes that print without it.

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
- **Left panel.** The starting surface, **Default disk**, **Built-in brain** or **Upload STL**, and any warnings about the mesh. Below it, the **Growth field** tab holds the growth layers and the **Simulation** tab holds growth rate, stopping, gravity, contact, and advanced settings.
- **Top of the 3D view.** Tools (Orbit, Paint, Erase, Smooth, Undo) on the left. Choosing a brush tool shows its size, strength, hardness, and symmetry just below. Color overlay, mesh view, ghost, and framing on the right. Choosing **Print check** shows the support angle and what it counted just below.
- **Bottom of the 3D view.** The timeline dock: **Play growth**, **Step**, and **Reset**, the status, scrubbing, snapshots, and phases.
- **Right panel.** **Form** shows measurements, Fold size, and stats. **Explore** has presets and variants. **File** saves, opens, and exports, and shows a dot when there are unsaved changes.

On tablets the 3D view sits on top, with both panels below it. On phones everything is in one column.

## Help in the app

- **Hover any control**, or move to it with Tab, to see a short description of what it does, with its keyboard shortcut. Buttons that are unavailable say why, for example why Play is off.
- **Terms with a dotted underline**, such as Target strain, explain themselves on hover.
- **Quick start** shows three steps on the first visit. Reopen it from the **?** button.

## Workflow

1. **Starting surface.** Use the default disk, the built-in brain, or **Upload STL**. An STL is used as it is: open rims are detected automatically, and a closed shape grows over its whole surface with Brain folds (see [Brain folds](#brain-folds)).
2. **Growth layers.** Decide where growth comes from. Each layer has a strength, its own settings, and optional timing.
3. **Brush.** Pick Paint, Erase, or Smooth above the 3D view and brush growth onto the model, even while it grows. On an uploaded STL, **Edges** shows its designed edges: click one to choose its loop, to keep it sharp or round it on the print (see [Thickness for printing](#thickness-for-printing)).
4. **Grow.** Press **Play growth** in the timeline dock, step in batches, or run a recipe of phases. **Relax only** lets the form settle without adding growth.
5. **Look back.** Scrub the timeline to any snapshot and continue from there.
6. **Save and export.** **Save project** writes an editable `.growthstudio.json` file. **Export OBJ** or **Export STL** writes the current surface in the STL's original coordinates, unless **Center exported mesh** is checked.
7. **Make it printable.** The surface is an open sheet. Turn on **Add thickness** under **File › Export mesh** to export a solid instead (see [Thickness for printing](#thickness-for-printing)). Choose **Print check** in the Color menu, or press P, to see what will need support (see [Print check](#print-check)).

The app asks before Reset, Upload STL, Default disk, or Open project would discard unsaved work. Growth Lab disk projects also open.

## Brain folds

Brain folds grows a closed shape the way a brain folds. The whole surface grows over a soft core, so the extra surface buckles into folds instead of inflating the shape. It's based on Tallinen et al., "On the growth and form of cortical convolutions" (*Nature Physics*, 2016), where a gel copy of a smooth fetal brain folded in minutes.

1. Choose **Built-in brain** in the Starting surface card: a smooth brain made from an MRI scan, 150 mm long. Or choose **Upload STL** and pick a closed shape of your own.
2. Press **Play growth**. It folds and stops at step 420, with the folds from the Instagram reel.
3. Scrub the timeline back to watch it unfold, or export it: **File › Export STL** writes its print solid, watertight and in millimeters.

| Setting | Effect |
| --- | --- |
| Built-in brain | Loads the built-in brain with the reel's recipe, at the last Fold size chosen. |
| Upload STL | A closed STL is used as it is, so thin walls and designed edges stay, and grows with the Brain folds recipe. Faces turned the wrong way are turned back, and a sealed hollow's inner wall keeps facing into the hollow. Bodies exported together that touch open as separate closed bodies, each facing outward. If the edges they share close into a loop, as around a face whose outline both meshes have in common, the STL is refused, with how to combine the bodies. An STL whose open edges are short, like a hairline gap, opens as an open surface, with a note saying how to close them. If it stands on a flat bottom, the bottom and the lowest fifth of the wall don't grow and are held still, also after Reset, so it keeps standing flat on the bed: a pen holder with 2.4 mm walls, grown 161 steps, still stood on all 55 cm² of its flat bottom. |
| Fold size (Form) | **Fine**, **Medium** or **Broad**: more, smaller folds, or fewer, wider ones. Medium is the reel. It shows whenever something grows over the whole surface. It changes only the split length, so at any time growth carries on at the new size, from where it is. The lengths scale to the shape's size, so a size gives folds of the same size compared with any shape. Only the built-in brain, before it grows, is swapped for the brain meshed at that size. If growth had stopped at Stop at, the stop moves 140 steps on. |

The recipe sets everything else, and each setting can still be changed. **Brain folds** under Explore › Presets applies it to any shape, at the chosen Fold size, and holds a flat bottom still the same way.

| Setting | Value |
| --- | --- |
| Growth field | A **Whole surface** layer. On the built-in brain, the inner walls between the halves and the middle of the base are erased, as in the paper. |
| Core | Firmness 0.5%, growth 10% |
| Bend stiffness | 20% |
| Stop at | Step 420 |
| Mesh detail limit | 3.5× |
| Print solid | On, smoothed once (Light), sharp edges kept |

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
| Smooth surface | **Off** uses the surface as it grew. **Light** smooths it once, before the wall on a sheet: four times the triangles, and most facets gone. **Strong** smooths it twice: sixteen times the triangles, smooth even on a coarse sheet. Smoothing is Loop subdivision; open rims follow a smooth curve through their own points, so a flat bottom rim stays flat. Edges that bend more than the Sharp edge angle in the starting shape, 30° by default, such as the edge around a vase base's flat bottom, stay sharp where the surface hasn't grown, so the print still sits flat on the bed. Where it grew, they fold with the surface and are smoothed like the rest: kept sharp, the folded edges of a pen holder grown with Brain folds made its Light-smoothed solid cross itself in 18 places. A very coarse sheet whose facets bend more than that keeps them too, unless you raise Sharp edge angle or Bevel. Folds soften a little: the upright Collar's solid is about 0.5 mm narrower. A level that would pass 400,000 triangles is unavailable, and its button says why. |
| Sharp edge angle | How sharp an edge must be in the starting shape to stay sharp when smoothing: 30° by default, from 10° to 60°. Lower it to catch softer edges, such as a shallow chamfer; raise it to smooth the facets of a coarse mesh. On a pen holder whose 3 mm bottom chamfer bends 45° at the bed and 35° at the wall, Strong smoothing at 40° moved the outside of the chamfer's top edge by up to 0.5 mm; at 30° the exported solid matches the unsmoothed one within 0.07 mm. The tooltip says how many mesh edges are sharp at that angle. Projects saved with 0.12.0 open at 40°, the rule that version used. |
| Bevel sharp edges | Rounds those sharp edges: **0%** keeps them sharp, higher values round them more, and **100%** rounds them like the rest of the surface, as 0.11 did. On a vase base with a flat bottom 60 mm across, grown with Lettuce edge and given a 1.2 mm wall, the Light-smoothed solid stands on a circle 61 mm across at 0%, and about 59 mm from 50% up. The tooltip says how many mesh edges are sharp, and the status line under the solid says whether they're kept, beveled or rounded. With Smooth surface off, on a sheet too large to smooth, or on a shape with no sharp edges (the default disk, the weave vase), it's unavailable and says why. Projects saved with 0.11 that use smoothing open at 100%, so they export as before. |
| Edges | Loops of the starting shape's edges chosen with the **Edges** tool (D) above the 3D view, listed here. Click an edge to choose just its loop, Shift-click to add one, and Option-click to remove one; on a touch screen, tap to add and tap again to remove. Each loop is **Keep sharp** or **Round**. **Keep sharp** keeps a loop that closes all the way round fully sharp, whatever Smooth surface and Bevel do; a loop with ends, such as one edge of a box, is only as sharp at its ends as the edges it meets there, so with Bevel above 0% it fades out toward them. **Round** makes a true round of 0.5 to 10 mm, described under [Rounds](#rounds). |
| Wall thickness | The total wall, 0.2 to 5 mm. Most filament printers need at least 0.8 mm, and resin printers about 0.5 mm. |
| Wall side | **Both** centers the wall on the surface. **Outside** puts all of it outside, so the grown surface becomes the inner face; **Inside** puts all of it inside, so the outer size doesn't change. On the default disk these are **Top** and **Bottom**. |
| Rim edge | **Round** closes each rim with a half-round edge, like a leaf or petal. **Soft** is a flat edge with rounded corners, and **Square** cuts straight across the wall. |
| Longest side | The default disk has no units, so its solid, wall and rims included, is scaled to this length in millimeters. An uploaded STL keeps its own millimeters. |
| Show in 3D view | Shows the solid while growth is paused. |

With Smooth surface off, every fold of the grown surface is kept: the wall is offset along the surface, not rebuilt. With it on, the wall follows the smoothed surface. Where folds come closer together, or bend more tightly, than the wall is thick, the wall passes through itself. The app checks for this after each change and colors those places pink. It also checks that the solid is closed, and says so if the STL pinches to a point or has faces turned inconsistently. Most slicers merge them; for a clean solid, use a thinner wall, or grow with a larger **Repel distance** so folds stay further apart.

The print solid is made in a background worker, 0.1 s after each change while growth is paused, so the page stays responsive however long it takes: only drawing the new print happens on the page. While you change its settings, the 3D view keeps the last print, the Edges cards and the status line under the solid read **Updating the print…**, and Export is unavailable. A change while a print is being made stops it and starts the new one, so dragging a slider makes one print once it stops moving. Where a browser can't start the worker, the page makes the print itself, as before.

On a **closed shape**, such as a brain, the switch is **Print solid**, since the shape is a solid already. Export writes the grown surface itself, smoothed with **Smooth surface**, **Sharp edge angle** and **Bevel sharp edges** as a sheet is, in millimeters. **Flat base** cuts it flat at the bottom, **Base cut** mm up (5 mm by default), so a print stands on the bed without supports under it; the cut is closed with a flat cap, its holes kept, so the solid stays watertight. Nothing is rebuilt or merged, so thin walls stay as they are and close folds stay two surfaces: folds closer than your nozzle width, about 0.4 mm, fuse in print, so keep **Repel distance** at least that. The app checks the solid each time growth pauses, as it checks a wall. On the built-in brain grown 142 steps, the Light-smoothed solid with a 5 mm flat base had 107,516 triangles, every edge shared by two faces, and stood on 10.8 cm². On a fully grown brain it builds in about 0.15 s, measured in Node.

### Rounds

A round from the Edges tool is made on the print only, after smoothing and before the wall or flat base, and only where the shape hasn't grown: a loop on a part that grew is smoothed with the rest.

- A round is the surface a ball of its radius leaves when rolled along the edge, touching the faces on both sides. A 2 mm round on a cylinder's bottom rim, exported from the app, lies within 0.022 mm of a true 2 mm circle.
- On an open sheet the round is made on the sheet, and the wall follows it. The wall's outer face gets a round larger by the part of the wall outside the sheet, and its inner face one smaller by the part inside: with a 1.2 mm wall on both sides, a 2 mm round prints 2.6 mm outside and 1.4 mm inside.
- On a closed shape a round cuts into the wall behind it: a 3 mm round on a pot with 1.2 mm walls would leave 0.45 mm at the corner.
- A loop the round doesn't fit is left sharp, and its card says why:
  - it doesn't close all the way round, or another sharp edge meets it, as at a box's corner;
  - the round would reach another sharp edge or an open rim, meet itself across a narrow face, or curve more tightly than the round;
  - its faces meet at less than 10°, or a face would turn over;
  - the round would cut through to another part of the surface, as through a pot's thin wall;
  - on a closed shape, it would leave the wall behind it thinner than 0.8 mm, or than the shape's own walls beside it where those are thinner;
  - on a sheet, the wall on its inner side would leave that face less than a tenth of the round, or the wall would cross itself along it;
  - or Flat base cuts it away.
- On a vase base's bottom loop of 72 edges, with a 1.2 mm wall, the print solid with a 2 mm round takes 226 ms as uploaded, 476 ms with Light smoothing and 613 ms with Strong, against 5, 7 and 24 ms without it, measured in Node on the mesh the app prepares.

## Print check

Choose **Print check** in the **Color** menu above the 3D view, or press **P**, to see what a slicer would need to support. The colors are those of the Parametric Viewer prototype.

| Color | Means |
| --- | --- |
| Green, **Printable** | Prints without support. |
| Yellow, **Marginal** | Up to 10° steeper than the support angle: it prints, but only just. |
| Red, **Needs support** | Faces down and leans out flatter than the support angle. |
| Blue, **Touches the bed** | Faces straight down within 0.2 mm of the lowest point, Bambu Studio's first layer. |
| Dark dot, **Low point** | Lower than everything around it, on a surface facing down, so it hangs in the air. It needs a support to start on, even when its sides are steep. |

**Support angle** is counted up from the bed, as Bambu Studio and PrusaSlicer count it: 45° by default, the classic rule, and Bambu Studio's own default is 30°. Cura counts from vertical, so only 45° means the same in both. The bar below the menu says what was counted, for example "Needs support 10.5% · 7 low points in the air · 55.3 cm² on the bed" for a pen holder grown 161 steps with Brain folds, as its Light-smoothed print solid. **From below** turns the view to look up at the undersides, where supports go; **Frame** turns it back.

The check counts the surface the view shows: the solid or the print solid when it's shown, otherwise the sheet, read as a wall with two sides, both of which count, so a sheet reads about as its solid will. Before the default disk grows, the crests of its starting ripple sit up to 0.3 mm above the bed, so a few of them show red. While growth runs it counts a few times a second, and growth is no slower for it: the Collar grew to its target in about 19 s with the check on or off.

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
| Fold size (Form) | How big folds grow over a whole surface: **Fine**, **Medium** or **Broad**. Change it any time; growth carries on at the new size. |
| Rim fold size (Form) | Sets rim width and bend stiffness together, from fine to broad. |
| Gravity | Pulls on the growth field only. The rest of the model stays in place. |
| Hold parts that don't grow | Under Gravity. Holds the parts with no growth exactly where they are, as gravity does, so an erased flat bottom stays on the bed while the rest folds. On whenever gravity is. |
| Repel distance and strength | How far apart folds in the growth field stay when they meet, 0 to 12 mm, and how quickly they are pushed back. For printing, folds closer than your nozzle width, about 0.4 mm, fuse, and on a sheet the wall fills the gap too. On the default disk the millimeters are for the starting disk at its print size. |
| Remesh edge length, Mesh detail limit (Simulation › Advanced) | Starting triangle size and how many vertices growth can add. **No limit** lets growth keep refining up to 240,000 vertices, about 480,000 triangles: as large a sheet as Growth Studio can open again. |

The **Form** tab reports waves on each growing rim, size compared with the start, and dimensions in millimeters. The **Color** menu above the 3D view switches the overlay between the growth field, growth so far, recent contact, and the [print check](#print-check), and **Ghost** shows the starting shape.

In the **Explore** tab, **Presets** set layers and settings for common forms: lettuce edge, petal, coral, collar, collar upright, bloom, and brain folds. **Explore variants** grows four versions from the current shape with one setting changed, such as Bend stiffness or Core firmness, so you can continue the one you like.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play or stop. On a button reached with Tab, Space presses that button instead. |
| . | Step |
| O, B, E, S, D | Orbit, paint, erase, smooth, edges |
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
- With **No limit**, steps keep getting slower as the mesh refines. Bloom on the weave vase ran 23 steps a second at 2,074 vertices, where the default limit stops it, and 12 a second at 6,084 vertices four minutes later.
- Stop takes effect after the step in progress, which on a dense mesh can take a few hundred milliseconds. The status reads Stopping… until then.
- Opening a very large STL still pauses the page while the surface is prepared, about 6 seconds for 181,000 triangles.
- Very dense growth, such as compounding beyond about 15 times the original size, blocks more steps and slows to a few steps per second.
- STL files carry no units. Dimensions, and the wall of a thickened STL, are in millimeters.
- The print check counts faces on the mesh. It doesn't know your slicer's settings: a slicer skips very small overhangs, bridges short gaps, and adds supports only when they're switched on, so its result can differ a little. Turn on Add thickness to check the solid with its rims rather than the sheet.
- The wall has one thickness everywhere; it cannot yet vary across the model.
- Browsers may slow work in hidden tabs, so growth can slow down while the tab is hidden. The view catches up when you return.
- The built-in brain grows its 420 steps in about a minute and a half in Chrome (89 s on an M1 Max, 4.7 steps a second), ending at 16,508 points. Fine folds start from 9,564 points instead of 6,288 and take about 2½ minutes (161 s), ending at 24,592 points.
- On a closed shape with thin walls, such as a pen holder, a wall's two faces fold separately, kept apart by Repel distance, so check its thickness after growth.
- Rounds work on loops that close all the way round. A loop that ends at corners, such as one edge of a box, can be kept sharp but not rounded, since a round can't yet blend into a corner.
- On a coarse CAD mesh, a round along a very tight curve, such as the end of a narrow raised letter, may be left sharp: try a smaller radius. Smoothing changes the faces there, which can help or not.
- Rounds assume the faces beside the loop are flat. On a curved face, such as a domed bottom, a large round strays from the true rolling ball: a 5 mm round on a dome of 18 mm radius by about 0.15 mm, a 2 mm round by 0.015 mm. On a saddle-shaped face, a few narrow faces of a round can bend enough to show in smooth shading, though the round doesn't cross itself.
- On a grown pot, the loop around its held bottom is usually left sharp ("another sharp edge meets this loop"): the folds of the grown wall reach the bottom edge.
- Where a round meets the faces beside it, a sheet's wall can have a few thin faces turned over, up to about 0.01 mm wide: on a 48-facet cup with Light smoothing and a 5 mm round, 8 covering 0.011 mm² with the wall on both sides, and 16 covering 0.15 mm² with it inside. The crossing check doesn't count them, and they are far below what a printer can show.
- The wall a round leaves on a closed shape is measured from the round's rows, with a 2% margin under 0.8 mm. At a corner whose walls differ, the thinnest place can lie between rows, so a round can be made that leaves about 0.015 mm less than the margin allows.
- Rounds still take a while on a dense mesh, though the page no longer waits for them. In Chrome, on a finely meshed vase base, 60 mm across and 98,000 triangles, 390,000 once Light smoothed, with a 1.2 mm wall and a 2 mm round on its bottom loop, a change to the round shows on the print about 2.0 s later, and a change to the wall without a round about 0.5 s later: each about 0.2 s later than in 0.18.0, since a print waits 0.1 s for further changes before it starts. The page pauses only to draw the new print, for under 0.1 s, and with Print check on, about 0.05 s more to count it. A click meanwhile is answered at once. In 0.18.0 the page froze for as long as the print took, 1.8 s with the round and 0.3 s without it, and a click on a tab or another control during it made the print start over.
- Two smaller jobs for the print still run on the page, as in 0.18.0: counting the sharp edges that Bevel's tooltip reports, once for each Sharp edge angle, and finding the borders the Edges tool shows, each time that angle changes while the tool is on. On that vase base they take about 0.04 s and 0.12 s, and on an STL of 400,000 triangles about 0.4 s and 1 s.
- A round on an edge that sits on the bed starts with its steepest overhang: with 0.2 mm layers, a 2 mm round's second layer hangs 0.43 mm past its first, about a line width, and a 0.5 mm round's 0.16 mm. Keep such an edge sharp or its round small; a 45° chamfer, made in your CAD tool, prints cleaner there.
- Smoothing a grown surface can make very tight folds cross. The status line says where, and Smooth surface off exports the grown surface, which growth keeps from crossing, with any rounds, which are left sharp where they would cut through it.
- Rim presets grow from open rims, so on a closed shape only Brain folds and paint grow.

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
- `src/lib/printSolid.ts`: the print solid for the File tab's settings and the Edges tool's loops, from `sheetSolid.ts` (a sheet smoothed by `smoothSheet.ts`, rounded by `roundEdges.ts` and given its wall by `thicken.ts`) or `closedSolid.ts` (a closed shape's). `usePrintSolid.ts` has it made in `printSolid.worker.ts`, or on the page where the worker can't start, and `solidCheck.worker.ts` checks that it's closed and where it crosses itself
- `src/lib/printCheck.ts`: the print check (what needs support, what sits on the bed, and low points), counted for the view by `usePrintCheck.ts` and colored by `src/components/printShader.ts`
- `src/lib/brain.ts` and `src/assets/brain/`: the Brain folds recipe, Fold size, and the built-in brain at three fold sizes. `src/lib/upload.ts` reads an STL as it is and checks a closed one with `meshCheck.ts`; `closedSolid.ts` and `cutFlat.ts` make a closed shape's print solid. The design is in [docs/brain-mode.md](docs/brain-mode.md)

Growth Studio was split out of Growth Lab at commit `2837c65`.

## License

Growth Studio is released under the [MIT License](LICENSE).

The built-in brain in `src/assets/brain/` is based on "Brain Model" by Nevit Dilmen on NIH 3D ([3DPX-002739](https://3d.nih.gov/entries/3dpx-002739)) and is licensed separately under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see [its credits](src/assets/brain/CREDITS.md).
