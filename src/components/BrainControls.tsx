// The Starting surface card's brain-mode controls: where the brain comes from, its fold size and, for an uploaded STL,
// how much it is smoothed. Changing either rebuilds the starting shape.
import { BRAIN_CREDIT, FOLD_ORDER, FOLD_SIZES, SMOOTHING, SMOOTHING_ORDER, type FoldSize, type Smoothing } from '../lib/brain'
import type { BrainInfo } from '../physics/growthStl'

export function BrainControls({ brain, foldSize, smoothing, loading, canRebuild, onBuiltIn, onUpload, onFoldSize, onSmoothing }: {
  brain: BrainInfo | null
  foldSize: FoldSize
  smoothing: Smoothing
  loading: boolean
  // False after reopening a project made from an upload: the original STL is no longer here to rebuild from.
  canRebuild: boolean
  onBuiltIn: () => void
  onUpload: () => void
  onFoldSize: (size: FoldSize) => void
  onSmoothing: (smoothing: Smoothing) => void
}) {
  const uploaded = Boolean(brain && !brain.builtin)
  const locked = uploaded && !canRebuild
  const lockedTip = 'Upload the STL again to rebuild it. The original file is not saved in the project.'
  return <>
    <div className="button-row">
      <button type="button" disabled={loading} onClick={onBuiltIn}
        data-tip="Start from the built-in brain: a smooth, unfolded brain made from an MRI scan, ready to fold.">Built-in brain</button>
      <button type="button" disabled={loading} onClick={onUpload}
        data-tip="Load a closed shape from an STL. Brain mode rebuilds it as one smooth, closed surface, then grows it like a brain.">{loading ? 'Preparing…' : 'Upload STL'}</button>
    </div>
    <div className="group-field"><span id="fold-size-label" data-tip="How big the folds grow. It sets how finely the starting shape is meshed.">Fold size</span>
      <div className="button-row three" role="group" aria-labelledby="fold-size-label">
        {FOLD_ORDER.map(size => <button key={size} type="button" aria-pressed={foldSize === size} disabled={loading || locked}
          data-tip={locked ? lockedTip : `${FOLD_SIZES[size].tip} Rebuilds the starting shape.`} onClick={() => onFoldSize(size)}>{FOLD_SIZES[size].label}</button>)}
      </div>
    </div>
    {uploaded && <div className="group-field"><span id="smoothing-label" data-tip="How much the uploaded shape is smoothed before it grows.">Smoothing</span>
      <div className="button-row three" role="group" aria-labelledby="smoothing-label">
        {SMOOTHING_ORDER.map(level => <button key={level} type="button" aria-pressed={smoothing === level} disabled={loading || locked}
          data-tip={locked ? lockedTip : `${SMOOTHING[level].tip} Rebuilds the starting shape.`} onClick={() => onSmoothing(level)}>{SMOOTHING[level].label}</button>)}
      </div>
    </div>}
    {brain?.builtin && <p className="hint credit">{BRAIN_CREDIT.short}. <a href={BRAIN_CREDIT.url} target="_blank" rel="noreferrer"
      data-tip={BRAIN_CREDIT.text}>Source</a></p>}
  </>
}
