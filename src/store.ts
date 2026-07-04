import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AccountType, AssetMix, Inputs, Partner } from './engine'
import { blendedReturn, blendedVolatility } from './engine'

export const DEFAULT_PARTNER: Partner = {
  currentAge: 35,
  cppStartAge: 65,
  cppAnnualAt65: 10000,
  oasStartAge: 65,
  oasAnnualAt65: 8700,
}

export const MIX_PRESETS: Record<string, AssetMix> = {
  allStocks: { stocks: 1, bonds: 0, gic: 0, cash: 0 },
  aggressive: { stocks: 0.8, bonds: 0.2, gic: 0, cash: 0 },
  balanced: { stocks: 0.6, bonds: 0.4, gic: 0, cash: 0 },
  conservative: { stocks: 0.4, bonds: 0.5, gic: 0.1, cash: 0 },
  gic: { stocks: 0, bonds: 0, gic: 1, cash: 0 },
}

export const DEFAULT_INPUTS: Inputs = {
  currentAge: 35,
  fireAge: 45,
  lifeExpectancy: 90,
  province: 'ON',
  annualSavings: 40000,
  savingsSplit: { tfsa: 0.3, rrsp: 0.5, nonReg: 0.2 },
  retirementSpending: 50000,
  returns: { tfsa: 0.043, rrsp: 0.043, nonReg: 0.043 },
  fees: 0.002,
  volatilities: { tfsa: 0.12, rrsp: 0.12, nonReg: 0.12 },
  balances: { tfsa: 100000, rrsp: 200000, nonReg: 100000 },
  nonRegBook: 80000,
  cppStartAge: 65,
  cppAnnualAt65: 10000,
  oasStartAge: 65,
  oasAnnualAt65: 8700,
  strategy: 'meltdownPaced',
  goal: 'legacy',
  inflation: 0.021,
  fireTargetAssets: 1000000,
  partner: null,
  principalResidence: null,
  investmentProperty: null,
}

export const WORKSHEET_KEYS = [
  'wsHousing',
  'wsUtilities',
  'wsGroceries',
  'wsTransport',
  'wsHealth',
  'wsTravel',
  'wsEntertainment',
  'wsOther',
] as const

const DEFAULT_WORKSHEET: Record<string, number> = Object.fromEntries(
  WORKSHEET_KEYS.map((k) => [k, 0]),
)

export type DisplayMode = 'real' | 'nominal'

interface Store {
  inputs: Inputs
  displayMode: DisplayMode
  mixPresets: Record<AccountType, string>
  worksheet: Record<string, number>
  scenarioA: Inputs | null
  set: (patch: Partial<Inputs>) => void
  setDisplayMode: (m: DisplayMode) => void
  applyMixPreset: (account: AccountType, preset: string) => void
  setWorksheet: (key: string, value: number) => void
  saveScenarioA: () => void
  clearScenarioA: () => void
  reset: () => void
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      inputs: DEFAULT_INPUTS,
      displayMode: 'real',
      mixPresets: { tfsa: 'allStocks', rrsp: 'allStocks', nonReg: 'allStocks' },
      worksheet: DEFAULT_WORKSHEET,
      scenarioA: null,
      set: (patch) => set((s) => ({ inputs: { ...s.inputs, ...patch } })),
      setDisplayMode: (m) => set({ displayMode: m }),
      applyMixPreset: (account, preset) =>
        set((s) => {
          const mix = MIX_PRESETS[preset]
          if (!mix) return { mixPresets: { ...s.mixPresets, [account]: preset } }
          return {
            mixPresets: { ...s.mixPresets, [account]: preset },
            inputs: {
              ...s.inputs,
              returns: { ...s.inputs.returns, [account]: blendedReturn(mix) },
              volatilities: {
                ...(s.inputs.volatilities ?? DEFAULT_INPUTS.volatilities!),
                [account]: blendedVolatility(mix),
              },
            },
          }
        }),
      setWorksheet: (key, value) =>
        set((s) => ({ worksheet: { ...s.worksheet, [key]: value } })),
      saveScenarioA: () => set((s) => ({ scenarioA: structuredClone(s.inputs) })),
      clearScenarioA: () => set({ scenarioA: null }),
      reset: () =>
        set({
          inputs: DEFAULT_INPUTS,
          worksheet: DEFAULT_WORKSHEET,
          mixPresets: { tfsa: 'allStocks', rrsp: 'allStocks', nonReg: 'allStocks' },
        }),
    }),
    {
      name: 'fire-inputs',
      // v4: fees (MER) input added; defaults fill in via merge
      version: 4,
      // pass old state through untouched — field mapping happens in merge;
      // without this, a version bump silently discards the user's data
      migrate: (state) => state as Store,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store> & {
          inputs?: Partial<Inputs> & { withdrawalOrder?: string[] }
        }
        // v2 → v3: withdrawalOrder array became a named strategy
        const legacy = p.inputs?.withdrawalOrder
        const migratedStrategy =
          p.inputs?.strategy ??
          (legacy?.[0] === 'rrsp'
            ? 'meltdownPaced'
            : legacy?.[0] === 'tfsa'
              ? 'tfsaFirst'
              : legacy?.[0] === 'nonReg'
                ? 'nonRegFirst'
                : DEFAULT_INPUTS.strategy)
        return {
          ...current,
          ...p,
          inputs: { ...DEFAULT_INPUTS, ...(p.inputs ?? {}), strategy: migratedStrategy },
          worksheet: { ...DEFAULT_WORKSHEET, ...(p.worksheet ?? {}) },
          mixPresets: { ...current.mixPresets, ...(p.mixPresets ?? {}) },
        }
      },
    },
  ),
)
