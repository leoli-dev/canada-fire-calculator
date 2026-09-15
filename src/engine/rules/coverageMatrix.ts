/**
 * BE-38 B3: the per-jurisdiction credit coverage matrix.
 *
 * `publishedTaxCoverage` used to say only `{ jurisdiction, taxYear, coverage,
 * limitation }`, which tells a reader the *shape* of a pack, not what the
 * numbers on screen include. This module is the published, machine-checked
 * answer to "which credits and reductions are inside these numbers and which
 * are outside them", for every jurisdiction the app can price.
 *
 * `coverageMatrix.test.ts` enforces four properties: every supported
 * jurisdiction has an entry that lists the federal rows too; every
 * `implemented` row names a fixture that resolves to a pinned,
 * independently-sourced expectation and to the authority the row's own
 * `sourceURL` names; every `unsupported` row carries a concrete reason whose
 * absence is asserted against the engine; and every declaration — implemented
 * or unsupported, for every jurisdiction — is reconciled against what the
 * pricing code actually does, so a row cannot claim a credit is excluded while
 * `tax.ts` prices it (or the reverse). Nothing here claims a complete return —
 * the standing negative statement lives in {@link coverageCaveat} and travels
 * with the matrix so no summary can drop it.
 */

import { PLAN_TAX_YEAR } from '../planYear'

/** Every jurisdiction the app can price. A test ties it to the published packs. */
export const COVERAGE_JURISDICTIONS = [
  'ON', 'QC', 'BC', 'AB', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU',
] as const
export type CoverageJurisdiction = (typeof COVERAGE_JURISDICTIONS)[number]

/** What kind of rule a row describes, so a reader can tell a credit from a levy. */
export type CreditKind = 'credit' | 'surtax' | 'levy' | 'inclusion' | 'fee'
export type CreditScope = 'federal' | 'provincial'

/** A credit, reduction, surtax or levy the priced numbers do include. */
export interface ImplementedCreditCoverage {
  coverage: 'implemented'
  scope: CreditScope
  kind: CreditKind
  /** The pack field(s) or engine constant the value is read from. */
  ruleFields: string[]
  /** The published rule this row prices, stated as values where the row can. */
  implementedRule?: string
  /** The authority the figures were read from. */
  sourceURL: string
  additionalSourceURLs?: string[]
  /** `YYYY-MM-DD` the figures were last read against `sourceURL`. */
  verifiedAt: string
  /** Id of the registry entry that pins this row's figures. */
  evidenceFixture: string
  /** What this row specifically does not do. Never an invitation to read it as complete. */
  limitation?: string
}

/** A credit, reduction, surtax or levy the priced numbers do *not* include. */
export interface UnsupportedCreditCoverage {
  coverage: 'unsupported'
  scope: CreditScope
  kind: CreditKind
  /** What is not modelled, stated as a negation. */
  scopeStatement: string
  /** Why this build cannot price it. Concrete, not "not implemented yet". */
  reason: string
}

export type CreditCoverage = ImplementedCreditCoverage | UnsupportedCreditCoverage

export interface JurisdictionCoverageMatrix {
  jurisdiction: CoverageJurisdiction
  taxYear: number
  implemented: Record<string, ImplementedCreditCoverage>
  unsupported: Record<string, UnsupportedCreditCoverage>
}

export interface CoverageMatrixArtifact {
  /** The slice that published this matrix. */
  matrixVersion: string
  taxYear: number
  /** Carried with every rendering of the matrix; see `coverageCaveat`. */
  caveat: string
  jurisdictions: JurisdictionCoverageMatrix[]
}

/**
 * The one sentence that must accompany this matrix wherever it is shown. It is
 * the negation of "tax complete": the matrix exists because several credits and
 * every cash benefit sit outside the model.
 */
