# Brain folds and closed shapes

Brain folds grows a closed shape the way a brain folds. Its whole surface grows over a soft core, so the extra surface buckles into folds. Since 0.16.0 there are no modes: every starting surface lives in one tool, and a closed shape grows with Brain folds as itself. Start from the built-in brain, which is the shape behind the Instagram reel, or upload your own closed STL. Brain folds is also a preset you can apply to any shape.

It's based on Tallinen et al., "On the growth and form of cortical convolutions" (*Nature Physics* 12, 2016), and on the brain-folding tests behind the Instagram reel. It's a look-alike, not the paper's solid model. See the limits below.

## Where it lives

| Place | What it does |
| --- | --- |
| Starting surface card | **Default disk**, **Built-in brain** and **Upload STL**. An uploaded STL is used as it is. An open surface, such as a vase, grows from its rims; a closed shape grows over its whole surface with Brain folds. The built-in brain's credit shows while it's loaded. |
| Form | **Fold size** (Fine, Medium, Broad) whenever something grows over the whole surface. A rim's folds have their own slider, **Rim fold size**. |
| Growth field | A **Whole surface** layer, for any model. |
| Simulation | A **Core** section, for any model: **Core firmness** and **Core growth**. **Contact in growth field** sets **Repel distance** in millimeters, from 0 to 12 mm. |
| File › Export mesh | On a closed shape, **Print solid**: the grown surface itself, smoothed with **Smooth surface**, its sharp edges kept by **Sharp edge angle** or rounded by **Bevel sharp edges**, and cut flat by **Flat base**, **Base cut** mm up. It's watertight, shown while growth is paused, and exported in mm. |
| Explore › Presets | **Brain folds**: whole-surface growth over a core, at the chosen Fold size. |
| 3D view | The built-in brain is smooth-shaded. |

## The recipe

These values reproduce the reel's model (run g2b):

| Setting | Value |
| --- | --- |
| Growth | Whole surface, 0.3% a step (the app default), linear |
| Not growing | The built-in brain: the inner walls between the halves and the middle of the base. An upload standing on a flat bottom, whenever the whole surface grows: the bottom and the lowest fifth of its wall, held still. Both are erased paint, painted again on Reset. |
| Bend stiffness | 0.2 |
| Core firmness | 0.005 per solver pass |
| Core growth | 10% of the surface's growth |
| Remesh edge length | The Fold size's split length, scaled to the shape (below) |
| Mesh detail limit | 3.5× |
| Stop at | Step 420 |

Fold size sets the split length during growth. In this model, folds come out about three mesh edges wide. The lengths are the built-in brain's; on any other shape they're scaled by its bounding-sphere radius over the built-in brain's, 1.173, so a size gives folds of the same size compared with the shape. An upload has radius 1.

| Fold size | Built-in brain | An upload |
| --- | --- | --- |
| Fine | 0.07 | 0.060 |
| Medium (the reel) | 0.09 | 0.077 |
| Broad | 0.11 | 0.094 |

The built-in brain also comes meshed at each size, with starting edges of 0.045, 0.055 and 0.065.

### Changing Fold size

Fold size changes only how growth carries on, at any time, so nothing starts over:

- The split length becomes the new size's, so later splits make the mesh finer or let it stay coarser, and new folds follow it. The folds already grown stay.
- The vertex limit scales with (the split length the surface was prepared at / the new one)², at most 4 times, so Fine has room for its smaller triangles. It never drops while the shape grows, so going broader after a finer size doesn't stop growth at the vertices already there. It's saved with the project's settings as `budgetScale`.
- If growth had stopped at Stop at, the stop moves 140 steps on, so Play growth carries on.
- Playing from an earlier step branches from there at the chosen size, as with any setting.
- Only the built-in brain, before it grows, is swapped for the brain meshed at the new size, as a fresh brain of that size starts.
- Reset takes the built-in brain back to a smooth brain meshed for the current size. Any other shape goes back to itself, prepared at the current split length.

Switching mid-growth doesn't give exactly the shape a fresh start at that size would: the folds that formed before the switch keep their size. Going finer adds smaller folds on and between them.

