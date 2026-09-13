import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import type { AccountType, AssetMix, Child, Fhsa, Inputs, LockedRetirement, Partner, Pension } from './engine'
import { blendedReturn, blendedVolatility } from './engine'
import { track, trackOnce } from './analytics'
import type { InputsV2 } from './engine/model'
import { migratePersistedPlan, refreshCanonicalFromLegacy } from './engine/migration'

export const DEFAULT_PARTNER: Partner = {
  currentAge: 35,
  cppStartAge: 65,
  cppAnnualAt65: 10000,
  oasStartAge: 65,
  oasAnnualAt65: 8700,
}

export const DEFAULT_PENSION: Pension = {
  annualAmount: 30000,
  startAge: 60,
  indexation: 1,
  bridgeAnnual: 0,
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
  nonRegDistributionYield: 0.02,
  accumulationMarginalRate: 0.35,
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
  investmentProperties: [],
  fhsa: null,
}

export const DEFAULT_INVESTMENT_PROPERTY = {
  value: 500000,
  acb: 400000,
  appreciation: 0.02,
  sellAtAge: null,
  annualRent: 0,
}

export const DEFAULT_FHSA: Fhsa = {
  balance: 0,
  annualContribution: 8000,
  openedYearsAgo: 0,
}

export const DEFAULT_LOCKED_RETIREMENT: LockedRetirement = {
  balance: 0,
  employeeContribution: 0,
  employerContribution: 0,
  accessibleAge: 55,
  jurisdiction: 'ON',
  owner: 'self',
}

export const DEFAULT_CHILD: Child = { age: 5 }

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
export type EntryMode = 'guided' | 'professional'
export type GuidedView = 'questionnaire' | 'review' | 'results'
export type LegacyPreference = 'undecided' | 'none' | 'maxRemaining' | 'minimumAmount' | 'lifetimeGifts'
export type SpendingPreference = 'undecided' | 'maintain' | 'exploreCeiling'
export interface PlanningIntent {
  beneficiaries: string[]
  legacyPreference: LegacyPreference
  spendingPreference: SpendingPreference
  understandingAcknowledged: boolean
  confirmedIntentRevision: number | null
}
export type AnswerStatus = 'confirmed' | 'estimated' | 'unknown' | 'notApplicable'
export type AnswerOrigin = 'user' | 'default' | 'legacy' | 'example'
export interface AnswerMeta {
  status: AnswerStatus
  origin: AnswerOrigin
  updatedAt: string
  assumptionValue?: number
}

const LEGACY_META_FIELDS = [
  'goal', 'currentAge', 'fireAge', 'lifeExpectancy', 'province', 'household', 'annualSavings',
  'retirementSpending', 'balances.tfsa', 'balances.rrsp', 'balances.nonReg',
  'nonRegBook', 'housingMode', 'cppStartAge', 'cppAnnualAt65', 'oasStartAge', 'oasAnnualAt65',
]

function legacyAnswerMeta(): Record<string, AnswerMeta> {
  const updatedAt = new Date().toISOString()
  return Object.fromEntries(LEGACY_META_FIELDS.map((field) => [field, {
    status: 'estimated' as const,
    origin: 'legacy' as const,
    updatedAt,
  }]))
}

interface Store {
  canonical: InputsV2 | null
  scenarioACanonical: InputsV2 | null
  draftByField: Record<string, string>
  inputs: Inputs
  displayMode: DisplayMode
  entryMode: EntryMode
  activeStep: number
  visitedSteps: number[]
  activePageId: string
  guidedView: GuidedView
  questionAnswers: Record<string, string | boolean | string[]>
  planningIntent: PlanningIntent
  inputRevision: number
  resultRevision: number | null
  answerMeta: Record<string, AnswerMeta>
  scenarioAAnswerMeta: Record<string, AnswerMeta> | null
  mixPresets: Record<AccountType, string>
  worksheet: Record<string, number>
  scenarioA: Inputs | null
  set: (patch: Partial<Inputs>) => void
  commitPlan: (transaction: { inputs: Inputs; canonical: InputsV2; answerMeta: Record<string, AnswerMeta>; draftByField: Record<string, string> }) => void
  setDisplayMode: (m: DisplayMode) => void
  setEntryMode: (m: EntryMode) => void
  setActiveStep: (step: number) => void
  setActivePage: (pageId: string) => void
  setGuidedView: (view: GuidedView) => void
  setQuestionAnswer: (questionId: string, value: string | boolean | string[]) => void
  setPlanningIntent: (patch: Partial<PlanningIntent>) => void
  generateGuidedResults: () => void
  markAnswers: (fields: string[], status: AnswerStatus, origin?: AnswerOrigin) => void
  applyMixPreset: (account: AccountType, preset: string) => void
  setWorksheet: (key: string, value: number) => void
  saveScenarioA: () => void
  restoreScenarioA: () => void
  clearScenarioA: () => void
  reset: () => void
}