export const coverageCaveat =
  'This calculator models the federal and provincial income tax brackets, the basic personal amount ' +
  'and the named credits in this list only. It does not model the GST/HST credit, any provincial or ' +
  'territorial cash benefit, any low-income or refundable tax reduction, dividend tax credits, the ' +
  'Canada employment amount or the province-specific spouse worksheets, so no figure it produces is ' +
  'a complete tax return, a complete after-tax position, or a complete after-benefit position. Where a ' +
  'credit it does apply is a pinned rather than year-switched figure (the age and pension amounts, the ' +
  'spouse maxima, the Ontario surtax and health premium, probate fees, the capital-gains inclusion ' +
  'rate, the Quebec levies), an assumed future year carries that 2026 figure forward unchanged, and ' +
  'the row says so.'

const T4032 = (code: string) =>
  `https://www.canada.ca/content/dam/cra-arc/migration/cra-arc/tx/bsnss/tpcs/pyrll/t4032/2026/t4032-${code}-1-26e.pdf`
const TD1 = 'https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/td1/td1-26e.pdf'
const TD1_PROV = (code: string) =>
  `https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/td1${code}/td1${code}-26e.pdf`
const RQ_RATES = 'https://www.revenuquebec.ca/en/citizens/income-tax-return/completing-your-income-tax-return/income-tax-rates/'
const QC_PARAMS = 'https://cdn-contenu.quebec.ca/cdn-contenu/adm/min/finances/publications-adm/parametres/AUTFR_RegimeImpot2026.pdf'
const ITA_38 = 'https://laws-lois.justice.gc.ca/eng/acts/i-3.3/section-38.html'
const QC_ABATEMENT_ACT = 'https://laws-lois.justice.gc.ca/eng/acts/f-1.3/section-4.html'
const PROBATE = 'https://www.ontario.ca/laws/statute/90e22'
const AT = '2026-09-15'
const federal = (): Record<string, ImplementedCreditCoverage> => ({
  'federal-income-tax-brackets': {
    coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['federal.brackets'],
    sourceURL: T4032('mb'), additionalSourceURLs: [T4032('on')], verifiedAt: AT,
    evidenceFixture: 'federal-brackets-2026',
    limitation: 'Quebec applies its 16.5% abatement on top, which is its own row.',
  },
  'federal-basic-personal-amount': {
    coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['federal.bpa', 'federal.bpaMin'],
    sourceURL: TD1, additionalSourceURLs: [T4032('mb')], verifiedAt: AT,
    evidenceFixture: 'federal-bpa-and-phase-out-2026',
    limitation: 'The phase-out uses taxable income, not the net income the CRA worksheet uses.',
  },
  'federal-pension-income-amount': {
    coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['taxData.ts:FED_PENSION_AMOUNT'],
    sourceURL: TD1, verifiedAt: AT, evidenceFixture: 'federal-pension-amount-2026',
    limitation: 'Eligibility by income type is the caller\u2019s job; the amount is not year-switched.',
  },
  'federal-age-amount': {
    coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['taxData.ts:FED_AGE_AMOUNT'],
    sourceURL: TD1, verifiedAt: AT, evidenceFixture: 'federal-age-amount-2026',
    limitation: 'The income test uses taxable income rather than net income, and the amount is a pinned 2026 figure.',
  },
  'federal-spouse-amount': {
    coverage: 'implemented', scope: 'federal', kind: 'credit',
    ruleFields: ['spouseCredit2026.ts:federalSpouseAmount2026'],
    sourceURL: TD1, verifiedAt: AT, evidenceFixture: 'federal-spouse-amount-2026',
    limitation: 'Applied only when a spouse net income is supplied, and it draws on the same basic personal amount as the credit above.',
  },
  'capital-gains-inclusion-rate': {
    coverage: 'implemented', scope: 'federal', kind: 'inclusion',
    ruleFields: ['taxData.ts:CAPITAL_GAINS_INCLUSION'],
    implementedRule: '50% of a realized capital gain enters taxable income.',
    sourceURL: ITA_38, verifiedAt: AT, evidenceFixture: 'capital-gains-inclusion-2026',
    limitation: 'The 66.67% rate proposed in 2024 was cancelled and never took effect; the rate is statutory and not year-switched.',
  },
  'probate-and-estate-fees': {
    coverage: 'implemented', scope: 'provincial', kind: 'fee', ruleFields: ['taxData.ts:PROBATE_RATES'],
    sourceURL: PROBATE, verifiedAt: AT, evidenceFixture: 'probate-fees-2026',
    limitation: 'Pinned 2026 figures; provinces with tiered rates are simplified to one flat amount plus rate. The cited statute is Ontario\u2019s; each other jurisdiction\u2019s rate is pinned from its own administration-of-estates statute, not from this URL.',
  },
})

