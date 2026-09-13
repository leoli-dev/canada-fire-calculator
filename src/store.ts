import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
import type { AccountType, AssetMix, Child, Fhsa, Inputs, LockedRetirement, Partner, Pension } from './engine'
import { blendedReturn, blendedVolatility } from './engine'
import { track, trackOnce } from './analytics'
import type { InputsV2 } from './engine/model'
import { completeCanonicalFacts, migratePersistedPlan, refreshCanonicalFromLegacy } from './engine/migration'
import { assertCanonicalPlan, assertLegacyInputs } from './engine/modelValidation'
import { changeAccountPresence, changeIntent, editField, reconcileDirectFields } from './forms/planCommands'
import type { SharedFieldId } from './forms/fieldRegistry'

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
const DEFAULT_PLANNING_INTENT: PlanningIntent = {
  beneficiaries: ['self'],
  legacyPreference: 'undecided',
  spendingPreference: 'undecided',
  understandingAcknowledged: false,
  confirmedIntentRevision: null,
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
  editSharedField: (field: SharedFieldId, raw: string, unit?: 'canonical' | 'monthly', origin?: AnswerOrigin) => void
  setAccountPresence: (account: 'tfsa' | 'rrsp' | 'nonReg', present: boolean) => void
  commitPlan: (transaction: { inputs: Inputs; canonical: InputsV2; answerMeta: Record<string, AnswerMeta>; draftByField: Record<string, string> }) => void
  setDisplayMode: (m: DisplayMode) => void
  setEntryMode: (m: EntryMode) => void
  setActiveStep: (step: number) => void
  setActivePage: (pageId: string) => void
  setGuidedView: (view: GuidedView) => void
  setQuestionAnswer: (questionId: string, value: string | boolean | string[]) => void
  setPlanningIntent: (patch: Partial<PlanningIntent>) => void
  setGoalFromProfessional: (goal: 'legacy' | 'dieWithZero') => void
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
type LegacyInputs = Partial<Inputs> & { withdrawalOrder?: string[]; investmentProperty?: typeof DEFAULT_INVESTMENT_PROPERTY | null }
function hydrateLegacyInputs(raw: unknown): Inputs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid legacy inputs')
  const input = raw as LegacyInputs
  const strategy = input.strategy ?? (input.withdrawalOrder?.[0] === 'tfsa' ? 'tfsaFirst' : input.withdrawalOrder?.[0] === 'nonReg' ? 'nonRegFirst' : 'meltdownPaced')
  const investmentProperties = input.investmentProperties ?? (input.investmentProperty ? [{ ...input.investmentProperty }] : [])
  const { withdrawalOrder: _wo, investmentProperty: _ip, ...rest } = input
  return { ...DEFAULT_INPUTS, ...rest, strategy, investmentProperties }
}
let storageReadOnlyReason: 'futureVersion' | 'corrupt' | 'migrationFailed' | null = null
export const getStorageReadOnlyReason = () => storageReadOnlyReason
export function downloadStoredPlan() {
  const original = localStorage.getItem('fire-inputs') ?? localStorage.getItem('fire-inputs:pre-v11-backup')
  if (original === null) return
  const url = URL.createObjectURL(new Blob([original], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'fire-plan-original.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
const planStorage: PersistStorage<Store> = {
  getItem(name) {
    const original = localStorage.getItem(name)
    if (original === null) return null
    try {
      const parsed = JSON.parse(original) as StorageValue<Store>
      if (!parsed || typeof parsed !== 'object' || !('state' in parsed) || typeof parsed.version !== 'number') throw new Error('Invalid persisted envelope')
      if (parsed.version > 11) { storageReadOnlyReason = 'futureVersion'; return null }
      const prior = parsed.state as Store
      const currentInputs = hydrateLegacyInputs(prior.inputs)
      assertLegacyInputs(currentInputs)
      const migratedCurrent = migratePersistedPlan({ inputs: currentInputs }, Math.min(parsed.version, 10), new Date().getFullYear())
      assertCanonicalPlan(migratedCurrent)
      if (prior.scenarioA !== null && prior.scenarioA !== undefined) {
        const scenarioInputs = hydrateLegacyInputs(prior.scenarioA)
        assertLegacyInputs(scenarioInputs)
        const migratedScenarioA = migratePersistedPlan({ inputs: scenarioInputs }, Math.min(parsed.version, 10), new Date().getFullYear())
        assertCanonicalPlan(migratedScenarioA)
      }
      if (parsed.version === 11) {
        if (prior.canonical != null) {
          prior.canonical = completeCanonicalFacts(prior.canonical, currentInputs)
          assertCanonicalPlan(prior.canonical)
        }
        if (prior.scenarioACanonical != null) {
          const scenarioInputs = hydrateLegacyInputs(prior.scenarioA)
          assertLegacyInputs(scenarioInputs)
          prior.scenarioACanonical = completeCanonicalFacts(prior.scenarioACanonical, scenarioInputs)
          assertCanonicalPlan(prior.scenarioACanonical)
        }
      }
      if (parsed.version < 11) {
        // The full envelope has been validated before any backup or upgraded write.
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

function reconcileLegacyInputs(state: Store, inputs: Inputs) {
  const canonical = refreshCanonicalFromLegacy(state.canonical, inputs)
  return {
    inputs: canonical.legacyProjection,
    canonical,
    inputRevision: state.inputRevision + 1,
    resultRevision: null,
  }
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
      planningIntent: structuredClone(DEFAULT_PLANNING_INTENT),
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
          const reconciled = reconcileLegacyInputs(s, inputs)
          const shared = reconcileDirectFields(s, patch, reconciled.inputs)
          return {
            ...reconciled,
            draftByField: shared.draftByField,
            questionAnswers: shared.questionAnswers ?? s.questionAnswers,
            answerMeta: (ownerChanged || householdChanged) && ownerAnswer
              ? { ...shared.answerMeta, 'lockedRetirement.owner': { ...ownerAnswer, status: 'unknown' as const, updatedAt: new Date().toISOString() } }
              : shared.answerMeta,
          }
        })
      },
      editSharedField: (field, raw, unit = 'canonical', origin = 'user') => {
        trackOnce('adjust_inputs')
        set((s) => editField(s, field, raw, unit, origin))
      },
      setAccountPresence: (account, present) => {
        trackOnce('adjust_inputs')
        set((s) => changeAccountPresence(s, account, present))
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
      setPlanningIntent: (patch) => set((s) => changeIntent(s, patch)),
      setGoalFromProfessional: (goal) => set((s) => changeIntent(s, {
        spendingPreference: goal === 'dieWithZero' ? 'exploreCeiling' : 'maintain',
        understandingAcknowledged: false,
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
          const inputs = {
            ...s.inputs,
            returns: { ...s.inputs.returns, [account]: blendedReturn(mix) },
            volatilities: {
              ...(s.inputs.volatilities ?? DEFAULT_INPUTS.volatilities!),
              [account]: blendedVolatility(mix),
            },
          }
          return {
            mixPresets: { ...s.mixPresets, [account]: preset },
            ...reconcileLegacyInputs(s, inputs),
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
          planningIntent: structuredClone(DEFAULT_PLANNING_INTENT),
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
          const canonical = migratePersistedPlan({ inputs: hydrateLegacyInputs(previous.inputs) }, version, new Date().getFullYear())
          const scenarioACanonical = previous.scenarioA ? migratePersistedPlan({ inputs: hydrateLegacyInputs(previous.scenarioA) }, version, new Date().getFullYear()) : null
          return {
            ...previous,
            inputs: canonical.legacyProjection,
            scenarioA: scenarioACanonical?.legacyProjection ?? null,
            canonical,
            scenarioACanonical,
            draftByField: {},
            entryMode: version < 7 ? 'professional' : previous.entryMode,
            activeStep: previous.activeStep ?? 1,
            visitedSteps: previous.visitedSteps ?? [1],
            activePageId: legacyPageByStep[(previous.activeStep ?? 1) - 1] ?? 'family.people',
            guidedView: previous.activeStep === 7 ? 'review' : 'questionnaire',
            questionAnswers: {},
            planningIntent: structuredClone(DEFAULT_PLANNING_INTENT),
            inputRevision: 0,
            resultRevision: null,
            answerMeta: legacyAnswerMeta(),
            scenarioAAnswerMeta: previous.scenarioA ? legacyAnswerMeta() : null,
          } as Store
        }
        if (version === 10) {
          const canonical = migratePersistedPlan({ inputs: hydrateLegacyInputs(previous.inputs) }, version, new Date().getFullYear())
          const scenarioACanonical = previous.scenarioA ? migratePersistedPlan({ inputs: hydrateLegacyInputs(previous.scenarioA) }, version, new Date().getFullYear()) : null
          return {
          ...previous,
          inputs: canonical.legacyProjection,
          scenarioA: scenarioACanonical?.legacyProjection ?? null,
          canonical,
          scenarioACanonical,
          draftByField: {},
          } as Store
        }
        return state as Store
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Store> & {
          inputs?: Partial<Inputs> & { withdrawalOrder?: string[] }
          scenarioA?: Inputs | null
        }
        const upgrade = (raw: LegacyInputs | null | undefined): Inputs | null => raw ? hydrateLegacyInputs(raw) : null
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
