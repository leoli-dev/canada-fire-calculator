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
 * `implemented` row names a registered fixture whose URL is one of the row's
 * own URLs, and for every pack field the row prices the row's *rendered*
 * `sourceURL` is exactly the `fieldSources` entry the pack records for that
 * field (every additional pack source must also be among the row's URLs), so
 * the document a reader is shown and the document the pack says it read that
 * field from are the same URL; every `unsupported` row carries a concrete
 * reason whose absence is asserted against the engine; and every declaration —
 * implemented or unsupported, for every jurisdiction — is reconciled against
 * what the pricing code actually does, so a row cannot claim a credit is
 * excluded while `tax.ts` prices it (or the reverse). Two further checks keep a
 * citation honest: a row marked `qualifiedSource` — the cited document does not
 * carry one of the priced figures — must name a `limitationId`, which the panel
 * renders next to the link; and no row may render a URL in
 * {@link BLOCKED_SOURCES}, which records the authorities that answer a scripted
 * reader with a bot gate. The suite never fetches a URL: reachability and
 * content are checked by hand and dated in `verifiedAt`, and
 * {@link BLOCKED_SOURCES} records the citations the suite refuses to render.
 *
 * BE-38 B3 review (round 4, B1/B2): four rounds each found an artifact
 * asserting a citation↔figure correspondence the cited document did not
 * support, because nothing here separates "a human opened this and checked the
 * figures" from "this URL was reached". The matrix now states which case each
 * authority is in. {@link CONTENT_VERIFIED_AUTHORITIES} is the registry of
 * authorities a person read and checked against named figures on a named date;
 * every row's authorities are rendered as either content-checked (with that
 * date and those figures) or *listed only — content not checked*. Nothing that
 * a reader can see claims a document carries a priced figure unless the
 * authority is in that registry, so the claim text now says only what the suite
 * enforces. {@link BLOCKED_SOURCES} is likewise the registry of authorities a
 * scripted reader cannot reach, and a row may cite one only with a rendered
 * qualification that names the gate in every language.
 * Nothing here claims a complete return — the standing negative statement lives
 * in {@link coverageCaveat} and travels with the matrix so no summary can drop it.
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
  /**
   * The URL a reader is sent to first, and the document the row's figures are
   * *claimed* to come from. Whether that claim has been checked is stated by
   * {@link CONTENT_VERIFIED_AUTHORITIES}, never assumed: unless the authority is
   * in that registry, the panel renders it as *listed only — content not
   * checked*, and where `qualifiedSource` is set at least one priced figure is
   * known not to be printed here — it is an approximation derived from another
   * table, or a rate carried by a page linked as an additional source — and the
   * row's rendered `limitation` says which figure and where it is printed.
   */
  sourceURL: string
  additionalSourceURLs?: string[]
  /** `YYYY-MM-DD` the figures were last read against `sourceURL`. */
  verifiedAt: string
  /** Id of the registry entry that pins this row's figures. */
  evidenceFixture: string
  /**
   * True when *every* authority this row lists — `sourceURL` and each
   * `additionalSourceURLs` entry — is in {@link CONTENT_VERIFIED_AUTHORITIES}
   * with a `verifiedAt` matching that registry's `checkedOn`. Such a row is the
   * only one the panel describes as content-checked; every other row is
   * rendered as merely cited. Set only when the whole set is verified, so the
   * flag itself cannot overstate one link in the row.
   */
  contentChecked?: boolean
  /**
   * Id of the catalogue string (`coverageLimitation.<id>`) stating what this row
   * specifically does not do. The panel renders it next to the row's link, so a
   * declared limit cannot stay invisible. Never an invitation to read the row as
   * complete.
   */
  limitationId?: string
  /**
   * True when `sourceURL` does not carry at least one of the priced figures —
   * because it is an indexed approximation, a derived value, or a figure the
   * cited page prints only behind a bot gate or not at all. Such a row must
   * carry a `limitationId`, so a citation that does not settle the figure is
   * never shown unqualified.
   */
  qualifiedSource?: boolean
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
  'Canada employment amount or the net-income base the province-specific spouse-credit worksheets use ' +
  '(the spouse rows price the published maxima and thresholds, not that base), so no figure it produces ' +
  'is a complete tax return, a complete after-tax position, or a complete after-benefit position. Where a ' +
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
/** The editions whose ladders the pack actually prices where they differ from
 * the January chart. Each row must cite the edition carrying its figure; the
 * superseded edition travels as an additional source, not as the authority. */
const PE_2026_JULY = 'https://www.canada.ca/content/dam/cra-arc/migration/cra-arc/tx/bsnss/tpcs/pyrll/t4032/2026/t4032-pe-7-26e.pdf'
const BC_2026_JULY = 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032bc-july/t4032bc-july-general-information.html'
const NL_2026_JULY = 'https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4008-payroll-deductions-supplementary-tables/t4008nl-july/t4008nl-july-general-information.html'
const CFFP_GUIDE = 'https://cffp.recherche.usherbrooke.ca/wp-content/uploads/2024/03/cr_2026_04_guide_mesures_fiscales_vf.pdf'
const PE_2026_GOV = 'https://www.princeedwardisland.ca/en/information/finance-and-affordability/provincial-personal-income-tax'
/**
 * BE-38 B4: the two authorities that carry the territories' *own* probate fees,
 * read on the page themselves and recorded in
 * {@link CONTENT_VERIFIED_AUTHORITIES} below. NT's is the Department of Justice
 * office consolidation of the Court Services Fees Regulations (R-120-93 as
 * amended to R-071-2017), whose Part 2 item 1(e) prints $435 where the value
 * exceeds $250,000. NU's is the official consolidation of the Court Fees
 * Regulations (C.R.Nu. R-042-2021), whose Schedule C item 5 prints $425 on the
 * same boundary. NU's is recorded in {@link BLOCKED_SOURCES} as well: it
 * answers a scripted reader — curl, an API request context and a real headless
 * Chromium navigation — with Cloudflare's challenge page, so the row must name
 * the gate in every language. NT's is reachable.
 */
