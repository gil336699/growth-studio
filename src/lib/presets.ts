import { DISK_DEFAULTS } from '../physics/growingDisk'
import { createLayer, type GrowthLayer } from '../physics/growthLayers'
import type { Phase, StopAt } from './diskProject'

type Mechanics = typeof DISK_DEFAULTS
export type Preset = {
  id: string
  name: string
  description: string
  // Builds layers for a surface with the given number of open rims.
  build: (rimCount: number) => { layers: GrowthLayer[]; mechanics: Partial<Mechanics>; phases?: Phase[]; stopAt?: StopAt }
}

// Grow the top rim of a vase with two openings, or every rim otherwise.
const rimTarget = (rimCount: number) => rimCount === 2 ? 0 : 'all' as const

export const PRESETS: Preset[] = [
  {
    id: 'lettuce', name: 'Lettuce edge', description: 'Tight ruffles along a narrow rim band. For finer frills, lower Remesh edge length and press Reset.',
    build: rimCount => ({
      layers: [createLayer('rim', { name: 'Ruffled rim', rim: rimTarget(rimCount), width: 0.08, falloff: 'linear' }), createLayer('paint')],
      mechanics: { growthRate: 0.004, bending: 0.03, compoundGrowth: 0, gravity: 0 },
      // Strain stops work on any surface; a rim ruffle barely changes a tall vase's overall size.
      stopAt: { kind: 'strain', value: 3 },
    }),
  },
  {
    id: 'petal', name: 'Petal', description: 'A few broad lobes that cup and fold.',
    build: rimCount => ({
      layers: [createLayer('rim', { name: 'Petals', rim: rimTarget(rimCount), width: 0.28, lobes: 5, falloff: 'soft' }), createLayer('paint')],
      mechanics: { growthRate: 0.003, bending: 0.09, compoundGrowth: 0, gravity: 0 },
      stopAt: { kind: 'strain', value: 1.5 },
    }),
  },
  {
    id: 'coral', name: 'Coral', description: 'Irregular, accelerating growth with organic variation.',
    build: rimCount => ({
      layers: [
        createLayer('rim', { name: 'Growing edge', rim: rimTarget(rimCount), width: 0.2, falloff: 'soft' }),
        createLayer('noise', { name: 'Variation', strength: 0.7, scale: 0.15, seed: 7 }),
        createLayer('paint'),
      ],
      mechanics: { growthRate: 0.002, bending: 0.05, compoundGrowth: 1, gravity: 0 },
      stopAt: { kind: 'strain', value: 8 },
    }),
  },
  {
    id: 'collar', name: 'Collar', description: 'A wide, soft flare that droops under gravity.',
    build: rimCount => ({
      layers: [createLayer('rim', { name: 'Collar', rim: rimTarget(rimCount), width: 0.35, falloff: 'soft' }), createLayer('paint')],
      mechanics: { growthRate: 0.003, bending: 0.14, compoundGrowth: 0, gravity: 0.35, gravityTilt: 0 },
      stopAt: { kind: 'strain', value: 1.2 },
    }),
  },
  {
    id: 'bloom', name: 'Bloom', description: 'Lobes grow first, then a fine ruffle joins later.',
    build: rimCount => ({
      layers: [
        createLayer('rim', { name: 'Lobes', rim: rimTarget(rimCount), width: 0.25, lobes: 6, falloff: 'soft' }),
        createLayer('rim', { name: 'Late ruffle', rim: rimTarget(rimCount), width: 0.07, falloff: 'linear', timing: { start: 250, end: null, keys: [{ step: 250, value: 0 }, { step: 350, value: 1 }] } }),
        createLayer('paint'),
      ],
      mechanics: { growthRate: 0.003, bending: 0.06, compoundGrowth: 0, gravity: 0 },
      phases: [{ mode: 'grow', steps: 600 }, { mode: 'relax', steps: 100 }],
    }),
  },
  {
    id: 'brain', name: 'Brain folds', description: 'The whole surface grows over a soft core, so it buckles into folds like a brain. Best on a closed shape.',
    build: () => ({
      layers: [createLayer('surface', { name: 'Whole surface' }), createLayer('paint')],
      mechanics: { growthRate: 0.003, bending: 0.2, compoundGrowth: 0, gravity: 0, coreStiffness: 0.005, coreGrowth: 0.1, detailScale: 3.5 },
      stopAt: { kind: 'step', value: 420 },
    }),
  },
]