## Uploading a closed shape

1. Read the STL, centre it and turn it Y-up. Scale it to radius 1; its own millimeters are kept for display and export.
2. Check that it's one clean solid. Every edge must be shared by two faces. Faces a CAD export turned the wrong way are turned back. Each piece faces out of the volume it encloses, or into it when it lies inside another piece, as a sealed hollow's inner wall does. That is tested from a point just inside the piece, behind its largest face, so a body lying flat on another isn't taken for a hollow. Nothing is rebuilt, so thin walls and designed edges stay.
   - Where bodies exported together touch along an edge, so that more than two faces share it, each body opens as its own closed piece, with its own copies of the shared points. Where bodies overlap or touch along a line or over an area, the starting surface crosses itself, so the card says so and offers Grow anyway; bodies that meet only at a point don't count.
   - Where the shared edges close into a loop, as around a face whose outline both bodies' meshes have in common, the loop cuts that face off from each body, so no body is closed. The STL is refused, with how to combine the bodies.
   - A closed surface whose faces can't all face outward, such as a one-sided surface, is refused.
   - An STL whose open edges add up to at most a tenth of its bounding sphere's circumference looks almost closed, like a CAD export with a hairline gap. It grows as an open surface from its gaps, with a note saying how to close them. The length is measured, not the share of edges, so a finely meshed cup with a real opening isn't mistaken for one.
3. Prepare it as any upload: long edges are split to the Fold size's split length, up to 300 new vertices; flat patches are remeshed and triangles balanced.
4. Apply the recipe. If the shape stands on a flat bottom, the bottom and the lowest fifth of the wall don't grow, fading out by 30% of the height, and **Hold parts that don't grow** keeps them still, so the print still stands flat on the bed.

Applying the Brain folds preset to an open surface that stands on a flat bottom, such as a vase base, holds its bottom the same way.

Measured in the app on 24 November 2026:

| Shape | Opened | Print solid at step 0, Light | After growth |
| --- | --- | --- | --- |
| Pen holder, closed, 2.4 mm walls, 15,036 triangles | As it is, its flat bottom held | 99.7% of the STL's volume (118,837 of 119,153 mm³), within 0.2 mm of its size, 55.3 cm² on the bed | 161 steps, Fold size changed to Broad at step 61: no blocked steps, 55.3 cm² still on the bed |
| Built-in brain, 12,572 triangles | | | 142 steps, Fine from step 83: with a 5 mm flat base, 107,516 triangles, every edge shared by two faces, 10.8 cm² on the bed |

Before 0.16.0, brain mode refused that pen holder: its walls were too thin for the voxel rebuild at Medium folds.

## The print solid

A closed shape is a solid already, so it prints as it grew:

1. **Smooth surface** runs Loop subdivision on the grown surface: Off, Light or Strong for 0, 1 or 2 passes, four times the triangles each. Edges of the starting shape that bend more than **Sharp edge angle** stay sharp where the surface hasn't grown: both their ends grew at most 10% in length. **Bevel sharp edges** rounds them partly, as semi-sharp creases do. This is the same smoothing an open sheet gets before its wall. A level that would pass 400,000 triangles is unavailable.
   - Where the surface grew, a designed edge has folded with it, so it's smoothed like the rest. Kept sharp there, smoothing folds the surface over it. The pen holder grown 160 steps at Medium has 610 sharp edges, of which 256 haven't grown, around its held bottom. With all 610 kept, its Light-smoothed solid crossed itself in 18 places; with the 256, in none, and it still stood on all 55.3 cm² of its bottom. A larger Repel distance didn't help: at 3 mm, with all 610 kept, it crossed in 47 places.
