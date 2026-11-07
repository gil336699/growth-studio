# Growth Studio

Growth Studio is a browser app for differential growth. Start from a flat disk or an open STL such as a Fusion vase base, decide where and when it grows, and watch the rim ruffle and fold. Save editable projects and export OBJ or STL back to CAD.

**Use it online:** https://gil336699.github.io/growth-studio/

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
- **Left panel.** The starting surface, with Upload STL, Default disk, and any warnings about the mesh. Below it, the **Growth field** tab holds the growth layers and the **Simulation** tab holds growth rate, stopping, gravity, contact, and advanced settings.
- **Top of the 3D view.** Tools (Orbit, Paint, Erase, Smooth, Undo) on the left. Choosing a brush tool shows its size, strength, hardness, and symmetry just below. Color overlay, mesh view, ghost, and framing on the right.
- **Bottom of the 3D view.** The timeline dock: **Play growth**, **Step**, and **Reset**, the status, scrubbing, snapshots, and phases.
- **Right panel.** **Form** shows measurements, Fold size, and stats. **Explore** has presets and variants. **File** saves, opens, and exports, and shows a dot when there are unsaved changes.

On tablets the 3D view sits on top, with both panels below it. On phones everything is in one column.

## Help in the app

- **Hover any control**, or move to it with Tab, to see a short description of what it does, with its keyboard shortcut. Buttons that are unavailable say why, for example why Play is off.
- **Terms with a dotted underline**, such as Target strain, explain themselves on hover.
- **Quick start** shows three steps on the first visit. Reopen it from the **?** button.

## Workflow

1. **Starting surface.** Use the default disk, or choose **Upload STL**. Open rims are detected automatically.
2. **Growth layers.** Decide where growth comes from. Each layer has a strength, its own settings, and optional timing.
3. **Brush.** Pick Paint, Erase, or Smooth above the 3D view and brush growth onto the model, even while it grows.
4. **Grow.** Press **Play growth** in the timeline dock, step in batches, or run a recipe of phases. **Relax only** lets the form settle without adding growth.
5. **Look back.** Scrub the timeline to any snapshot and continue from there.
6. **Save and export.** **Save project** writes an editable `.growthstudio.json` file. **Export OBJ** or **Export STL** writes the current surface in the STL's original coordinates, unless **Center exported mesh** is checked. The surface is an open sheet and may need thickness before printing.

The app asks before Reset, Upload STL, Default disk, or Open project would discard unsaved work. Growth Lab disk projects also open.

## Growth layers

Where layers overlap, the strongest one wins. Erase and noise apply on top.

| Layer | What it does |
| --- | --- |
| Rim | Grows inward from an open rim (or all rims) over a set width. Lobes grow from evenly spaced spots around the rim instead. |
| Painted | Growth painted with the brush. Erase removes paint first, then masks other layers. |
| Point | A growing spot you place on the model, with a radius. |
| Line | A band of growth along a line you draw on the model. |
| Height ramp | Growth that increases from one height of the starting shape to another. |
| Noise | Organic variation applied to the other layers, with a pattern size and seed. |

Every layer can start and stop at timeline steps, and intensity keyframes ramp it up or down over time.

## Controls

| Control | Effect |
| --- | --- |
| Growth field width | How far a rim layer reaches in. Narrower fields give smaller, more numerous folds. |
| Brush size, strength, hardness | Brush radius, how much a pass adds, and how evenly it paints. A pen's pressure scales strength. |
| Symmetry | Mirror strokes across the vertical axis, or repeat them radially. |
| Growth rate and curve | Expansion per step. **Linear** adds the same amount each step; **Compounding** adds a share of the current size. |
| Bend stiffness | Resistance to tight folds. |
| Stop at | Stops playback at a size, target strain, or step. |
| Fold size (Form) | Sets rim width and bend stiffness together, from fine to broad. |
| Gravity | Pulls on the growth field only. The rest of the model stays in place. |
| Repel distance and strength | How far apart folds in the growth field stay when they meet, and how quickly they are pushed back. |
| Remesh edge length, Mesh detail limit (Simulation › Advanced) | Starting triangle size and how many vertices growth can add. |

The **Form** tab reports waves on each growing rim, size compared with the start, and dimensions in millimeters. The **Color** menu above the 3D view switches the overlay between the growth field, growth so far, and recent contact, and **Ghost** shows the starting shape.

In the **Explore** tab, **Presets** set layers and settings for common forms: lettuce edge, petal, coral, collar, and bloom. **Explore variants** grows four versions from the current shape with one setting changed, so you can continue the one you like.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play or stop |
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

This is a position-based design model. It is not a validated thin-shell or biological simulation.

## Known limits

- Speed drops as the vertex count rises. On a 90 mm vase, about 40 steps per second at 1,100 vertices falls to about 13 at 3,400.
- Very dense growth, such as compounding beyond about 15 times the original size, blocks more steps and slows to a few steps per second.
- STL files carry no units. Dimensions are reported as millimeters.
- Browsers slow timers in background tabs, so playback pauses when the tab is hidden.

## Development

```bash
npm run lint
npm test
npm run build
```

- `src/App.tsx`: the workspace, playback, timeline, and project files
- `src/components/`: the viewport, layers, timeline, and variant panels
- `src/physics/`: the growing surface, growth layers, contact, bending, remeshing, and Voronoi views
- `src/lib/`: STL import, project files, export, presets, readouts, and symmetry

Growth Studio was split out of Growth Lab at commit `2837c65`.

## License

Growth Studio is released under the [MIT License](LICENSE).