const NT_COURT_FEES =
  'https://www.justice.gov.nt.ca/en/files/legislation/judicature/judicature.r10.pdf'
const NU_COURT_FEES =
  'https://www.nunavutlegislation.ca/en/file-download/download/public/7022'
/**
 * The Yukon authority that carries the territory's own probate fee — the
 * document that replaced the unconditional $140 this build used to charge. The
 * Supreme Court Rules, Appendix C, Schedule 1 (Fees payable to Territorial
 * Treasurer), item 11, is the tariff the *Estate Administration Act* s. 114
 * authorises, and it prints both priced values this build charges: "For every
 * grant or ancillary grant of probate and administration ... No fee is payable
 * to obtain a grant of probate and administration where a person dies leaving
 * an estate not exceeding $25,000 in value ... 140". Served by the Yukon courts
 * (reachable, HTTP 200); the Act consolidation at `laws.yukon.ca` answers a
 * scripted reader with a Cloudflare challenge, so the reachable court copy is
 * the citation.
 */
const YT_COURT_RULES =
  'https://www.yukoncourts.ca/sites/default/files/2023-08/rules_combined.pdf'
/**
 * BE-38 B4: the two British Columbia instruments that between them carry every
 * figure the BC probate row prices, read on the pages themselves.
 *   - `BC_PROBATE_ACT` is the *Probate Fee Act*, SBC 1999, c. 4, s. 2 (current
 *     to 2026-09-08). This row used to cite the TaxTips.ca table, which states
 *     the same rule in its own words but is not the Act. Its s. 2(2)(b) is the
 *     exempt band ("No fee is payable under this Act ... if the value of the
 *     estate does not exceed $25 000"), s. 2(3)(a) is the $25,000–$50,000 band
 *     ($6 for every $1 000 or part of $1 000) and s. 2(3)(b) the tier above
 *     ($14 for every $1 000 or part of $1 000), so the ladder the engine prices
 *     is the Act's own.
 *   - `BC_COURT_FEES` is the Supreme Court Civil Rules, Appendix C, Schedule 1,
 *     item 1 (as amended to B.C. Reg. 152/2025). It charges the $200 filing fee
 *     the engine's `surcharge` adds — "No fee is payable under this item to file
 *     for and obtain a grant of probate or administration if a person dies
 *     leaving an estate that does not exceed $25 000 in value" against a $200
 *     fee, so the same $25,000 boundary turns it on. The Act itself charges no
 *     filing fee; pricing the Act's ladder alone would understate what a BC
 *     executor pays by that $200.
 * Both are served by the BC King's Printer and answer a plain HTTP 200; both
 * are recorded in {@link CONTENT_VERIFIED_AUTHORITIES} for the figures read on
 * them.
 */
const BC_PROBATE_ACT =
  'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/99004_01'
const BC_COURT_FEES =
  'https://www.bclaws.gov.bc.ca/civix/document/id/complete/statreg/168_2009_06'
/**
 * BE-38 B4 (the AB/NS/PE defect): the three instruments carrying the band
 * ladders these rows used to approximate with one top-tier flat amount, read on
 * the documents themselves — AB's Surrogate Rules, Alta. Reg. 130/95, Sch. 2
 * item 1(1) (Rule 44 authorises the clerk's Schedule 2 fees); NS's Probate Act,
 * R.S.N.S. 1989, c. 359, s. 87(2); PEI's Probate Act, R.S.P.E.I. 1974, c. P-21,
 * s. 119.1(4). Each band's own wording is in
 * {@link CONTENT_VERIFIED_AUTHORITIES}. All three were probed live and answer
 * HTTP 200 — Nova Scotia's consolidation is served as `probate.pdf`; the
 * `probate.htm` sibling the first revision of this slice cited answers HTTP 404
 * (6/6 probes, with and without a browser User-Agent), so it may not be the
 * rendered authority for a figure. PEI's *landing page* is the Radware-gated
 * {@link BLOCKED_SOURCES} entry; the PDF is not gated, so it is cited with no
 * gate note.
 */
const AB_SURROGATE_RULES =
  'https://kings-printer.alberta.ca/documents/Regs/1995_130.pdf'
const NS_PROBATE_ACT =
  'https://nslegislature.ca/sites/default/files/legc/statutes/probate.pdf'
const PE_PROBATE_ACT =
  'https://www.princeedwardisland.ca/sites/default/files/legislation/p-21-probate_act.pdf'
/**
 * One authority a scripted reader cannot reach, with the gate that stops it and
 * the token every language's rendered qualification must contain. The marker is
 * not necessarily a status code: it is whatever the gate actually is, so a gate
 * that answers 200 can be recorded too.
 */
export interface BlockedSource {
  /** What stops a real reader, as observed. */
  reason: string
  /** `YYYY-MM-DD` the gate was last observed. */
  observedAt: string
  /**
   * The literal that must appear in `coverageLimitation.<id>` in **every**
   * language for a row that cites this URL. It is the same in all three
   * catalogues, so the suite can assert the disclosure is really rendered
   * rather than trusting a translator to have kept it.
   */
  gateMarker: string
}
/**
 * The authorities the suite refuses to render unqualified. Revenu Québec
 * answers a scripted client — and, per the B3 review, a real Chromium
 * navigation from the review network — with HTTP 403 and a CAPTCHA, so a row
 * that cites this page for its only rendered authority hands the reader a dead
 * link. A row may still list one as an *additional* source, but only if the
 * row's rendered `limitation` names the gate in every language and the link
 * itself carries a rendered gate marker.
 *
 * BE-38 B3 review (round 4, B2): Prince Edward Island's own page is the second
 * entry. It answers **200** to `curl` and to an `APIRequestContext` — a
 * status-code check cannot see it — and only a real Chromium navigation reveals
 * the Radware CAPTCHA. That is why this registry, and not an HTTP status sweep,
 * is what the guard keys off; the entry is recorded from a real navigation.
 */