/**
 * The rows every non-Quebec jurisdiction prices from its own T4032 chart and TD1.
 * The fixture id carries the jurisdiction because the authority does: every
 * province's age, pension and spouse line comes from its own TD1, so a shared
 * fixture id could (and did) point a province at another province's form.
 */
const provincial = (code: CoverageJurisdiction): Record<string, ImplementedCreditCoverage> => ({
  'provincial-income-tax-brackets': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.brackets'], implementedRule: `The published 2026 ${code} ladder.`,
    sourceURL: T4032(code.toLowerCase()), verifiedAt: AT, evidenceFixture: `${code.toLowerCase()}-provincial-brackets-2026`,
  },
  'provincial-basic-personal-amount': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.bpa'],
    sourceURL: T4032(code.toLowerCase()), verifiedAt: AT, evidenceFixture: `${code.toLowerCase()}-provincial-bpa-2026`,
    limitation: 'An assumed future year indexes it from the pack\u2019s own policy; the 2026 value is the published one.',
  },
  'provincial-pension-income-amount': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['taxData.ts:PROV_AGE_PENSION.pension'],
    sourceURL: TD1_PROV(code.toLowerCase()), verifiedAt: AT, evidenceFixture: `${code.toLowerCase()}-provincial-pension-amount-2026`,
    limitation: 'Not year-switched, and applied with no income test in this model.',
  },
  'provincial-age-amount': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit',
    ruleFields: ['taxData.ts:PROV_AGE_PENSION.ageMax', 'taxData.ts:PROV_AGE_PENSION.ageThreshold',
      'taxData.ts:PROV_AGE_PENSION.ageRate', 'taxData.ts:PROV_AGE_PENSION.seniorSupplement'],
    sourceURL: TD1_PROV(code.toLowerCase()), verifiedAt: AT, evidenceFixture: `${code.toLowerCase()}-provincial-age-amount-2026`,
    limitation: 'Pinned 2026 figures, and the income test uses taxable income rather than the net income the TD1 worksheet uses.',
  },
  'provincial-spouse-amount': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit',
    ruleFields: ['spouseCredit2026.ts:provincialSpouseAmount2026'],
    sourceURL: TD1_PROV(code.toLowerCase()), verifiedAt: AT, evidenceFixture: `${code.toLowerCase()}-provincial-spouse-amount-2026`,
    limitation:
      'The amount is `min(max, threshold \u2212 spouse net income)`, which is algebraically identical to the TD1 ' +
      'worksheet because every such form publishes `max + low = threshold`; the real gap is the spouse net-income ' +
      'base, and the maxima and thresholds are pinned 2026 figures.',
  },
})