const BACKUP_KEY = 'fire-inputs:pre-v11-backup'
let storageReadOnlyReason: 'futureVersion' | 'corrupt' | 'migrationFailed' | null = null
export const getStorageReadOnlyReason = () => storageReadOnlyReason
const planStorage: PersistStorage<Store> = {
  getItem(name) {
    const original = localStorage.getItem(name)
    if (original === null) return null
    try {
      const parsed = JSON.parse(original) as StorageValue<Store>
      if (!parsed || typeof parsed !== 'object' || !('state' in parsed) || typeof parsed.version !== 'number') throw new Error('Invalid persisted envelope')
      if (parsed.version > 11) { storageReadOnlyReason = 'futureVersion'; return null }
      if (parsed.version < 11) {
        // Validate before allowing any subsequent write, including a failed migration.
        migratePersistedPlan(parsed.state, parsed.version, new Date().getFullYear())
        // Write-once original bytes. If this fails, hydration aborts without replacing the plan.
        if (localStorage.getItem(BACKUP_KEY) === null) localStorage.setItem(BACKUP_KEY, original)
      }
      return parsed
    } catch {
      if (!storageReadOnlyReason) storageReadOnlyReason = 'corrupt'
      return null
    }
  },
  setItem(name, value) {
    if (storageReadOnlyReason) return
    try { localStorage.setItem(name, JSON.stringify(value)) }
    catch { storageReadOnlyReason = 'migrationFailed' }
  },
  removeItem(name) { if (!storageReadOnlyReason) localStorage.removeItem(name) },
}