export const BLOCKED_SOURCES: Record<string, BlockedSource> = {
  [RQ_RATES]: {
    reason: 'HTTP 403 with a CAPTCHA to curl, to an API request context and to a real Chromium navigation.',
    observedAt: '2026-09-16',
    gateMarker: '403',
  },
  [PE_2026_GOV]: {
    reason: 'HTTP 200 to curl and to an API request context, but a real Chromium navigation is redirected to '
      + 'validate.perfdrive.com and served the Radware CAPTCHA page, so a reader cannot see the page from this link.',
    observedAt: '2026-09-17',
    gateMarker: 'CAPTCHA',
  },
  // BE-38 B4 follow-up: Nunavut's own Court Fees Regulations were cited without
  // this entry, so the row rendered as content-checked over a link a scripted
  // reader cannot open. Observed on a real headless Chromium navigation:
  // Cloudflare's "Just a moment..." challenge, HTTP 403, and the same for an
  // `APIRequestContext`. The gate is User-Agent-sensitive: `curl` with its
  // *default* UA gets 200 and the genuine 221 KB PDF, while an empty UA and a
  // Chrome UA both get 403 — so a bare "403 to curl" would be a false record,
  // and the entry keys off the requests that are actually refused. The
  // instrument remains the authority for the priced ladder — a person can open
  // it in an ordinary browser session — but the row may only cite it with a
  // rendered qualification naming this gate.
  [NU_COURT_FEES]: {
    reason: 'HTTP 403 and the Cloudflare "Just a moment..." challenge to an API request context and to a real '
      + 'headless Chromium navigation; curl is refused (403) with an empty UA and with a Chrome UA, though its '
      + 'default UA receives the PDF, so a scripted reader cannot rely on this link.',
    observedAt: '2026-09-15',
    gateMarker: '403',
  },
}
/**
 * BE-38 B3 review (round 4, B1/B2): the authorities a person has actually
 * opened and read against the named figures — the only citations about which
 * this artifact claims correspondence between a document and a figure. The set
 * is deliberately small: adding a URL here is a claim a reader can reproduce,
 * and the suite refuses a `contentChecked` row whose authority is not recorded
 * here with the same date.
 */
export interface ContentVerifiedAuthority {
  /** `YYYY-MM-DD` the figures were last read on the page itself. */
  checkedOn: string
  /** The figures found on that page, as printed. */
  checkedFigures: string[]
}
/**
 * The two TaxTips.ca tables the NT and NU probate rows carry as their additional
 * source, and the Yukon table the YT row carries the same way. A row marked
 * `contentChecked` may not contain an unverified authority, so each is recorded
 * for the figures read on it rather than left to inherit the primary's claim.
 */
const TAXTIPS_PROBATE_URL = (code: string) =>
  `https://www.taxtips.ca/willsandestates/probatefees/${code}.htm`
/** BE-38 B4's date: the NT and NU regulations above and their two TaxTips.ca
 * tables were opened and read against the recorded figures. */
const CHECKED_B4 = '2026-09-15'
/** The date the Yukon defect slice read its primary authority: the Supreme Court
 * Rules' own fee schedule and the TaxTips.ca table the row carried before. */
const CHECKED_B4_YT = '2026-09-15'
/** BE-38 B4 (BC): the date the two BC instruments above were opened and read
 * against the recorded figures — the Probate Fee Act's band ladder, the Supreme
 * Court Civil Rules' $200 filing fee, and the TaxTips.ca table the row carried
 * before. */
const CHECKED_B4_BC = '2026-09-17'
/** BE-38 B4 (AB/NS/PE): the date these three band-ladder instruments were
 * opened and read against the figures each row now prices. */
