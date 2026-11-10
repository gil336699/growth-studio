# Brain mode

Brain mode grows a closed shape the way a brain folds. Its whole surface grows over a soft core, so the extra surface buckles into folds. A thick outer layer then rounds the ridges and closes the grooves. You can start from the built-in brain, which is the shape behind the Instagram reel, or upload your own STL.

It's based on Tallinen et al., "On the growth and form of cortical convolutions" (*Nature Physics* 12, 2016), and on the tests in this repository's brain-folding notes. It's a look-alike, not the paper's solid model. See the limits below.

## Where it lives

| Place | What's new |
| --- | --- |
| Starting surface card | A **Sheet / Brain** switch. In Brain mode the card offers **Built-in brain** and **Upload STL**, **Fold size** (Fine, Medium, Broad), **Smoothing** for uploads, and the brain shape's credit. |
| Growth field | A **Whole surface** layer, for any model. |
| Simulation | A **Core** section, for any model: **Core firmness** and **Core growth**. |
| File › Export mesh | On a closed shape, **Add thickness** builds an **outer layer**: everything inside the surface plus a wall around it, merged where folds touch. It's watertight, shown while growth is paused, and exported in mm. |
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

## Uploading in brain mode

1. Read the STL, centre it and turn it Y-up. Scale it so its bounding sphere matches the built-in brain's, so the recipe gives the same fold size. Its own millimetres are kept for display and export.
2. Rebuild it as a smooth, closed surface on a voxel grid:
   - mark the surface and measure the distance to it;
   - fill the outside from the grid's edge, through a small closing radius, so small holes don't leak;
   - make a signed distance field and smooth it (Smoothing: Light, Medium or Strong);
   - extract the surface at the Fold size's spacing, then smooth it lightly.
3. Apply the recipe without the midline mask. Erase growth with the brush wherever it shouldn't grow, such as the inner walls of two halves.

An open surface, such as a vase, has no inside to fill. Brain mode says so and suggests Sheet mode with the Brain folds preset.

## Physics: the core

In every solver pass, each vertex moves a share of the way toward its anchor:

`p += k (anchor − p)`, with `anchor = c + (rest − c)(1 + coreGrowth · strain)`

- `k` is Core firmness.
- `rest` is the vertex's place on the starting shape.
- `c` is the centre of the starting shape's bounding box. Edge splits don't move it, so a saved and reopened model continues exactly.
- At a firmness of 0 the core is off.

## The outer layer

The solid is everything within h of the grown surface, or inside it. Its outer face is built on a voxel grid:

1. Sample the triangles into the grid.
2. Run a Euclidean distance transform (Felzenszwalb–Huttenlocher).
3. Flood-fill the outside.
4. Build a signed field and blur it twice.
5. Extract the surface with surface nets and apply Taubin smoothing.

Touching walls merge, so the result is watertight with no crossings. A test checks that every edge is used exactly twice. On a folded brain at 0.0125 voxels it takes about 2 s, in a worker.

## Credits

The built-in brain is based on "Brain Model" by Nevit Dilmen, NIH 3D (3DPX-002739), licensed CC BY 4.0. It was smoothed, the cerebellum and brainstem were removed, and the halves were joined. The credit appears in the app, the README and `src/assets/brain-cerebrum.CREDITS.md`.

## Limits

- A thin sheet on a spring core makes rounded, wave-like folds. The paper's solid cortex creases inward and touches itself, so its grooves are narrower and deeper.
- Fold size follows the mesh, not a cortex thickness.
- The cortex has one thickness everywhere.