/** Rows true in every province except Quebec, whose return is its own. */
const commonUnsupported = (): Record<string, UnsupportedCreditCoverage> => ({
  'provincial-low-income-reduction': {
    coverage: 'unsupported', scope: 'provincial', kind: 'credit',
    scopeStatement: 'The provincial low-income tax reduction and any related refundable credit are not applied, so a low-income result in this province overstates tax.',
    reason: 'Every reduction has its own published worksheet with its own income base and phase-out; none is implemented, so none is approximated. Scope for BE-38 B4.',
  },
  'provincial-dividend-tax-credits': {
    coverage: 'unsupported', scope: 'provincial', kind: 'credit',
    scopeStatement: 'Provincial and federal dividend tax credits are not applied to any dividend income.',
    reason: 'The engine prices interest, pension and capital-gain income; gross-up and dividend-credit mechanics are modelled on neither side.',
  },
  'provincial-other-non-refundable-credits': {
    coverage: 'unsupported', scope: 'provincial', kind: 'credit',
    scopeStatement: 'Caregiver, disability, medical-expense, tuition, charitable-donation and similar non-refundable credits are not applied.',
    reason: 'Only the credits this matrix names are applied; every other non-refundable credit on the jurisdiction\u2019s TD1 form is absent.',
  },
  'provincial-refundable-benefits': {
    coverage: 'unsupported', scope: 'provincial', kind: 'credit',
    scopeStatement: 'The GST/HST credit and provincial cash benefits and refundable credits (rent or property-tax credits, carbon rebates, sales-tax credits and similar) are not modelled and are never added to a result.',
    reason: 'No provincial cash-benefit program is implemented anywhere in the engine, so no result is a complete after-benefit position.',
  },
  'provincial-age-pension-amounts': {
    coverage: 'unsupported', scope: 'provincial', kind: 'credit',
    scopeStatement: 'The provincial age amount, pension income amount and any senior supplement are not applied beyond the flat provincial rows this matrix names.',
    reason: 'taxData.ts pins 2026 provincial age and pension amounts with no tax-year selection, and their income tests use taxable income rather than net income. Scope for BE-38 B4.',
  },
  'canada-employment-amount': {
    coverage: 'unsupported', scope: 'federal', kind: 'credit',
    scopeStatement: 'The Canada employment amount is not applied, so a result that includes employment income omits that credit.',
    reason: 'The engine prices interest, pension and capital-gain income and models no employment-income credit; the caveat names the same gap. Scope for BE-38 B4.',
  },
})