const CHECKED_B4_LADDERS = '2026-09-17'
export const CONTENT_VERIFIED_AUTHORITIES: Record<string, ContentVerifiedAuthority> = {
  'https://www.ontario.ca/laws/statute/98e34': {
    checkedOn: '2026-09-17',
    checkedFigures: ['$15 for each $1,000', '$50,000', 'exempt below $50,000'],
  },
  'https://www.taxtips.ca/willsandestates/probatefees/on.htm': {
    checkedOn: '2026-09-17',
    checkedFigures: ['1.5% of the estate value over $50,000', '$50,000'],
  },
  [PE_2026_JULY]: {
    checkedOn: '2026-09-17',
    checkedFigures: ['106,890', '142,520', '200,000', '17.62%', '19.00%', '20%'],
  },
  [BC_2026_JULY]: {
    checkedOn: '2026-09-17',
    checkedFigures: ['5.60% (up from 5.06%)', '50,363', '100,728'],
  },
  [NL_2026_JULY]: {
    checkedOn: '2026-09-17',
    checkedFigures: ['13,094 (up from 11,188)'],
  },
  [CFFP_GUIDE]: {
    checkedOn: '2026-09-17',
    checkedFigures: ['5 000 band at 7,84 % / 11,76 %', '755 maximum', '19 890 threshold',
      'age 3 986', 'retirement 3 541', 'reduction threshold 42 955', '18,75 %', '54 345 / 108 680 / 132 245', '14 / 19 / 24 / 25,75 %'],
  },
  // BE-38 B4 review B1: the whole ladder each regulation prints, band by band
  // with its own boundary wording, so a reader can see that the priced value is
  // the document's and the suite can hold the two equal (see the ladder test).
  [NT_COURT_FEES]: {
    checkedOn: CHECKED_B4,
    checkedFigures: [
      '$10,000 or under', '$30',
      'more than $10,000 but not more than $25,000', '$110',
      'more than $25,000 but not more than $125,000', '$215',
      'more than $125,000 but not more than $250,000', '$325',
      'more than $250,000', '$435',
    ],
  },
  [NU_COURT_FEES]: {
    checkedOn: CHECKED_B4,
    checkedFigures: [
      '$10,000 or under', '$30',
      'More than $10,000 but not more than $25,000', '$110',
      'More than $25,000 but not more than $125,000', '$215',
      'More than $125,000 but not more than $250,000', '$325',
      'More than $250,000', '$425',
    ],
  },
  // The two TaxTips.ca territory tables the NT/NU probate rows carry as their
  // additional source. A row marked `contentChecked` may not contain an
  // unverified authority, so these are recorded for the figures read on them
  // rather than left to inherit the primary regulation's claim.
  [TAXTIPS_PROBATE_URL('nt')]: {
    checkedOn: CHECKED_B4,
    checkedFigures: ['$30', '$110', '$215', '$325', '$435', 'over $250,000'],
  },
  [TAXTIPS_PROBATE_URL('nu')]: {
    checkedOn: CHECKED_B4,
    checkedFigures: ['$30', '$110', '$215', '$325', '$425', 'More than $250,000'],
  },
  // BE-38 B4 follow-up (YT): the authority the row now cites, with both priced
  // values and the exemption boundary as item 11 prints them. `$0` and `$140`
  // are the only fee figures; the boundary phrase is recorded so the equality
  // test can hold the citation to the ladder the engine prices.
  [YT_COURT_RULES]: {
    checkedOn: CHECKED_B4_YT,
    checkedFigures: [
      'not exceeding $25,000 in value', '$0',
      '$140', 'every grant or ancillary grant of probate and administration',
    ],
  },
  // Yukon's TaxTips.ca table stays as the row's additional source — it states
  // the same rule in its own words — so a `contentChecked` row has no
  // unchecked link in it.
  [TAXTIPS_PROBATE_URL('yt')]: {
    checkedOn: CHECKED_B4_YT,
    checkedFigures: ['worth more than $25,000', '$140', 'not greater than $25,000'],
  },
  // BE-38 B4 (BC): the whole ladder, band by band, in the Act's own wording and
  // with its own boundary phrases, so the equality test can hold the citation to
  // the ladder the engine prices rather than to a summary of it. The Act prints
  // exactly these figures: no fee at or below $25,000, $6 per $1,000 (or part)
  // from there to $50,000, and $14 per $1,000 (or part) above.
  [BC_PROBATE_ACT]: {
    checkedOn: CHECKED_B4_BC,
    checkedFigures: [
      'does not exceed $25 000', '$0',
      '$25 000 but is not more than $50 000', '$6 for every $1 000 or part of $1 000',
      '$50 000', '$14 for every $1 000 or part of $1 000',
    ],
  },
  // The second BC instrument, recorded for the one figure it contributes: the
  // $200 filing fee the engine adds as `surcharge`, switched on by the same
  // $25,000 the Act's exemption ends at.
  [BC_COURT_FEES]: {
    checkedOn: CHECKED_B4_BC,
    checkedFigures: [
      'does not exceed $25 000 in value', '$200',
      'to file for and obtain a grant of probate or administration',
    ],
  },
  // BC's TaxTips.ca table stays as the row's additional source — it is the table
  // the row was keyed to before this slice and it states the Act's rule in its
  // own words — so a `contentChecked` row has no unchecked link in it.
  [TAXTIPS_PROBATE_URL('bc')]: {
    checkedOn: CHECKED_B4_BC,
    checkedFigures: ['$25,000', '$6 per $1,000', '$50,000', '$14 per $1,000', '$200'],
  },
  // The TaxTips.ca tables the three AB/NS/PE rows carry as their *additional*
  // source, recorded for the figures read on them like every other additional
  // source of a content-checked row. They state the same ladders in their own
  // words and are never the authority for a priced figure.
  [TAXTIPS_PROBATE_URL('ab')]: {
    checkedOn: CHECKED_B4_LADDERS,
    checkedFigures: ['$35', '$135', '$275', '$400', '$525', 'over $250,000'],
  },
  [TAXTIPS_PROBATE_URL('ns')]: {
    checkedOn: CHECKED_B4_LADDERS,
    checkedFigures: ['$85.60', '$215.20', '$358.15', '$1,002.65', '$16.95 per $1,000'],
  },
  [TAXTIPS_PROBATE_URL('pe')]: {
    checkedOn: CHECKED_B4_LADDERS,
    checkedFigures: ['$50', '$100', '$200', '$400', '$4 for each $1,000'],
  },
  // BE-38 B4 (AB/NS/PE): the instruments, recorded band by band in each
  // document's own boundary wording, so the ladder test can hold citation and
  // priced behaviour equal. Only fee figures carry a `$` (the equality check
  // filters on that).
  [AB_SURROGATE_RULES]: {
    checkedOn: CHECKED_B4_LADDERS,
    checkedFigures: [
      '$10 000 or under', '$35',
      'over $10 000 but not more than $25 000', '$135',
      'over $25 000 but not more than $125 000', '$275',
      'over $125 000 but not more than $250 000', '$400',
      'over $250 000', '$525',
    ],
  },
  [NS_PROBATE_ACT]: {
    checkedOn: CHECKED_B4_LADDERS,
    checkedFigures: [
      'in estates not exceeding $10,000', '$85.60',
      'in estates exceeding $10,000 but not exceeding $25,000', '$215.20',
      'in estates exceeding $25,000 but not exceeding $50,000', '$358.15',
      'in estates exceeding $50,000 but not exceeding $100,000', '$1002.65',
      'in estates exceeding $100,000', '$16.95',
      'plus an additional $16.95 for every $1,000 or fraction thereof in excess of $100,000',
    ],
  },
  [PE_PROBATE_ACT]: {
    checkedOn: CHECKED_B4_LADDERS,
    checkedFigures: [
      'up to $10,000', '$50',
      '$10,001 to $25,000', '$100',
      '$25,001 to $50,000', '$200',
      '$50,001 to $100,000', '$400',
      'exceeding $100,000', '$4',
      'plus $4 for each $1,000 or fraction thereof in excess of $100,000',
    ],
  },
}
/** The Ministry of Finance's 2026 parameters PDF. This is the URL the province's
 * pack records in `fieldSources`, so a row that prices those fields must cite
 * exactly it rather than the byte-identical `cdn-contenu.quebec.ca` mirror the
 * matrix used to carry. */
