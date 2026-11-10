# Brain mode

Brain mode grows a closed shape the way a brain folds. Its whole surface grows over a soft core, so the extra surface buckles into folds. A thick outer layer then rounds the ridges and closes the grooves. You can start from the built-in brain, which is the shape behind the Instagram reel, or upload your own STL.

It's based on Tallinen et al., "On the growth and form of cortical convolutions" (*Nature Physics* 12, 2016), and on the brain-folding tests behind the Instagram reel. It's a look-alike, not the paper's solid model. See the limits below.

## Where it lives

| Place | What's new |
| --- | --- |
| Starting surface card | A **Sheet / Brain** switch. In Brain mode the card offers **Built-in brain** and **Upload STL**, **Fold size** (Fine, Medium, Broad), **Smoothing** for uploads, and the brain shape's credit. |
| Growth field | A **Whole surface** layer, for any model. |
| Simulation | A **Core** section, for any model: **Core firmness** and **Core growth**. |
| File › Export mesh | On a closed shape, **Add thickness** builds an **outer layer**: everything inside the surface plus a wall around it, merged where folds touch. It's watertight, shown while growth is paused, and exported in mm. **Flat base** cuts it flat at the bottom, **Base cut** mm up, for printing. |
| Explore › Presets | **Brain folds**: whole-surface growth over a core, for any model. |
| 3D view | Brain models are smooth-shaded. While growing, the outer layer is previewed by pushing the surface out along its normals. When growth pauses, the exact layer replaces the preview. |

## The recipe

These values reproduce the reel's model (run g2b):

| Setting | Value |
| --- | --- |
| Growth | Whole surface, 0.3% a step (the app default), linear |
| Not growing | The inner walls between the halves, and the middle of the base (built-in brain only, as erased paint) |
| Bend stiffness | 0.2 |
| Core firmness | 0.005 per solver pass |
| Core growth | 10% of the surface's growth |
| Remesh edge length | 0.09 (Medium) |
| Mesh detail limit | 3.5× |
| Stop at | Step 420 |
| Outer layer | 2.7 mm cortex on a 150 mm brain (0.02 units out from the surface) |

Fold size sets how finely the starting shape is meshed, and the split length during growth. In this model, folds come out about three mesh edges wide.

| Fold size | Starting mesh | Remesh edge length |
| --- | --- | --- |
| Fine | 0.045 | 0.07 |
| Medium | 0.055 (the reel) | 0.09 |
| Broad | 0.065 | 0.11 |

### Changing Fold size while it grows

Before the brain grows, Fold size rebuilds the starting shape at its spacing, since there's nothing to lose. Once it has grown, including when you look back at an earlier step, Fold size keeps the shape and the timeline and changes only how growth carries on:

