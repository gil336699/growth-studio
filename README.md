# Growth Studio

Growth Studio is a browser app for differential growth. Start from a flat disk or an open STL such as a Fusion vase base, choose where it grows, and watch the rim ruffle and fold. Save editable projects and export OBJ or STL back to CAD.

## Run

Requirements: Node.js 22 or newer and a current desktop browser with WebGL.

```bash
npm install
npm run dev
```

Open the address Vite prints, normally `http://localhost:5173`.

To build static files you can host anywhere, run `npm run build`. The site is written to `dist/`. Preview it with `npm run preview`.

## Workflow

1. **Starting surface.** Use the default disk, or choose **Upload STL**. Open rims are detected automatically.
2. **Where it grows.** Turn openings on or off, set **Growth field width**, or paint and erase a growth patch with the brush. Red marks the growth field.
3. **Grow.** Press **Play growth**, or step in batches. **Relax only** lets the form settle without adding growth.
4. **Save.** **Save project** writes an editable `.growthstudio.json` file with the shape, settings, and brush edits. **Open project** continues from it. Growth Lab disk projects also open.
5. **Export.** **Export OBJ** or **Export STL** writes the current surface. Exports keep the STL's original coordinates unless **Center exported mesh** is checked. The surface is an open sheet and may need thickness before printing.

The app asks before Reset, Upload STL, Use default disk, or Open project would discard unsaved growth or brush edits.

## Controls

| Control | Effect |
| --- | --- |
| Growth field width | How far growth reaches in from each rim. Narrower fields give smaller, more numerous folds. |
| Growth rate | Expansion added per accepted step. |
| Growth curve | **Linear** adds the same amount each step. **Compounding** adds a share of the current size, so growth speeds up. |
| Bend stiffness | Resistance to tight folds. Lower values give tighter folds once the mesh is fine enough. |
| Gravity | Pulls on the growth field only. The rest of the model stays in place. |
| Repel distance and strength | How far apart folds in the growth field stay when they meet, and how quickly they are pushed back. The rest of the model keeps the default contact. |
| Damping (Advanced) | Reduces lingering motion. |
| Remesh edge length (Advanced) | Starting triangle size. Smaller values can hold smaller folds. Press Reset to apply it to an STL. |
| Mesh detail limit (Advanced) | Multiplies how many vertices growth can add. Higher limits keep folds refining but run slower. |

## How the simulation works

Each edge in the growth field has a target length that increases as the sheet grows. Stretching and bending constraints move the surface toward those targets, and new triangles are added when edges grow long. Self-contact pushes apart vertices and faces, edges, and folds at sharp creases before they meet. When a step would still pass the surface through itself, the step is undone, the touching parts are separated, and growth slows until steps are accepted again.

This is a position-based design model. It is not a validated thin-shell or biological simulation.

## Known limits

- Speed drops as the vertex count rises. On a 90 mm vase, about 40 steps per second at 1,000 vertices falls to about 13 at 3,400.
- Very dense growth, such as compounding beyond about 15 times the original size, blocks more steps and slows to a few steps per second.
- STL files carry no units. Dimensions are reported as millimeters.

## Development

```bash
npm run lint
npm test
npm run build
```

- `src/main.tsx`: the app interface and 3D view
- `src/physics/`: the growing surface, contact, bending, remeshing, and Voronoi views
- `src/lib/`: STL import, project files, and OBJ and STL export

Growth Studio was split out of Growth Lab at commit `2837c65`.