const QC_PARAMS = 'https://www.finances.gouv.qc.ca/Budget_et_mise_a_jour/maj/documents/AUTFR_RegimeImpot2026.pdf'
/**
 * The CFFP *Guide des mesures fiscales* (Université de Sherbrooke), the reachable
 * compilation this build's two derived Quebec rows are evidenced from. It prints
 * the 2025 RAMQ table (`taxData.ts` calls the premium a legacy preview): the
 * 5,000 band at 7.84% / 11.76%, the 392 base, the 755 maximum and the 19,890
 * single threshold this build indexes by 2% to 20,288 and 770. It also prints
 * Quebec's 2026 age and retirement-income parameters — age amount 3,986,
 * retirement amount 3,541, reduction threshold 42,955, reduction rate 18.75% and
 * 14% conversion — so it is the authority for the 18.75% `ageRate` the
 * parameters PDF does not carry. Reachable (HTTP 200) where Revenu Québec's own
 * pages are not. Recorded in {@link CONTENT_VERIFIED_AUTHORITIES} for the
 * figures above, read on the page itself.
 */
const ITA_38 = 'https://laws-lois.justice.gc.ca/eng/acts/i-3.3/section-38.html'
/** The Quebec abatement's 16.5%: the Department of Finance's 2026 Report on
 * Federal Tax Expenditures prints the rate, its 0.165 factor and its statutory
 * home (Federal-Provincial Fiscal Arrangements Act, Part VI). The dead
 * `f-1.3` Act the matrix used to cite does not exist on Justice Laws. */
const QC_ABATEMENT_2026 = 'https://www.canada.ca/content/dam/fin/publications/taxexp-depfisc/2026/taxexp-depfisc-26-eng.pdf'
const QC_ABATEMENT_ACT = 'https://laws-lois.justice.gc.ca/eng/acts/F-8/'
const QC_ABATEMENT_FORM = 'https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/t2203/t2203-25e.pdf'
/**
 * BE-38 B3 review (round 4, B1): Ontario's citation used to be `90e22`, which
 * resolves to the **Estates Administration Act, R.S.O. 1990, c. E.22** and
 * carries none of the priced figures. The authority the 1.5%-above-$50,000 fee
 * is actually in is the Estate Administration Tax Act, 1998, S.O. 1998, c. 34,
 * Sched. (`98e34`), whose s. 2(6.1) prints "$15 for each $1,000 or part thereof
 * by which the value of the estate exceeds $50,000" — read on the page, and
 * recorded in {@link CONTENT_VERIFIED_AUTHORITIES}.
 */
const PROBATE = 'https://www.ontario.ca/laws/statute/98e34'
const TAXTIPS_PROBATE = (code: string) =>
  `https://www.taxtips.ca/willsandestates/probatefees/${code}.htm`
/**
 * BE-38 B4 follow-up (blocking finding): the Nova Scotia citation this slice
 * added was a dead `probate.htm` — HTTP 404 on 6/6 probes, with and without a
 * browser User-Agent — yet it rendered as that row's *content-verified*
 * authority, because nothing recorded whether a cited URL had ever resolved.
 * These are the authorities a scripted reader fetched and got **HTTP 200** from
 * (probing repeated 2026-09-16). The suite requires an entry here for every
 * {@link CONTENT_VERIFIED_AUTHORITIES} URL that is not a recorded
 * {@link BLOCKED_SOURCES} gate, so a citation cannot become the rendered
 * authority for a figure without a live probe. The guard is the recorded status,
 * not a fetch: CI has no network.
 */
export const LIVE_PROBED_CITATIONS = [
  PROBATE, TAXTIPS_PROBATE('on'), PE_2026_JULY, BC_2026_JULY, NL_2026_JULY, CFFP_GUIDE,
  NT_COURT_FEES, YT_COURT_RULES, BC_PROBATE_ACT, BC_COURT_FEES,
  TAXTIPS_PROBATE('nt'), TAXTIPS_PROBATE('nu'), TAXTIPS_PROBATE('yt'), TAXTIPS_PROBATE('bc'),
  TAXTIPS_PROBATE('ab'), TAXTIPS_PROBATE('ns'), TAXTIPS_PROBATE('pe'),
  AB_SURROGATE_RULES, NS_PROBATE_ACT, PE_PROBATE_ACT,
]
/** The date the reachability sweep and the hand content checks behind most rows
 * were made. */
const AT = '2026-09-15'
/** BE-38 B3 review (round 4): the date the authorities in
 * {@link CONTENT_VERIFIED_AUTHORITIES} were last opened and read against their
 * figures. A row is only `contentChecked` when its `verifiedAt` is this date, so
 * a `verifiedAt` that never had its content read cannot inherit the claim. */
const CHECKED = '2026-09-17'
/**
 * BE-38 B4: each territory's own regulation, the document that carries the fee
 * `PROBATE_RATES` prices. NT and NU are no longer charged Yukon's $140, so the
 * row cites the authority its figures are in rather than the table it was
 * approximated from. Review B1: the row also prices that document's full
 * five-band ladder rather than its top tier alone, so the qualification the two
 * rows render (`probateFeesApproxNT` / `probateFeesApproxNU`) states the
 * modelled ladder instead of a gap.
 *
 * BE-38 B4 follow-up (the YT defect): Yukon was the third row in this position,
 * but its own document prints a *two*-value fee — $0 inside a $25,000 exemption
 * and $140 above it — so YT's qualification is the rule itself, not a
 * simplification, and it carries its own id (`probateFeesYT`) rather than the
 * generic one whose text lists the provinces this build simplifies.
 *
 * BE-38 B4 (the BC defect): BC is the fourth. Its row used to cite the
 * TaxTips.ca table for `flat: 200, rate: 0.014, threshold: 50000`, a price no
 * instrument prints — it charged $200 inside the Act's $25,000 exemption and
 * skipped the $25,000–$50,000 band. The row now cites the *Probate Fee Act*,
 * whose s. 2(2)(b)–(3)(b) prints the whole ladder the engine prices, and lists
 * the Supreme Court Civil Rules' Appendix C, Schedule 1, item 1 as its second
 * authority because that item prints the $200 filing fee the engine's
 * `surcharge` adds. Its qualification is the rule itself (`probateFeesBC`), not
 * a simplification.
 *
 * BE-38 B4 (the AB/NS/PE defect): these three rows each applied a single
 * top-tier flat amount from the first dollar, so a $10,000 estate paid $525
 * (AB), $1,003 (NS) or $400 (PE) against the $35, $85.60 and $50 their own
 * first bands print. Each now cites the instrument carrying its whole ladder —
 * AB's Surrogate Rules Sch. 2, NS's Probate Act s. 87(2), PEI's Probate Act
 * s. 119.1(4) — prices every rung, and renders its own rule-naming limitation.
 */