export const useStore = create<Store>()(
  persist(
    (set) => ({
      canonical: null,
      scenarioACanonical: null,
      draftByField: {},
      inputs: DEFAULT_INPUTS,
      displayMode: 'real',
      entryMode: 'guided',
      activeStep: 1,
      visitedSteps: [1],
      activePageId: 'family.people',
      guidedView: 'questionnaire',
      questionAnswers: {},
      planningIntent: {
        beneficiaries: ['self'],
        legacyPreference: 'undecided',
        spendingPreference: 'undecided',
        understandingAcknowledged: false,
        confirmedIntentRevision: null,
      },
      inputRevision: 0,
      resultRevision: null,
      answerMeta: {},
      scenarioAAnswerMeta: null,
      mixPresets: { tfsa: 'allStocks', rrsp: 'allStocks', nonReg: 'allStocks' },
      worksheet: DEFAULT_WORKSHEET,
      scenarioA: null,
      set: (patch) => {
        trackOnce('adjust_inputs')
        set((s) => {
          const oldLocked = s.inputs.lockedRetirement
          const newLocked = patch.lockedRetirement
          const ownerChanged = newLocked !== undefined &&
            (Boolean(oldLocked) !== Boolean(newLocked) ||
              (!!oldLocked && !!newLocked && oldLocked.owner !== newLocked.owner))
          const householdChanged = patch.partner !== undefined && Boolean(s.inputs.partner) !== Boolean(patch.partner)
          const ownerAnswer = s.answerMeta['lockedRetirement.owner']
          const inputs = { ...s.inputs, ...patch }
          return {
            inputs,
            canonical: refreshCanonicalFromLegacy(s.canonical, inputs),
            inputRevision: s.inputRevision + 1,
            resultRevision: null,
            answerMeta: (ownerChanged || householdChanged) && ownerAnswer
              ? { ...s.answerMeta, 'lockedRetirement.owner': { ...ownerAnswer, status: 'unknown' as const, updatedAt: new Date().toISOString() } }
              : s.answerMeta,
          }
        })
      },
      commitPlan: ({ inputs, canonical, answerMeta, draftByField }) => set((s) => ({
        inputs, canonical, answerMeta, draftByField,
        inputRevision: s.inputRevision + 1, resultRevision: null,
      })),
      setDisplayMode: (m) => {
        track('display_mode_change', { mode: m })
        set({ displayMode: m })
      },
      setEntryMode: (m) => {
        track('mode_change', { mode: m })
        set({ entryMode: m })
      },
      setActiveStep: (step) =>
        set((s) => ({
          activeStep: Math.max(1, Math.min(7, step)),
          visitedSteps: s.visitedSteps.includes(step)
            ? s.visitedSteps
            : [...s.visitedSteps, step],
        })),
      setActivePage: (activePageId) => set({ activePageId, guidedView: 'questionnaire' }),
      setGuidedView: (guidedView) => set({ guidedView }),
      setQuestionAnswer: (questionId, value) =>
        set((s) => ({ questionAnswers: { ...s.questionAnswers, [questionId]: value } })),
      setPlanningIntent: (patch) =>
        set((s) => ({
          planningIntent: {
            ...s.planningIntent,
            ...patch,
            understandingAcknowledged: patch.understandingAcknowledged ?? false,
            confirmedIntentRevision: patch.confirmedIntentRevision ?? null,
          },
          resultRevision: null,
        })),
      generateGuidedResults: () => set((s) => ({ guidedView: 'results', resultRevision: s.inputRevision })),
      markAnswers: (fields, status, origin = 'user') =>
        set((s) => {
          const updatedAt = new Date().toISOString()
          const answerMeta = { ...s.answerMeta }
          fields.forEach((field) => {
            answerMeta[field] = { status, origin, updatedAt }
          })
          return { answerMeta }
        }),
      applyMixPreset: (account, preset) => {
        track('asset_mix_change', { account, preset })
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
            inputRevision: s.inputRevision + 1,
            resultRevision: null,
          }
        })
      },
      setWorksheet: (key, value) =>
        set((s) => ({
          worksheet: { ...s.worksheet, [key]: value },
          inputRevision: s.inputRevision + 1,
          resultRevision: null,
        })),
      saveScenarioA: () => {
        track('scenario_save')
        set((s) => ({
          scenarioA: structuredClone(s.inputs),
          scenarioACanonical: structuredClone(s.canonical),
          scenarioAAnswerMeta: structuredClone(s.answerMeta),
        }))
      },
      restoreScenarioA: () => {
        track('scenario_restore')
        set((s) => (s.scenarioA ? {
          inputs: structuredClone(s.scenarioA),
          canonical: structuredClone(s.scenarioACanonical ?? migratePersistedPlan({ inputs: s.scenarioA }, 10, new Date().getFullYear())),
          answerMeta: structuredClone(s.scenarioAAnswerMeta ?? legacyAnswerMeta()),
          inputRevision: s.inputRevision + 1,
          resultRevision: null,
        } : {}))
      },
      clearScenarioA: () => {
        track('scenario_clear')
        set({ scenarioA: null, scenarioACanonical: null, scenarioAAnswerMeta: null })
      },
      reset: () => {
        track('reset_inputs')
        set({
          inputs: DEFAULT_INPUTS,
          canonical: null,
          scenarioACanonical: null,
          draftByField: {},
          worksheet: DEFAULT_WORKSHEET,
          mixPresets: { tfsa: 'allStocks', rrsp: 'allStocks', nonReg: 'allStocks' },
          activeStep: 1,
          visitedSteps: [1],
          activePageId: 'family.people',
          guidedView: 'questionnaire',
          questionAnswers: {},
          inputRevision: 0,
          resultRevision: null,
          answerMeta: {},
        })
      },
    }),
    {
      name: 'fire-inputs',
      // v11 adds canonical schema v2 beside the temporary legacy projection adapter.
      version: 11,
      storage: planStorage,
      // pass old state through untouched — field mapping happens in merge;
      // without this, a version bump silently discards the user's data
      migrate: (state, version) => {
        const previous = state as Partial<Store>
        // Existing users retain the dense form they already know. Fresh stores
        // use the guided default declared above.
        if (version < 10) {
          const legacyPageByStep = [
            'family.people', 'saving.amount', 'assets.identify', 'home.situation',
            'spending.total', 'benefits.self', 'intent.legacy',
          ]
          return {
            ...previous,
            canonical: migratePersistedPlan(previous, version, new Date().getFullYear()),
            scenarioACanonical: previous.scenarioA ? migratePersistedPlan({ inputs: previous.scenarioA }, version, new Date().getFullYear()) : null,
            draftByField: {},
            entryMode: version < 7 ? 'professional' : previous.entryMode,
            activeStep: previous.activeStep ?? 1,
            visitedSteps: previous.visitedSteps ?? [1],
            activePageId: legacyPageByStep[(previous.activeStep ?? 1) - 1] ?? 'family.people',
            guidedView: previous.activeStep === 7 ? 'review' : 'questionnaire',
            questionAnswers: {},
            planningIntent: {
              beneficiaries: ['self'],
              legacyPreference: 'undecided',
              spendingPreference: 'undecided',
              understandingAcknowledged: false,
              confirmedIntentRevision: null,
            },
            inputRevision: 0,
            resultRevision: null,
            answerMeta: legacyAnswerMeta(),
            scenarioAAnswerMeta: previous.scenarioA ? legacyAnswerMeta() : null,
          } as Store
        }
        if (version === 10) return {
          ...previous,
          canonical: migratePersistedPlan(previous, version, new Date().getFullYear()),
          scenarioACanonical: previous.scenarioA ? migratePersistedPlan({ inputs: previous.scenarioA }, version, new Date().getFullYear()) : null,
          draftByField: {},
        } as Store
        return state as Store
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store> & {
          inputs?: Partial<Inputs> & { withdrawalOrder?: string[] }
          scenarioA?: Inputs | null
        }
        type LegacyInputs = Partial<Inputs> & {
          withdrawalOrder?: string[]
          investmentProperty?: (typeof DEFAULT_INVESTMENT_PROPERTY) | null
        }
        const upgrade = (raw: LegacyInputs | null | undefined): Inputs | null => {
          if (!raw) return null
          // v2 → v3: withdrawalOrder array became a named strategy
          const legacy = raw.withdrawalOrder
          const strategy =
            raw.strategy ??
            (legacy?.[0] === 'rrsp'
              ? 'meltdownPaced'
              : legacy?.[0] === 'tfsa'
                ? 'tfsaFirst'
                : legacy?.[0] === 'nonReg'
                  ? 'nonRegFirst'
                  : DEFAULT_INPUTS.strategy)
          // v4 → v5: singular investment property becomes a list
          const investmentProperties =
            raw.investmentProperties ??
            (raw.investmentProperty ? [{ ...raw.investmentProperty }] : [])
          // drop legacy keys so they don't re-persist forever
          const { withdrawalOrder: _wo, investmentProperty: _ip, ...rest } = raw
          return { ...DEFAULT_INPUTS, ...rest, strategy, investmentProperties }
        }
        return {
          ...current,
          ...p,
          canonical: p.canonical ?? null,
          scenarioACanonical: p.scenarioACanonical ?? null,
          draftByField: p.draftByField ?? {},
          inputs: upgrade(p.inputs) ?? DEFAULT_INPUTS,
          scenarioA: upgrade(p.scenarioA as LegacyInputs | null),
          worksheet: { ...DEFAULT_WORKSHEET, ...(p.worksheet ?? {}) },
          mixPresets: { ...current.mixPresets, ...(p.mixPresets ?? {}) },
          entryMode: p.entryMode ?? current.entryMode,
          activeStep: Math.max(1, Math.min(7, p.activeStep ?? current.activeStep)),
          visitedSteps: p.visitedSteps ?? current.visitedSteps,
          activePageId: p.activePageId ?? current.activePageId,
          guidedView: p.guidedView ?? current.guidedView,
          questionAnswers: p.questionAnswers ?? current.questionAnswers,
          planningIntent: p.planningIntent ?? current.planningIntent,
          inputRevision: p.inputRevision ?? current.inputRevision,
          resultRevision: p.resultRevision ?? current.resultRevision,
          answerMeta: p.answerMeta ?? current.answerMeta,
          scenarioAAnswerMeta: p.scenarioAAnswerMeta ?? current.scenarioAAnswerMeta,
        }
      },
    },
  ),
)