- The split length becomes the new size's, so later splits make the mesh finer or let it stay coarser, and new folds follow it. The folds already grown stay.
- The vertex limit scales with (starting size's split / new split)², so Fine has room for its smaller triangles. A broader size keeps the limit it had, so growth isn't stopped at the vertices already there. It's saved with the project's settings as `budgetScale`.
- If growth had stopped at Stop at, the stop moves 140 steps on, so Play growth carries on.
- Playing from an earlier step branches from there at the chosen size, as with any setting.
- Reset goes back to a smooth brain meshed for the current size: the built-in brain at that spacing, or the upload rebuilt. A project reopened from an upload no longer has the STL, so it resets to its starting shape.

Switching mid-growth doesn't give exactly the brain a fresh start at that size would: the folds that formed before the switch keep their size. Going finer adds smaller folds on and between them.

## Uploading in brain mode

1. Read the STL, centre it and turn it Y-up. Scale it so its bounding sphere matches the built-in brain's, so the recipe gives the same fold size. Its own millimeters are kept for display and export.
2. Rebuild it as a smooth, closed surface on a voxel grid:
   - mark the surface and measure the distance to it;
   - fill the outside from the grid's edge, through a small closing radius, so small holes don't leak;
   - make a signed distance field and smooth it (Smoothing: Light, Medium or Strong);
   - extract the surface at the Fold size's spacing, then smooth it lightly.
3. Apply the recipe without the midline mask. Erase growth with the brush wherever it shouldn't grow, such as the inner walls of two halves.

An open surface, such as a vase, has no inside to fill. Brain mode says so and suggests Sheet mode with the Brain folds preset.

The grid is as fine as the folds, so walls thinner than about a fold's width don't survive the rebuild. The rebuild is compared with the STL:
- **Mostly gone:** under 25% of the volume kept, or a side under 60% of its length. The upload is refused with the STL's mean wall thickness (2 × volume / area). Light smoothing and Fine folds are suggested only after a trial rebuild at them keeps the shape. Sheet mode with the Brain folds preset is always offered, since it uses the mesh as it is.
- **Partly gone:** under 75% of the volume kept, or more pieces than the STL has. The shape loads with a note: how much was kept, and the gentler setting that keeps more.

Measured on real files:

| STL | Fine, Light | Medium, Light | Medium, Medium | Broad, Light |
| --- | --- | --- | --- | --- |
| NIH MRI brain, 250k triangles | 106%, 1 piece | 106%, 1 piece | 102%, 1 piece | 105%, 1 piece |
| Keychain tag, 1.5 mm thick | 90%, 1 piece | 84%, 1 piece | 18%, refused | 66%, note |
| Planter, 1.5 mm walls, 120 mm | 21%, refused | 11%, refused | 3%, refused | 40% and 11% of its height, refused |

Light is the default smoothing for uploads for this reason.

## Physics: the core

In every solver pass, each vertex moves a share of the way toward its anchor:

`p += k (anchor − p)`, with `anchor = c + (rest − c)(1 + coreGrowth · strain)`

- `k` is Core firmness.
- `rest` is the vertex's place on the starting shape.
- `c` is the centre of the starting shape's bounding box. Edge splits don't move it, so a saved and reopened model continues exactly.
- At a firmness of 0 the core is off.

## The outer layer

The solid is everything within h of the grown surface, or inside it. Its outer face is built on a voxel grid:

1. Sample the triangles a quarter voxel apart. Each voxel the surface passes through keeps the sample nearest its center, and two raster sweeps carry those points outward. Distances are measured to the surface itself, not to voxel centers, so smooth areas stay smooth. Around a sphere, the face's normals tilt 0.8° RMS from radial, against 1.8° when measured to voxel centers, which showed as rings.
2. Flood-fill the outside through voxels farther than h from the surface. Walls closer together than 2h merge.
3. Build a signed field and blur it twice. The blur rounds the ridges and fills crevices narrower than about two voxels, which is the look of the reel's model. It also pulls the face in by about a third of a voxel, so the layer is built that much thicker.
   - With **Flat base**, the field is then intersected with the half-space above a floor, the layer's lowest point plus Base cut. That field is linear in y, so surface nets put the base's vertices exactly on the floor. Smoothing only rounds the base's edge, and any vertex it dips below the floor goes back onto it.
4. Fill cavities. The blur can close a narrow groove's mouth and seal its inside as a bubble. A second flood from the outside fills any pocket it can't reach, so the solid has one outer surface. A folded brain had 3 bubbles and a folded keychain tag 25, each an inner shell that a slicer prints as a hidden hollow. The upload rebuild fills them the same way.
5. Join pinches. Where four voxels around an edge alternate inside and outside, surface nets would share one edge among four faces. The outside corner nearest the surface moves just inside.
6. Extract the surface with surface nets, and split any vertex where two parts of the surface meet at a point.
7. Smooth with Taubin smoothing.

Tests check that every edge is used exactly once in each direction, and the export QA checks that a folded brain and a folded tag come out as one piece. Welding vertices by position, as an STL reader does, keeps them that way. On the reel's folded brain the layer has about 590,000 triangles, all edges shared by two faces, and takes about 4 seconds in Node; in the app it runs in a worker.

## Credits

The built-in brain is based on "Brain Model" by Nevit Dilmen, NIH 3D (3DPX-002739), licensed CC BY 4.0. It was smoothed, the cerebellum and brainstem were removed, and the halves were joined. The credit appears in the app, the README and `src/assets/brain/CREDITS.md`.

## Limits

- A thin sheet on a spring core makes rounded, wave-like folds. The paper's solid cortex creases inward and touches itself, so its grooves are narrower and deeper.
- Fold size follows the mesh, not a cortex thickness.
- The cortex has one thickness everywhere.