const PROBATE_OWN: Partial<Record<CoverageJurisdiction, { source: string; limitationId: string }>> = {
  YT: { source: YT_COURT_RULES, limitationId: 'probateFeesYT' },
  NT: { source: NT_COURT_FEES, limitationId: 'probateFeesApproxNT' },
  NU: { source: NU_COURT_FEES, limitationId: 'probateFeesApproxNU' },
  BC: { source: BC_PROBATE_ACT, limitationId: 'probateFeesBC' },
  AB: { source: AB_SURROGATE_RULES, limitationId: 'probateFeesAB' },
  NS: { source: NS_PROBATE_ACT, limitationId: 'probateFeesNS' },
  PE: { source: PE_PROBATE_ACT, limitationId: 'probateFeesPE' },
}
const federal = (code: CoverageJurisdiction): Record<string, ImplementedCreditCoverage> => {
  // The pack records each jurisdiction's own T4032 edition as its federal
  // source, and the row's *rendered* sourceURL is that same edition, so the
  // document a reader is shown is the document the pack prices the federal
  // ladder from. The MB and ON editions travel as additional sources because
  // the pinned fixture is keyed to the MB chart.
  const own = T4032(code.toLowerCase())
  // BE-38 B3 review (round 4): ON's own edition *is* the pinned ON chart, so the
  // hard-coded pair used to list Ontario's PDF twice (as `sourceURL` and again as
  // an additional source). The row's own edition is excluded from its extras.
  const pinnedCharts = [T4032('mb'), T4032('on')].filter(url => url !== own)
  return {
  'federal-income-tax-brackets': {
    coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['federal.brackets'],
    sourceURL: own, additionalSourceURLs: [...new Set(pinnedCharts)], verifiedAt: AT,
    evidenceFixture: 'federal-brackets-2026',
    limitationId: 'federalIncomeTaxBrackets',
  },
  'federal-basic-personal-amount': {
    coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['federal.bpa', 'federal.bpaMin'],
    sourceURL: own, additionalSourceURLs: [TD1], verifiedAt: AT,
    evidenceFixture: 'federal-bpa-and-phase-out-2026',
    limitationId: 'federalBasicPersonalAmount',
  },
  'federal-pension-income-amount': {
    coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['taxData.ts:FED_PENSION_AMOUNT'],
    sourceURL: TD1, verifiedAt: AT, evidenceFixture: 'federal-pension-amount-2026',
    limitationId: 'federalPensionIncomeAmount',
  },
  'federal-age-amount': {
    coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['taxData.ts:FED_AGE_AMOUNT'],
    sourceURL: TD1, verifiedAt: AT, evidenceFixture: 'federal-age-amount-2026',
    limitationId: 'federalAgeAmount',
  },
  'federal-spouse-amount': {
    coverage: 'implemented', scope: 'federal', kind: 'credit',
    ruleFields: ['spouseCredit2026.ts:federalSpouseAmount2026'],
    sourceURL: TD1, verifiedAt: AT, evidenceFixture: 'federal-spouse-amount-2026',
    limitationId: 'federalSpouseAmount',
  },
  'capital-gains-inclusion-rate': {
    coverage: 'implemented', scope: 'federal', kind: 'inclusion',
    ruleFields: ['taxData.ts:CAPITAL_GAINS_INCLUSION'],
    implementedRule: '50% of a realized capital gain enters taxable income.',
    sourceURL: ITA_38, verifiedAt: AT, evidenceFixture: 'capital-gains-inclusion-2026',
    limitationId: 'capitalGainsInclusion',
  },
  }
}

/**
 * BE-38 B3 review (NB6): probate used to be one row citing Ontario's statute for
 * all thirteen jurisdictions. `taxData.ts` reads the pinned figures from the
 * cited TaxTips.ca per-jurisdiction table, so each row now names its own.
 *
 * BE-38 B3 review (round 4, B1): Ontario's own row now cites the Estate
 * Administration Tax Act (`98e34`, the statute that prints the $15-per-$1,000
 * tax over $50,000) rather than the Estates Administration Act the citation used
 * to name, and the row is marked `contentChecked` because that authority is in
 * {@link CONTENT_VERIFIED_AUTHORITIES} with the figures read on the page.
 *
 * BE-38 B4: NT and NU used to price Yukon's $140 filing fee and cite Yukon's
 * table for it, so citation, priced value and fixture all named another
 * jurisdiction's document. Each now cites its own regulation — the document
 * that actually prints the $435 (NT) and $425 (NU) top tier `taxData.ts`
 * prices — and is `contentChecked` against it. The published tier ladder is
 * still simplified to its top tier, so the row keeps its rendered
 * qualification; the TaxTips.ca territory table travels as an additional source
 * rather than as the cited authority.
 *
 * BE-38 B4 follow-up: YT is the same shape of correction for the province that
 * lent the fee out. Its row used to cite Yukon's own TaxTips.ca table for an
 * unconditional $140; it now cites the Supreme Court Rules' fee schedule that
 * prints both the $140 and the $25,000 exemption, prices exactly those two
 * values, and renders `probateFeesYT`. (The schedule is served by the Yukon
 * courts and answers HTTP 200; the gated document is the unrendered
 * `laws.yukon.ca` mirror of the same Act, which this comment used to misname as
 * the citation.)
 *
 * BE-38 B4 (the BC defect): BC is the fifth, and the one whose citation the
 * sweep found disagreeing with the priced value. Its row now cites the *Probate
 * Fee Act*, whose s. 2(2)(b)–(3)(b) prints the whole band ladder the engine
 * prices; the rendered `probateFeesBC` qualification also names the Supreme
 * Court Civil Rules' Appendix C, Schedule 1, item 1, and the citation↔figure
 * equality test holds that second instrument to the $200 filing fee the
 * engine's `surcharge` adds.
 */