/** Rows only one or a few jurisdictions have, kept together for review. */
const extras: Partial<Record<CoverageJurisdiction, {
  implemented?: Record<string, ImplementedCreditCoverage>
  unsupported?: Record<string, UnsupportedCreditCoverage>
}>> = {
  ON: {
    implemented: {
      'ontario-surtax': {
        coverage: 'implemented', scope: 'provincial', kind: 'surtax', ruleFields: ['taxData.ts:ON_SURTAX'],
        sourceURL: T4032('on'), verifiedAt: AT, evidenceFixture: 'ontario-surtax-2026',
        limitation: 'The two thresholds are pinned 2026 figures, not year-switched.',
      },
      'ontario-health-premium': {
        coverage: 'implemented', scope: 'provincial', kind: 'levy', ruleFields: ['taxData.ts:ON_HEALTH_PREMIUM'],
        sourceURL: T4032('on'), verifiedAt: AT, evidenceFixture: 'ontario-health-premium-2026',
        limitation: 'The segments are pinned 2026 figures, not year-switched.',
      },
    },
    unsupported: {
      'ontario-tax-reduction': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'Ontario\u2019s tax reduction ($300 basic personal amount, $575 per eligible dependant) is not applied.',
        reason: 'The reduction is a published worksheet (twice the personal amounts minus provincial tax payable, floored at zero) that this build does not compute. Scope for BE-38 B4.',
      },
      'ontario-refundable-benefits': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'The Ontario Trillium Benefit (energy and property tax credit, sales tax credit, northern Ontario energy credit) and the Ontario child benefit are not applied.',
        reason: 'No Ontario refundable benefit is modelled anywhere in the engine.',
      },
    },
  },
  QC: {
    implemented: {
      'quebec-income-tax-brackets': {
        coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.brackets'],
        sourceURL: RQ_RATES, additionalSourceURLs: [QC_PARAMS], verifiedAt: AT, evidenceFixture: 'quebec-brackets-2026',
      },
      'quebec-basic-personal-amount': {
        coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.bpa'],
        sourceURL: RQ_RATES, additionalSourceURLs: [QC_PARAMS], verifiedAt: AT, evidenceFixture: 'quebec-bpa-2026',
      },
      'quebec-federal-abatement': {
        coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['taxData.ts:QC_ABATEMENT'],
        sourceURL: RQ_RATES, additionalSourceURLs: [QC_ABATEMENT_ACT], verifiedAt: AT, evidenceFixture: 'quebec-abatement-2026',
        limitation: 'A pinned statutory share, not selected by tax year.',
      },
      // `tax.ts` prices both of these for Quebec: the combined age +
      // retirement-income amount, applied per person on an assumed 50/50
      // income split. The review found the matrix declaring them unsupported
      // while the engine subtracted them, so the UI told Quebec seniors that a
      // credit they receive was excluded. The family test is the real gap and
      // is named as the rows' limitation.
      'provincial-age-amount': {
        coverage: 'implemented', scope: 'provincial', kind: 'credit',
        ruleFields: ['taxData.ts:PROV_AGE_PENSION.ageMax', 'taxData.ts:PROV_AGE_PENSION.ageThreshold',
          'taxData.ts:PROV_AGE_PENSION.ageRate'],
        sourceURL: QC_PARAMS, verifiedAt: AT, evidenceFixture: 'qc-provincial-age-amount-2026',
        limitation: 'Pinned 2026 figures; applied on taxable income per person rather than through Schedule B\u2019s family-income test, which this build does not compute.',
      },
      'provincial-pension-income-amount': {
        coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['taxData.ts:PROV_AGE_PENSION.pension'],
        sourceURL: QC_PARAMS, verifiedAt: AT, evidenceFixture: 'qc-provincial-pension-amount-2026',
        limitation: 'Pinned 2026 figures; the retirement-income amount is priced only inside the 65+ combined credit and shares the same per-person Schedule B approximation as the age amount.',
      },
      'quebec-fss-contribution': {
        coverage: 'implemented', scope: 'provincial', kind: 'levy', ruleFields: ['taxData.ts:QC_FSS'],
        sourceURL: QC_PARAMS, verifiedAt: AT, evidenceFixture: 'quebec-fss-2026',
        limitation: 'The legacy preview applies it to taxable income; the person-owned Quebec path uses the Schedule F base.',
      },
      'quebec-ramq-premium': {
        coverage: 'implemented', scope: 'provincial', kind: 'levy', ruleFields: ['taxData.ts:QC_RAMQ'],
        sourceURL: QC_PARAMS, verifiedAt: AT, evidenceFixture: 'quebec-ramq-2026',
        limitation: 'A legacy preview approximation; Revenu Quebec has not published the 2026 tax-year Schedule K, and the person-owned path gates public coverage instead of pricing it.',
      },
    },
    unsupported: {
      'quebec-work-premium-and-refundable-credits': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'The Quebec work premium, the solidarity tax credit and the refundable medical-expense credit are not applied.',
        reason: 'No Quebec refundable credit is modelled anywhere in the engine.',
      },
      'quebec-specific-deductions': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'Quebec-specific deductions such as the deduction for retirement income and the deduction for workers are not applied.',
        reason: 'Only the amounts this matrix names are modelled; Quebec\u2019s deduction schedule is absent.',
      },
      'provincial-spouse-amount': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'Quebec\u2019s spouse or common-law-partner amount is not applied.',
        reason: 'Quebec prices a spouse through its own family framework rather than a per-person amount, and this build does not compute that framework.',
      },
    },
  },
  MB: {
    implemented: {
      'manitoba-bpa-phase-out': {
        coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.bpaPhaseOut'],
        sourceURL: T4032('mb'), verifiedAt: AT, evidenceFixture: 'manitoba-bpa-phase-out-2026',
        limitation: 'The phase-out bounds are not part of the T4032 chart and are a pinned figure.',
      },
    },
  },
  AB: {
    unsupported: {
      'alberta-supplemental-tax-credit': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'The Alberta supplemental tax credit for low-income taxpayers is not applied.',
        reason: 'The credit appears in the T4032-AB worked example with its own income test and this build does not compute it, so a low-income Alberta result overstates tax. Scope for BE-38 B4.',
      },
    },
  },
  BC: {
    unsupported: {
      'british-columbia-tax-reduction': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'The British Columbia tax reduction ($690 for 2026, withdrawn at 3.56% of income above $25,570) is not applied.',
        reason: 'Budget 2026 paused the reduction at the same time as it raised the bottom bracket rate, and this build prices the raised ladder without also applying the reduction. Scope for BE-38 B4.',
      },
    },
  },
  YT: {
    implemented: {
      // `tax.ts` phases Yukon's basic personal amount down with the federal
      // enhanced-BPA bounds for every jurisdiction that carries
      // `provincial.bpaPhaseOut`; until this row existed only Manitoba's
      // phase-out was declared, so the matrix under-reported what Yukon prices.
      'yukon-bpa-phase-out': {
        coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.bpaPhaseOut'],
        sourceURL: T4032('yt'), verifiedAt: AT, evidenceFixture: 'yukon-bpa-phase-out-2026',
        limitation: 'Mirrors the federal enhanced-BPA phase-down and is a pinned figure rather than a chart line.',
      },
    },
    unsupported: {
      'yukon-cost-of-living-credits': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'Yukon cost-of-living and northern-resident credits are not applied.',
        reason: 'No territorial refundable credit is modelled; the projection has no residency input.',
      },
    },
  },
  NT: {
    unsupported: {
      'territorial-cost-of-living-allowance': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'The Northwest Territories cost-of-living allowance is not applied.',
        reason: 'No territorial refundable credit is modelled; the projection has no residency input.',
      },
    },
  },
  NU: {
    unsupported: {
      'territorial-cost-of-living-allowance': {
        coverage: 'unsupported', scope: 'provincial', kind: 'credit',
        scopeStatement: 'The Nunavut cost-of-living allowance is not applied.',
        reason: 'No territorial refundable credit is modelled; the projection has no residency input.',
      },
    },
  },
}