2. **Rounds** chosen with the Edges tool are made next, on loops that haven't grown (lib/roundEdges). While smoothing, a loop to round is kept fully sharp and followed through each pass. Then a ball of the round's radius rolls along it, touching the faces on both sides. Where those faces leave the loop in directions an angle α apart, the circle touches each face r / tan(α/2) from the loop. The faces within that distance are cut along rows, and each point there moves onto the circle. The move is worked out at the loop's points and blended along each loop edge, so it changes smoothly along the loop. Points beyond the touching line stay exactly where they were. A loop that can't take the round is left sharp, and the card says why: it doesn't close all the way round; another sharp edge meets it, as at a box's corner; the round would reach another sharp edge or an open rim, meet itself across a narrow face, or curve more tightly than the round (each edge of the loop must keep at least 15% of its length on the touching line); its faces meet at less than 10°; a face would turn over; or the round would cut through to another part of the surface, as a large round on a pot's thin wall cuts into the pot. That last is found by testing the round's faces against every face near them, by how long the lines are where faces cross, so a shape that crossed itself already isn't blamed on the round. A round is also left sharp when it would leave the wall behind it thinner than 0.8 mm, or than the shape's own walls beside it where those are thinner: the wall left is measured into the solid from each point the round moves, along the round's normal, and the shape's own walls from the middle of each face the round reaches and from its touching lines, as it was. A ray from the middle of a face that would leave through the edge's other side within the round's reach crosses the edge's own wedge, most of which the round cuts away, so that hit doesn't count and the ray carries on past it; at an edge sharper than a right angle it would make the walls seem as thin as the wedge. A round is left sharp when the wall it leaves is under 98% of the thinnest allowed, a margin for its facets. A 3 mm round on a pot with 1.2 mm walls would leave 0.45 mm at the corner, r − √2 (r − 1.2).
   - A round on an edge that sits on the bed starts with its steepest overhang: with 0.2 mm layers, a 2 mm round's second layer hangs 0.43 mm past its first, about a line width. Keep such an edge sharp or its round small; a 45° chamfer, made in your CAD tool, prints cleaner there.
3. **Flat base** cuts the solid flat at its lowest point plus **Base cut**. A round that lies wholly below the cut is cut away with it, and its card says so. Triangles crossing the floor are clipped, and the cut is closed with a flat cap facing down, triangulated with its holes kept, so a ring gets a ring-shaped base. The solid stays watertight.
4. The solid is checked in a worker, as an open sheet's wall is: that every edge is shared by two faces, and where it crosses itself. On a fully grown brain, 420 steps and 33,012 triangles, it builds in 16 ms at Light, 132,048 triangles, and 149 ms with a 5 mm flat base, measured in Node, best of three.

Nothing is merged: folds that come close stay two surfaces. **Repel distance** keeps folds apart while they grow. Folds closer than your nozzle width, about 0.4 mm, fuse in print, so keep it at least that; a fold that overhangs another can still sag onto it. At 0 mm, folds in the growth field may touch.

Before 0.16.0, brain mode rebuilt each upload on a voxel grid and wrapped the grown surface in a voxel outer layer. The grid erased walls thinner than about a fold's width: a planter with 1.5 mm walls kept 11% of its volume at Medium folds, and a pen holder with 2.4 mm walls was refused. It also rounded designed edges and filled narrow grooves. Projects saved from brain mode's uploads open as ordinary closed shapes, their rebuilt mesh kept.

## Physics: the core

In every solver pass, each vertex moves a share of the way toward its anchor:

`p += k (anchor − p)`, with `anchor = c + (rest − c)(1 + coreGrowth · strain)`

- `k` is Core firmness.
- `rest` is the vertex's place on the starting shape.
- `c` is the centre of the starting shape's bounding box. Edge splits don't move it, so a saved and reopened model continues exactly.
- At a firmness of 0 the core is off.

## Credits

The built-in brain is based on "Brain Model" by Nevit Dilmen, NIH 3D (3DPX-002739), licensed CC BY 4.0. It was smoothed, the cerebellum and brainstem were removed, and the halves were joined. The credit appears in the app, the README and `src/assets/brain/CREDITS.md`.

## Limits

- A thin sheet on a spring core makes rounded, wave-like folds. The paper's solid cortex creases inward and touches itself, so its grooves are narrower and deeper.
- Fold size follows the mesh, not a cortex thickness.
- Rim presets grow from open rims, so on a closed shape only Brain folds and paint grow.
- On a closed shape with thin walls, such as a pen holder, a wall's two faces fold separately, kept apart by Repel distance, so check its thickness after growth.