const probate = (code: CoverageJurisdiction): ImplementedCreditCoverage => {
  const table = TAXTIPS_PROBATE(code.toLowerCase())
  const own = PROBATE_OWN[code]
  // Every row's sourceURL is the document the priced figure is printed in: the
  // statute for ON, the jurisdiction's own instrument for AB/BC/NS/PE/YT/NT/NU,
  // the per-jurisdiction table otherwise.
  const sourceURL = code === 'ON' ? PROBATE : own?.source ?? table
  // ON's additional source is the reachable TaxTips.ca table, which every
  // content-checked row carries; AB/BC/NS/PE/YT/NT/NU add their own table for
  // the same reason. BC alone renders a *second* authority: the Court Rules item
  // that carries the $200 filing fee its `surcharge` prices.
  const extras = code === 'ON' || own ? [table] : []
  if (code === 'BC') extras.unshift(BC_COURT_FEES)
  return {
    coverage: 'implemented', scope: 'provincial', kind: 'fee', ruleFields: ['taxData.ts:PROBATE_RATES'],
    sourceURL, additionalSourceURLs: [...new Set(extras)],
    verifiedAt: code === 'ON' ? CHECKED
      : code === 'YT' ? CHECKED_B4_YT
        : code === 'BC' ? CHECKED_B4_BC
          : code === 'AB' || code === 'NS' || code === 'PE' ? CHECKED_B4_LADDERS
            : own ? CHECKED_B4 : AT,
    evidenceFixture: `probate-fees-${code.toLowerCase()}-2026`,
    contentChecked: code === 'ON' || own ? true : undefined,
    // BE-38 B4 follow-up: NB gets its own limitation so the rendered row can
    // disclose that the schedule it prices was repealed in 2026 and that the
    // current one charges more — the deferral is honest, not silent.
    limitationId: own?.limitationId
      ?? (code === 'MB' ? 'probateFeesMB' : code === 'NB' ? 'probateFeesNB' : 'probateFees'),
  }
}

/**
 * The rows every non-Quebec jurisdiction prices from its own T4032 chart and TD1.
 * The fixture id carries the jurisdiction because the authority does: every
 * province's age, pension and spouse line comes from its own TD1, so a shared
 * fixture id could (and did) point a province at another province's form.
 */