function build(): CoverageMatrixArtifact {
  const fed = federal()
  const common = commonUnsupported()
  const jurisdictions = COVERAGE_JURISDICTIONS.map((jurisdiction) => {
    const implemented: Record<string, ImplementedCreditCoverage> = { ...fed }
    const unsupported: Record<string, UnsupportedCreditCoverage> = { ...common }
    // Quebec pays the federal ladder too (with its own abatement row on top),
    // so the federal bracket row is no longer dropped for QC: dropping it hid
    // a priced row from the province that most needs the disclosure.
    if (jurisdiction !== 'QC') Object.assign(implemented, provincial(jurisdiction))
    Object.assign(implemented, extras[jurisdiction]?.implemented ?? {})
    Object.assign(unsupported, extras[jurisdiction]?.unsupported ?? {})
    return {
      jurisdiction,
      taxYear: PLAN_TAX_YEAR,
      implemented: Object.fromEntries(Object.entries(implemented).sort(([a], [b]) => a.localeCompare(b))),
      unsupported: Object.fromEntries(Object.entries(unsupported).sort(([a], [b]) => a.localeCompare(b))),
    }
  })
  return { matrixVersion: 'BE-38-B3', taxYear: PLAN_TAX_YEAR, caveat: coverageCaveat, jurisdictions }
}

export const coverageMatrix: CoverageMatrixArtifact = build()

/** The matrix row for one jurisdiction; throws rather than returning a default. */
export function coverageFor(jurisdiction: string): JurisdictionCoverageMatrix {
  const row = coverageMatrix.jurisdictions.find(entry => entry.jurisdiction === jurisdiction)
  if (!row) throw new Error(`no coverage matrix entry for jurisdiction "${jurisdiction}"`)
  return row
}

/** The jurisdiction summary, with the caveat attached so it cannot be dropped. */
export function coverageSummary(jurisdiction: string): {
  jurisdiction: string; taxYear: number; implemented: string[]; unsupported: string[]; caveat: string
} {
  const row = coverageFor(jurisdiction)
  return {
    jurisdiction: row.jurisdiction, taxYear: row.taxYear,
    implemented: Object.keys(row.implemented).sort(),
    unsupported: Object.keys(row.unsupported).sort(),
    caveat: coverageMatrix.caveat,
  }
}

/** Every fixture id the matrix promises evidence for, de-duplicated. */
export function evidenceFixtureIds(): string[] {
  const ids = new Set<string>()
  for (const row of coverageMatrix.jurisdictions)
    for (const credit of Object.values(row.implemented)) ids.add(credit.evidenceFixture)
  return [...ids].sort()
}

/** The jurisdictions the matrix covers. */
export function matrixJurisdictions(): string[] {
  return coverageMatrix.jurisdictions.map(row => row.jurisdiction)
}