const provincial = (code: CoverageJurisdiction): Record<string, ImplementedCreditCoverage> => {
  const january = T4032(code.toLowerCase())
  // BC raised its bottom rate and PE moved its fourth threshold after the
  // January chart was printed; the pack prices the later editions, so the row
  // cites them and carries the superseded chart as an additional source. NL's
  // pack prices its July BPA. Citing January for any of the three is the defect
  // this round fixed: PE's link showed the $142,250 this slice declares
  // superseded, BC's showed 5.06% against the priced 5.60%, and NL's $11,188.
  const bracketSource = code === 'BC' ? BC_2026_JULY : code === 'PE' ? PE_2026_JULY : january
  // BE-38 B3 review (round 4, B2): PE's `PE_2026_GOV` entry in this list used to
  // render with no qualification. It is recorded in `BLOCKED_SOURCES` (a real
  // Chromium navigation is redirected to a Radware CAPTCHA even though the URL
  // answers 200 to curl), so the row must carry a rendered limitation naming the
  // gate — `peProvincialIncomeTaxBrackets` — and the panel marks the link itself.
  const bracketExtra = code === 'PE' ? [january, PE_2026_GOV] : bracketSource === january ? [] : [january]
  const bpaSource = code === 'NL' ? NL_2026_JULY : january
  return {
  'provincial-income-tax-brackets': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.brackets'], implementedRule: `The published 2026 ${code} ladder.`,
    sourceURL: bracketSource, additionalSourceURLs: [...new Set(bracketExtra)],
    verifiedAt: code === 'PE' || code === 'BC' ? CHECKED : AT,
    evidenceFixture: `${code.toLowerCase()}-provincial-brackets-2026`,
    limitationId: code === 'PE' ? 'peProvincialIncomeTaxBrackets' : undefined,
  },
  'provincial-basic-personal-amount': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.bpa'],
    sourceURL: bpaSource, additionalSourceURLs: bpaSource === january ? [] : [january],
    verifiedAt: code === 'NL' ? CHECKED : AT, evidenceFixture: `${code.toLowerCase()}-provincial-bpa-2026`,
    limitationId: 'provincialBasicPersonalAmount',
  },
  'provincial-pension-income-amount': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['taxData.ts:PROV_AGE_PENSION.pension'],
    sourceURL: TD1_PROV(code.toLowerCase()), verifiedAt: AT, evidenceFixture: `${code.toLowerCase()}-provincial-pension-amount-2026`,
    limitationId: 'provincialPensionIncomeAmount',
  },
  'provincial-age-amount': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit',
    ruleFields: ['taxData.ts:PROV_AGE_PENSION.ageMax', 'taxData.ts:PROV_AGE_PENSION.ageThreshold',
      'taxData.ts:PROV_AGE_PENSION.ageRate', 'taxData.ts:PROV_AGE_PENSION.seniorSupplement'],
    sourceURL: TD1_PROV(code.toLowerCase()), verifiedAt: AT, evidenceFixture: `${code.toLowerCase()}-provincial-age-amount-2026`,
    limitationId: 'provincialAgeAmount',
  },
  'provincial-spouse-amount': {
    coverage: 'implemented', scope: 'provincial', kind: 'credit',
    ruleFields: ['spouseCredit2026.ts:provincialSpouseAmount2026'],
    sourceURL: TD1_PROV(code.toLowerCase()), verifiedAt: AT, evidenceFixture: `${code.toLowerCase()}-provincial-spouse-amount-2026`,
    limitationId: 'provincialSpouseAmount',
  },
  }
}

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
        limitationId: 'ontarioSurtax',
      },
      'ontario-health-premium': {
        coverage: 'implemented', scope: 'provincial', kind: 'levy', ruleFields: ['taxData.ts:ON_HEALTH_PREMIUM'],
        sourceURL: T4032('on'), verifiedAt: AT, evidenceFixture: 'ontario-health-premium-2026',
        limitationId: 'ontarioHealthPremium',
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
      // BE-38 B3 review (B2): the rendered authority is the Ministry of Finance
      // parameters PDF the pack itself records as the source of these fields and
      // which returns 200 and prints the priced 2026 thresholds and BPA. The
      // bracket *rates* are published on Revenu Québec's rates page, which
      // answers a scripted reader with a bot gate, and the full 2026 ladder is
      // also printed in the reachable CFFP guide; both are additional sources and
      // the row's rendered limitation says which is which, so the reader is never
      // handed an unqualified dead link.
      'quebec-income-tax-brackets': {
        coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.brackets'],
        sourceURL: QC_PARAMS, additionalSourceURLs: [CFFP_GUIDE, RQ_RATES], verifiedAt: CHECKED,
        evidenceFixture: 'quebec-brackets-2026', limitationId: 'quebecIncomeTaxBrackets',
        qualifiedSource: true,
      },
      'quebec-basic-personal-amount': {
        coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['provincial.bpa'],
        sourceURL: QC_PARAMS, additionalSourceURLs: [CFFP_GUIDE, RQ_RATES], verifiedAt: CHECKED,
        evidenceFixture: 'quebec-bpa-2026', limitationId: 'quebecBasicPersonalAmount',
        qualifiedSource: true,
      },
      'quebec-federal-abatement': {
        coverage: 'implemented', scope: 'federal', kind: 'credit', ruleFields: ['taxData.ts:QC_ABATEMENT'],
        sourceURL: QC_ABATEMENT_2026,
        additionalSourceURLs: [QC_ABATEMENT_ACT, QC_ABATEMENT_FORM], verifiedAt: AT,
        evidenceFixture: 'quebec-abatement-2026',
        limitationId: 'quebecFederalAbatement',
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
        sourceURL: QC_PARAMS, additionalSourceURLs: [CFFP_GUIDE], verifiedAt: CHECKED,
        evidenceFixture: 'qc-provincial-age-amount-2026', limitationId: 'quebecProvincialAgeAmount',
        qualifiedSource: true,
      },
      'provincial-pension-income-amount': {
        coverage: 'implemented', scope: 'provincial', kind: 'credit', ruleFields: ['taxData.ts:PROV_AGE_PENSION.pension'],
        sourceURL: QC_PARAMS, verifiedAt: AT, evidenceFixture: 'qc-provincial-pension-amount-2026',
        limitationId: 'quebecProvincialPensionIncomeAmount',
      },
      'quebec-fss-contribution': {
        coverage: 'implemented', scope: 'provincial', kind: 'levy', ruleFields: ['taxData.ts:QC_FSS'],
        sourceURL: QC_PARAMS, verifiedAt: AT, evidenceFixture: 'quebec-fss-2026',
        limitationId: 'quebecFssContribution', qualifiedSource: true,
      },
      // BE-38 B3 review (B1): the cited document used to be the parameters PDF,
      // which prints none of these four figures (`taxData.ts` calls them a
      // legacy preview). The row now cites the 2025 table they were indexed
      // from and the rendered limitation says they are a derivation pending the
      // 2026 Schedule K, so the citation no longer records a read that did not
      // happen.
      'quebec-ramq-premium': {
        coverage: 'implemented', scope: 'provincial', kind: 'levy', ruleFields: ['taxData.ts:QC_RAMQ'],
        sourceURL: CFFP_GUIDE, verifiedAt: CHECKED, evidenceFixture: 'quebec-ramq-2026',
        limitationId: 'quebecRamqPremium', qualifiedSource: true,
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
        limitationId: 'manitobaBpaPhaseOut', qualifiedSource: true,
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
        limitationId: 'yukonBpaPhaseOut', qualifiedSource: true,
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
  const common = commonUnsupported()
  const jurisdictions = COVERAGE_JURISDICTIONS.map((jurisdiction) => {
    const implemented: Record<string, ImplementedCreditCoverage> = {
      ...federal(jurisdiction),
      'probate-and-estate-fees': probate(jurisdiction),
    }
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

/**
 * Every `coverageLimitation.<id>` catalogue entry the panel can render, derived
 * from the matrix rather than hand-listed: a row that gains or loses a limit
 * changes this list, so the i18n guard cannot drift from the artifact.
 */
export function coverageLimitationIds(): string[] {
  const ids = new Set<string>()
  for (const row of coverageMatrix.jurisdictions)
    for (const credit of Object.values(row.implemented)) if (credit.limitationId) ids.add(credit.limitationId)
  return [...ids].sort()
}

/** The jurisdictions the matrix covers. */
export function matrixJurisdictions(): string[] {
  return coverageMatrix.jurisdictions.map(row => row.jurisdiction)
}

/**
 * One row's authorities in render order, each carrying the exact claim the
 * artifact makes about it. BE-38 B3 review (round 4): `contentChecked` is true
 * only for a URL in {@link CONTENT_VERIFIED_AUTHORITIES} on the row's own
 * `verifiedAt` date — a person opened it and read the recorded figures — and
 * `blocked` carries the recorded gate for a URL a scripted reader cannot reach.
 * The panel renders these three states verbatim, so no authority is shown as
 * carrying a figure unless the registry says it was checked.
 */
export function rowAuthorities(credit: ImplementedCreditCoverage): {
  url: string; primary: boolean; checkedFigures?: string[]; blocked?: BlockedSource
}[] {
  return [credit.sourceURL, ...(credit.additionalSourceURLs ?? [])].map((url) => {
    const verified = CONTENT_VERIFIED_AUTHORITIES[url]
    return {
      url,
      primary: url === credit.sourceURL,
      checkedFigures: verified && verified.checkedOn === credit.verifiedAt ? verified.checkedFigures : undefined,
      blocked: BLOCKED_SOURCES[url],
    }
  })
}
