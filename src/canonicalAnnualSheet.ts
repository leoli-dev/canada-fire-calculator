import type { AnnualCoverage, AnnualStopCause, YearRow } from './engine/annualState'
import type { AnnualSheetCell, AnnualSheetExplanation, AnnualSheetModel, AnnualSheetRow, AnnualSheetText } from './annualSheet'

/** Length-independent, injective UTF-16 encoding; safe in HTML IDs and CSS selectors.
 * The role is a separate segment, so entity IDs cannot collide with field paths. */
export const canonicalSheetId = (...parts: string[]): string => 'canonical' + parts.map(part =>
  `-${part.length.toString(16)}x` + Array.from({ length: part.length }, (_, i) => part.charCodeAt(i).toString(16).padStart(4, '0')).join('')).join('')

const text = (en: string, fr: string, zh: string): AnnualSheetText => ({ en, fr, zh })
const labels = {
  inflationBridge: text('Inflation purchasing-power bridge (memo)', 'Effet de l’inflation sur le pouvoir d’achat (mémo)', '通胀购买力桥接（备忘）'),
  postings: text('Accepted contribution postings (memo)', 'Écritures de cotisations acceptées (mémo)', '已接受供款入账（备忘）'),
  retained: text('Retained contribution postings (memo)', 'Écritures de cotisations conservées (mémo)', '保留供款入账（备忘）'),
  owned: text('Owned accounts (not contributor attribution)', 'Comptes détenus (pas l’attribution au cotisant)', '名下账户（非供款人归属）'),
  contributed: text('Accepted postings attributed to this contributor (memo)', 'Écritures acceptées attribuées à ce cotisant (mémo)', '归属此供款人的已接受入账（备忘）'),
  scheduledRrspBudgeted: text('Budgeted scheduled RRSP / spousal RRSP (before room limits; excludes FHSA)', 'REER / REER de conjoint prévus au budget (avant plafonds; exclut CELIAPP)', '预算中的计划 RRSP／配偶 RRSP（额度限制前；不含 FHSA）'),
  netAvailableCash: text('Net savings budget used for allocation', 'Budget d’épargne nette utilisé pour l’affectation', '实际分配采用的净储蓄预算'),
  suppliedNetCash: text('Net cash from supplied annual facts (memo)', 'Trésorerie nette selon les faits annuels fournis (mémo)', '提供的年度事实所算净现金（备忘）'),
  scheduledPlanned: text('Scheduled RRSP and FHSA requested (memo; already in budgets)', 'REER et CELIAPP prévus demandés (mémo; déjà au budget)', '计划 RRSP 与 FHSA 请求（备忘；已计入预算）'),
  scheduledApplied: text('Scheduled contributions accepted and posted (memo)', 'Cotisations prévues acceptées et comptabilisées (mémo)', '计划供款已接受入账（备忘）'),
  scheduledRetained: text('Scheduled contributions retained in non-registered savings (memo)', 'Cotisations prévues conservées hors régime (mémo)', '计划供款保留在非注册储蓄中（备忘）'),
  appliedTotal: text('Total accepted account postings (memo; includes retained savings)', 'Total des écritures acceptées (mémo; épargne conservée incluse)', '账户接受入账合计（备忘；含保留储蓄）'),
  household: text('Household', 'Ménage', '家庭'), person: text('Person', 'Personne', '人员'),
  account: text('Account', 'Compte', '账户'), debt: text('Debt', 'Dette', '负债'), property: text('Property', 'Bien immobilier', '房产'),
  opening: text('Opening balance', 'Solde initial', '期初余额'), closing: text('Closing balance', 'Solde final', '期末余额'),
  income: text('Supplied income', 'Revenu fourni', '提供的收入'), earnedIncome: text('Supplied earned income (overlaps income)', 'Revenu gagné fourni (inclus dans le revenu)', '提供的劳动收入（与收入重叠）'),
  benefits: text('Supplied cash benefits', 'Prestations fournies', '提供的现金福利'), tax: text('Supplied tax', 'Impôt fourni', '提供的税额'),
  spending: text('Supplied spending', 'Dépenses fournies', '提供的支出'), taxableIncome: text('Supplied taxable income (nominal tax basis)', 'Revenu imposable fourni (base nominale)', '提供的应税收入（名义税基）'),
  age: text('Age reached during year', 'Âge atteint pendant l’année', '年内达到的年龄'), contribution: text('Applied contributions', 'Cotisations appliquées', '已执行供款'),
  withdrawal: text('Applied withdrawals', 'Retraits appliqués', '已执行提款'), returnAmount: text('Investment growth', 'Croissance des placements', '投资增长'),
  acb: text('Closing ACB (nominal tax basis)', 'PBR final (base nominale)', '期末 ACB（名义税基）'),
  interest: text('Interest', 'Intérêts', '利息'), principal: text('Principal repaid', 'Capital remboursé', '偿还本金'),
  payment: text('Payment', 'Paiement', '还款'), growth: text('Property growth', 'Appréciation', '房产增长'),
  debtPayments: text('Debt payments', 'Paiements de dettes', '偿债付款'),
  fhsaContributions: text('Allocated FHSA contributions (before room limits)', 'Cotisations CELIAPP affectées (avant plafonds)', '分配的 FHSA 供款（额度限制前）'),
  employeeContributions: text('Budgeted employee contributions', 'Cotisations salariales au budget', '预算雇员供款'),
  employerContributions: text('Additional employer money (outside household cash budget)', 'Apport patronal supplémentaire (hors budget de trésorerie du ménage)', '额外雇主资金（不占家庭现金预算）'),
  voluntaryContributions: text('Budgeted voluntary contributions (before room limits)', 'Cotisations volontaires au budget (avant plafonds)', '预算自愿供款（额度限制前）'),
  retainedContributions: text('Contributions retained in non-registered savings', 'Cotisations conservées hors régime', '保留在非注册储蓄中的供款'),
  unallocated: text('Unallocated cash', 'Trésorerie non affectée', '未分配现金'),
  assets: text('Closing investable assets', 'Placements finaux', '期末投资资产'),
  netWorth: text('Closing net worth', 'Valeur nette finale', '期末净资产'),
  retirement: text('Retirement pricing', 'Calcul de retraite', '退休定价'), estate: text('Net estate', 'Succession nette', '净遗产'),
}
/** Safe presentation vocabulary: raw AnnualIssue.detail and unknown-fact reasons
 * are diagnostic strings and must never cross the sheet boundary. */
export type CanonicalSheetLimitation = 'invalid' | 'unsupported' | 'unfunded' | 'suffix' | 'unknown' | 'notHeld' | 'workingYear' | 'nonTerminal'
const copy = {
  suppliedCash: text('Income + benefits − tax − spending − debt payments, from the supplied annual evaluation and settled debt payments. Validation accepts an absolute difference of up to nominal CAD 0.01 (one cent) from the allocation budget. These values can therefore differ; this memo is not additional available money or an account posting.', 'Revenus + prestations − impôt − dépenses − paiements de dettes, selon l’évaluation annuelle fournie et les paiements de dettes réglés. La validation accepte un écart absolu d’au plus 0,01 CAD nominal (un cent) avec le budget d’affectation. Ces valeurs peuvent donc différer; ce mémo n’est ni de l’argent disponible supplémentaire ni une écriture de compte.', '根据提供的年度评估与已结算偿债付款，收入 + 福利 − 税额 − 支出 − 偿债付款。验证允许与分配预算相差最多名义 0.01 加元（一分）。因此两者可能不同；此备忘不代表额外可用资金或账户入账。'),
  allocationBasis: text('The exact canonical net-savings budget used by the allocator, recorded before room clipping. This is separate from net cash derived from supplied annual facts, which may differ within the accepted nominal CAD 0.01 tolerance.', 'Budget canonique exact d’épargne nette utilisé par l’affectation, enregistré avant les plafonds. Il est distinct de la trésorerie nette dérivée des faits annuels fournis, qui peut différer dans la tolérance acceptée de 0,01 CAD nominal.', '分配器实际采用的标准净储蓄预算，记录于额度限制之前。它与提供的年度事实所算净现金分列，后者可在允许的名义 0.01 加元容差内有所不同。'),
  allocation: text('Allocation-time cash uses: the recorded net savings budget = budgeted FHSA + employee contributions + voluntary contributions + scheduled RRSP / spousal RRSP + unallocated cash. Scheduled FHSA is already inside the FHSA budget and is not added again. Room limits can redirect part of scheduled or voluntary contributions to non-registered savings; those retained amounts and final postings are memo facts, not extra budget uses. Additional employer money is outside this household cash equation.', 'Emplois de trésorerie au moment de l’affectation : budget d’épargne nette enregistré = CELIAPP au budget + cotisations salariales + cotisations volontaires + REER / REER de conjoint prévus + trésorerie non affectée. Le CELIAPP prévu est déjà inclus dans son budget. Les plafonds peuvent réorienter des cotisations prévues ou volontaires hors régime; montants conservés et écritures finales sont des mémos, pas des emplois supplémentaires. L’apport patronal supplémentaire est hors de cette équation.', '分配时的现金用途：已记录净储蓄预算 = 预算 FHSA + 雇员供款 + 自愿供款 + 计划 RRSP／配偶 RRSP + 未分配现金。计划 FHSA 已计入 FHSA 预算，不再重复相加。额度限制可将部分计划或自愿供款转入非注册储蓄；保留金额与最终入账为备忘事实，并非额外预算用途。额外雇主资金不计入此家庭现金等式。'),
  workingYear: text('Retirement pricing does not apply in this settled working year.', 'Le calcul de retraite ne s’applique pas à cette année de travail réglée.', '本已结算工作年度不适用退休定价。'),
  nonTerminal: text('Estate settlement applies only in the plan’s terminal year.', 'Le règlement successoral s’applique uniquement à l’année finale du plan.', '遗产结算仅适用于计划终年。'),
  inflation: text('Presentation bridge only: nominal value is zero. In real CAD, closing nominal balance × (end CPI factor − start CPI factor) reconciles opening balance plus movements to closing purchasing power. This is not a cash flow or an investment gain.', 'Rapprochement de présentation uniquement : valeur nominale nulle. En CAD réels, solde final nominal × (facteur IPC final − initial) rapproche solde initial et mouvements du pouvoir d’achat final. Ce n’est ni un flux ni un gain.', '仅为展示桥接：名义值为零。实际加元值为名义期末余额 ×（年末 CPI 因子 − 年初 CPI 因子），用于将期初余额及变动与期末购买力对账，并非现金流或投资收益。'),
  memo: text('Memo bridge only: do not add these figures to cash uses or account contributions again. Accepted postings identify the account owner and contributor separately; retained contributions are already posted to non-registered savings.', 'Mémo uniquement : ne pas rajouter ces montants aux sorties de trésorerie ou cotisations. Titulaire et cotisant sont distincts; les cotisations conservées sont déjà comptabilisées hors régime.', '仅为备忘桥接：不要再次计入现金用途或账户供款。接受入账分别记录账户持有人与供款人；保留供款已存入非注册储蓄。'),
  scope: text('Internal canonical annual ledger. Income, spending, benefits and tax are supplied by an evaluator; they are not verified production tax calculations. Retirement, events and estate coverage remain limited; FIRE conclusions are unavailable.', 'Registre annuel canonique interne. Revenus, dépenses, prestations et impôts fournis par un évaluateur, sans calcul fiscal de production vérifié. Retraite, événements et succession restent limités; conclusions FIRE indisponibles.', '内部标准年度账本。收入、支出、福利和税额由评估器提供，并非已验证的生产税务计算。退休、事件和遗产覆盖仍有限，FIRE 结论不可用。'),
  invalid: text('This year could not be validated. Later years were not computed.', 'Cette année ne peut être validée. Les années suivantes ne sont pas calculées.', '本年度无法验证，后续年度未计算。'),
  unsupported: text('This year requires rules or facts not yet supported. Later years were not computed.', 'Cette année nécessite des règles ou faits non pris en charge. Les années suivantes ne sont pas calculées.', '本年度需要尚未支持的规则或事实，后续年度未计算。'),
  unfunded: text('Funding could not be settled for this year.', 'Le financement ne peut être réglé pour cette année.', '本年度融资无法结算。'),
  suffix: text('Not computed after the first blocked year.', 'Non calculé après la première année bloquée.', '首个受阻年度之后未计算。'),
  unknown: text('The required fact is not established.', 'Le fait requis n’est pas établi.', '所需事实尚未确认。'),
  notHeld: text('This property is not held in this year.', 'Ce bien n’est pas détenu cette année.', '本年度未持有此房产。'),
  supplied: text('Provider-supplied annual facts; income, earned income and taxable income overlap and must not be added together.', 'Faits annuels fournis; revenu, revenu gagné et revenu imposable se chevauchent et ne doivent pas être additionnés.', '评估器提供的年度事实；收入、劳动收入与应税收入口径重叠，不能相加。'),
  ledger: text('Settled canonical annual ledger, nominal CAD. Opening balances and annual flows use start-of-year CPI; closing balances use end-of-year CPI. The inflation memo reconciles their purchasing-power difference. No additional nominal conversion is applied.', 'Registre annuel canonique réglé, en CAD nominaux. Soldes initiaux et flux au facteur IPC initial; soldes finaux au facteur IPC final. Le mémo inflation rapproche leur pouvoir d’achat. Aucune autre conversion nominale.', '已结算标准年度账本，名义加元。期初余额与年度流量采用年初 CPI 因子，期末余额采用年末 CPI 因子，通胀备忘桥接购买力差异，不再重复转换为名义值。'),
}

const stopCopy: Record<AnnualStopCause, AnnualSheetText> = {
  retirement: text('Retirement withdrawals and benefits are not yet supported.', 'Les retraits et prestations de retraite ne sont pas encore pris en charge.', '尚未支持退休提款与福利。'),
  propertyPurchase: text('Home-purchase funding and tax settlement are not yet supported.', 'Le financement et l’impôt d’achat immobilier ne sont pas encore pris en charge.', '尚未支持购房融资与税务结算。'),
  propertySale: text('Property-sale funding and tax settlement are not yet supported.', 'Le financement et l’impôt de vente immobilière ne sont pas encore pris en charge.', '尚未支持房产出售融资与税务结算。'),
  registeredWithdrawal: text('Required registered-account withdrawals are not yet supported.', 'Les retraits obligatoires des comptes enregistrés ne sont pas encore pris en charge.', '尚未支持注册账户强制提款。'),
  registeredConversion: text('Required registered-account conversion or closure is not yet supported.', 'La conversion ou fermeture obligatoire du compte enregistré n’est pas encore prise en charge.', '尚未支持注册账户法定转换或关闭。'),
  fhsaRules: text('Required FHSA facts or rules are not established.', 'Les faits ou règles CELIAPP requis ne sont pas établis.', '所需 FHSA 事实或规则尚未确认。'),
  rrspRoom: text('Required RRSP contribution-room facts or addition rules are not established.', 'Les faits ou règles d’ajout des droits REER requis ne sont pas établis.', '所需 RRSP 额度事实或新增额度规则尚未确认。'),
  withdrawalFunding: text('The required withdrawal funding is not yet supported.', 'Le financement requis par retraits n’est pas encore pris en charge.', '尚未支持所需的提款融资。'),
  cashMismatch: text('Supplied net cash does not reconcile with the plan’s net savings budget.', 'La trésorerie nette fournie ne concorde pas avec le budget d’épargne nette du plan.', '提供的净现金与计划净储蓄预算不符。'),
  contributionAttribution: text('Contribution ownership, contributor or destination cannot be established for this allocation.', 'Le titulaire, le cotisant ou la destination de cette affectation ne peut être établi.', '此分配的账户持有人、供款人或供款去向无法确认。'),
  contributionFunding: text('The requested contribution or event funding cannot be settled.', 'Le financement demandé pour les cotisations ou événements ne peut être réglé.', '所请求的供款或事件融资无法结算。'),
  invalidEvaluation: text('The supplied annual evaluation could not be validated.', 'L’évaluation annuelle fournie ne peut être validée.', '提供的年度评估无法验证。'),
  invalidReturn: text('The supplied investment return could not be validated.', 'Le rendement fourni ne peut être validé.', '提供的投资回报无法验证。'),
  invalidState: copy.invalid,
  unsupported: copy.unsupported,
}

/** Pure selector: consumes one canonical settled chain. No provider calls or legacy splicing.
 * Callers must pass the unmodified successful value of projectAnnualCoverage; a failed
 * preflight has no coverage model. Entity IDs are metadata, never translated labels.
 */
export function canonicalAnnualSheet(coverage: AnnualCoverage, context: { scenarioId: string; revision: string | number }): AnnualSheetModel {
  const settled = new Map(coverage.rows.map(row => [row.year, row]))
  const years = Array.from({ length: coverage.requestedYears }, (_, i) => {
    const year = coverage.requestedStartYear + i
    // Kernel growth includes one year of inflation, including baseYear.
    // Start(y) equals end(y-1), also for resumed snapshots.
    return { year, realFactor: (1 + coverage.inflation) ** -(year - coverage.baseYear + 1),
      openingRealFactor: (1 + coverage.inflation) ** -(year - coverage.baseYear) }
  })
  const retainedLabel = (posting: YearRow['contributionLedger']['retained'][number]): AnnualSheetText => {
    const person = Object.keys(coverage.state.byPerson).indexOf(posting.personId) + 1
    return text(`${posting.kind.toUpperCase()} retained for person ${person} (memo; already in non-registered posting)`,
      `${({ rrsp: 'REER', fhsa: 'CELIAPP', tfsa: 'CELI' })[posting.kind]} conservé pour personne ${person} (mémo; déjà comptabilisé hors régime)`,
      `人员 ${person} 的 ${posting.kind.toUpperCase()} 保留金额（备忘；已存入非注册账户）`)
  }
  const postingLabel = (posting: YearRow['contributionLedger']['postings'][number]): AnnualSheetText => {
    const owner = Object.keys(coverage.state.byPerson).indexOf(posting.ownerId) + 1
    const contributor = posting.contributorId === null ? null : Object.keys(coverage.state.byPerson).indexOf(posting.contributorId) + 1
    const account = Object.keys(coverage.state.byAccount).indexOf(posting.accountId) + 1
    return text(`Account ${account}; owner: person ${owner}; contributor: ${contributor === null ? 'unattributed' : `person ${contributor}`} (memo)`,
      `Compte ${account}; titulaire : personne ${owner}; cotisant : ${contributor === null ? 'non attribué' : `personne ${contributor}`} (mémo)`,
      `账户 ${account}；持有人：人员 ${owner}；供款人：${contributor === null ? '未归属' : `人员 ${contributor}`}（备忘）`)
  }
  const explanations = new Map<string, () => AnnualSheetExplanation>()
  const make = (id: string, label: AnnualSheetText, get: (row: YearRow) => number | null,
    timing: AnnualSheetCell['timing'] = 'during-year', options: { supplied?: boolean; unit?: AnnualSheetCell['unit']; taxBasis?: boolean; entity?: AnnualSheetRow['entity']; applicable?: (row: YearRow) => boolean; inapplicable?: 'workingYear' | 'nonTerminal'; memo?: boolean; postingDetail?: boolean; retainedDetail?: boolean; summary?: AnnualSheetText; formula?: (row: YearRow) => NonNullable<AnnualSheetExplanation['formula']>; sources?: (row: YearRow) => NonNullable<AnnualSheetExplanation['sources']>; realValue?: (row: YearRow, start: number, end: number) => number } = {}): AnnualSheetRow => ({
    id, label: coverage.evaluationBasis === 'canonical-retirement' && label === labels.tax ? text('Modeled tax', 'Impôt modélisé', '模型税额') : coverage.evaluationBasis === 'canonical-retirement' && label === labels.benefits ? text('Confirmed cash benefits', 'Prestations confirmées', '已确认现金福利') : label, entity: options.entity,
    cells: Object.fromEntries(years.map(({ year, openingRealFactor, realFactor }) => {
      const row = settled.get(year)
      const reference = JSON.stringify([id, year])
      const supplied = options.supplied && !row?.retirementSettlement
      const estimated = supplied || !!row?.retirementSettlement && (row.retirementSettlement.taxRules.coverage === 'estimated' || row.retirementSettlement.taxRules.assumedFutureRule || row.year > row.retirementSettlement.taxRules.ruleYear)
      const applicable = row && (options.applicable?.(row) ?? true)
      const value = applicable ? get(row!) : null
      const limitation: CanonicalSheetLimitation = !row ? year === coverage.blocked?.year
        ? coverage.blocked.issues.some(issue => issue.code === 'unfunded') ? 'unfunded' : coverage.blocked.status
        : 'suffix' : !applicable ? options.inapplicable ?? 'notHeld' : 'unknown'
      const stop = !row && year === coverage.blocked?.year ? coverage.blocked.causes[0] : undefined
      const reason = stop ? stopCopy[stop] : copy[limitation]
      explanations.set(reference, () => ({ summary: options.summary ?? (options.memo ? copy.memo : supplied ? copy.supplied : copy.ledger),
        projectionYear: year, rulePackage: row?.retirementSettlement?.taxRules.rulePackId, taxYear: row?.retirementSettlement?.taxRules.ruleYear, formulaBasis: row?.retirementSettlement ? text('Start-year nominal CAD ÷ start CPI → anchor-year real tax → tax × start CPI for nominal settlement.', 'CAD nominaux au début ÷ IPC initial → impôt réel de référence → impôt × IPC initial pour règlement nominal.', '年初名义加元 ÷ 年初 CPI → 基准年实际税额 → 税额 × 年初 CPI 进行名义结算。') : undefined, forwardAssumption: row?.retirementSettlement && (row.retirementSettlement.taxRules.assumedFutureRule || row.year > row.retirementSettlement.taxRules.ruleYear) ? text(`Pinned anchor-year ${row.retirementSettlement.taxRules.ruleYear} real tax rules used for projection year ${row.year}; future statutory changes are not priced.`, `Règles fiscales réelles de référence ${row.retirementSettlement.taxRules.ruleYear} utilisées pour ${row.year}; les modifications légales futures ne sont pas calculées.`, `预测年份 ${row.year} 使用固定基准年 ${row.retirementSettlement.taxRules.ruleYear} 的实际税务规则；未计算未来法定变更。`) : undefined, sources: [{ label: supplied ? copy.supplied : copy.ledger,
          id: options.entity?.id, field: id, code: !row || value === null ? stop ?? limitation : undefined, granularity: 'year' }, ...(row?.retirementSettlement ? [{ label: text('Canonical retirement tax rules; start-CPI nominal to anchor real and back', 'Règles fiscales de retraite; IPC initial vers réel puis nominal', '退休税务规则；年初 CPI 名义与实际换算'), id: row.retirementSettlement.taxRules.rulePackId, field: 'retirementSettlement.taxRules', granularity: 'year' as const }] : []), ...(row && applicable && options.sources ? options.sources(row) : []),
          ...(row && options.postingDetail ? row.contributionLedger.postings.flatMap(posting => [
            { label: postingLabel(posting), id: posting.id, field: 'contributionPosting', granularity: 'year' as const },
            { label: labels.account, id: posting.accountId, field: 'accountId', granularity: 'year' as const },
            { label: text('Account owner', 'Titulaire du compte', '账户持有人'), id: posting.ownerId, field: 'ownerId', granularity: 'year' as const },
            { label: text('Contributor', 'Cotisant', '供款人'), id: posting.contributorId ?? undefined, field: 'contributorId', granularity: 'year' as const },
          ]) : []), ...(row && options.retainedDetail ? row.contributionLedger.retained.map(posting => ({ label: retainedLabel(posting), id: posting.personId, field: posting.kind, granularity: 'year' as const })) : [])],
        formula: !applicable ? undefined : row && options.formula ? options.formula(row) : row && options.postingDetail ? row.contributionLedger.postings.map(posting => ({
          label: postingLabel(posting), sourceId: posting.id, field: 'contributionPosting', value: posting.amount,
          direction: 'add' as const, unit: 'CAD' as const, basis: 'nominal-CAD' as const,
        })) : row && options.retainedDetail ? row.contributionLedger.retained.map(posting => ({
          label: retainedLabel(posting), sourceId: posting.personId, field: posting.kind, value: posting.amount,
          direction: 'add' as const, unit: 'CAD' as const, basis: 'nominal-CAD' as const,
        })) : undefined,
        limitations: !row || value === null ? [reason] : undefined }))
      const cell: AnnualSheetCell = { value: value !== null && Number.isFinite(value) ? value === 0 ? 0 : value : null,
        status: !row ? 'not-computed' : !applicable ? 'not-applicable' : value === null || !Number.isFinite(value) ? 'unknown' : estimated ? 'estimated' : 'calculated',
        realFactor: timing === 'closing' || timing === 'terminal' ? realFactor : openingRealFactor,
        realValue: row && options.realValue ? options.realValue(row, openingRealFactor, realFactor) : undefined,
        timing, unit: options.unit ?? 'CAD', basis: options.taxBasis ? 'nominal-tax-basis' : 'nominal-CAD',
        nativeBasis: supplied ? copy.supplied : copy.ledger, conversion: copy.ledger,
        reason: !row || !applicable || value === null ? reason : undefined, explanationRefs: [reference] }
      return [year, cell]
    })),
  })
  const bridge = (domain: string, entityId: string | null, closing: (row: YearRow) => number, entity?: AnnualSheetRow['entity'], applicable?: (row: YearRow) => boolean) =>
    make(canonicalSheetId('value', domain, ...(entityId === null ? [] : [entityId]), 'inflationBridge'), labels.inflationBridge, () => 0, 'closing',
      { entity, applicable, memo: true, summary: copy.inflation, realValue: (row, start, end) => end === start || closing(row) === 0 ? 0 : closing(row) * (end - start) })
  const numbered = (label: AnnualSheetText, index: number): AnnualSheetText => typeof label === 'string' ? `${label} ${index + 1}` : { en: `${label.en} ${index + 1}`, fr: `${label.fr} ${index + 1}`, zh: `${label.zh} ${index + 1}` }
  const group = (id: string, label: AnnualSheetText, children: AnnualSheetRow[], entity?: AnnualSheetRow['entity']): AnnualSheetRow => ({ id, label, kind: 'group', children, entity })
  const household = (row: YearRow) => Object.values(row.byAccount).reduce((sum, account) => sum + account.closing, 0)
  const fundedFormula = (row: YearRow): NonNullable<AnnualSheetExplanation['formula']> => [
    ...Object.entries(row.byAccount).map(([accountId, account]) => ({ label: text('Account withdrawal', 'Retrait du compte', '账户提款'), sourceId: `annual:${row.year}:withdrawal:${accountId}`, field: 'withdrawal', value: account.withdrawal, direction: 'add' as const, unit: 'CAD' as const, basis: 'nominal-CAD' as const })),
    { label: text('Modeled tax', 'Impôt modélisé', '模型税额'), field: 'tax', value: row.cashLedger.tax, direction: 'subtract', unit: 'CAD', basis: 'nominal-CAD' },
    { label: labels.unallocated, field: 'unallocated', value: row.cashLedger.unallocated, direction: 'subtract', unit: 'CAD', basis: 'nominal-CAD' },
  ]
  const rows: AnnualSheetRow[] = [group(canonicalSheetId('group', 'household'), labels.household, [
    ...Object.keys(coverage.rows[0]?.cashLedger ?? { income: 0, benefits: 0, tax: 0, spending: 0, debtPayments: 0, fhsaContributions: 0, employeeContributions: 0, employerContributions: 0, voluntaryContributions: 0, retainedContributions: 0, unallocated: 0 }).map(key => {
      const field = key as keyof YearRow['cashLedger']
      return make(canonicalSheetId('value', 'cash', field), labels[field], row => row.cashLedger[field], 'during-year', { supplied: ['income', 'benefits', 'tax', 'spending'].includes(field), retainedDetail: field === 'retainedContributions', memo: field === 'retainedContributions', summary: ['fhsaContributions', 'employeeContributions', 'employerContributions', 'voluntaryContributions', 'unallocated'].includes(field) ? copy.allocation : undefined })
    }),
    make(canonicalSheetId('value', 'cash', 'scheduledRrspBudgeted'), labels.scheduledRrspBudgeted, row => row.contributionLedger.scheduledRrspBudgeted, 'during-year', { summary: copy.allocation }),
    make(canonicalSheetId('value', 'cash', 'netAvailableCash'), labels.netAvailableCash,
      row => row.contributionLedger.allocationCashBasis,
      'during-year', { applicable: row => !row.retirementSettlement, summary: copy.allocation, sources: () => [{ label: copy.allocationBasis, field: 'contributionLedger.allocationCashBasis', granularity: 'year' }],
        formula: row => (['fhsaContributions', 'employeeContributions', 'voluntaryContributions', 'scheduledRrspBudgeted', 'unallocated'] as const).map(field => ({
          label: labels[field], sourceId: canonicalSheetId('value', 'cash', field), field,
          value: field === 'scheduledRrspBudgeted' ? row.contributionLedger.scheduledRrspBudgeted : row.cashLedger[field],
          direction: 'add', unit: 'CAD', basis: 'nominal-CAD',
        })),
      }),
    make(canonicalSheetId('value', 'cash', 'suppliedNetCash'), labels.suppliedNetCash,
      row => row.cashLedger.income + row.cashLedger.benefits - row.cashLedger.tax - row.cashLedger.spending - row.cashLedger.debtPayments,
      'during-year', { applicable: row => !row.retirementSettlement, supplied: true, summary: copy.suppliedCash,
        formula: row => (['income', 'benefits', 'tax', 'spending', 'debtPayments'] as const).map(field => ({
          label: labels[field], sourceId: canonicalSheetId('value', 'cash', field), field, value: row.cashLedger[field],
          direction: field === 'income' || field === 'benefits' ? 'add' : 'subtract', unit: 'CAD', basis: 'nominal-CAD',
        })),
      }),
    ...(['spendingDue', 'spendingFunded', 'spendingUnmet'] as const).map(field => make(canonicalSheetId('value', 'retirement', field), ({ spendingDue: text('Spending due', 'Dépenses dues', '应付支出'), spendingFunded: text('Spending funded', 'Dépenses financées', '已筹资支出'), spendingUnmet: text('Unmet spending', 'Dépenses non financées', '未满足支出') })[field], row => row.retirementSettlement?.[field] ?? null, 'during-year', {
      applicable: row => !!row.retirementSettlement, inapplicable: 'workingYear',
      sources: row => [{ label: text('Retirement spending input, indexed at start CPI', 'Dépenses de retraite indexées à l’IPC initial', '退休支出输入，按年初 CPI 换算'), field: 'budget.retirementSpending', granularity: 'input' }, ...Object.keys(row.byAccount).map(accountId => ({ label: labels.withdrawal, id: `annual:${row.year}:withdrawal:${accountId}`, field: 'withdrawal', granularity: 'event' as const }))],
      formula: row => field === 'spendingFunded' ? fundedFormula(row) : field === 'spendingUnmet' ? [
        { label: text('Spending due', 'Dépenses dues', '应付支出'), field: 'spendingDue', value: row.retirementSettlement!.spendingDue, direction: 'add', unit: 'CAD', basis: 'nominal-CAD' },
        { label: text('Spending funded', 'Dépenses financées', '已筹资支出'), field: 'spendingFunded', value: row.retirementSettlement!.spendingFunded, direction: 'subtract', unit: 'CAD', basis: 'nominal-CAD' },
      ] : [{ label: text('Indexed spending due', 'Dépenses indexées dues', '按 CPI 换算的应付支出'), field: 'spendingDue', value: row.retirementSettlement!.spendingDue, direction: 'add', unit: 'CAD', basis: 'nominal-CAD' }],
    })),
    ...(['opening', 'contribution', 'withdrawal', 'returnAmount'] as const).map(field =>
      make(canonicalSheetId('value', 'accounts', field), labels[field], row => Object.values(row.byAccount).reduce((sum, a) => sum + a[field], 0), field === 'opening' ? 'opening' : 'during-year')),
    make(canonicalSheetId('value', 'assets'), labels.assets, household, 'closing'),
    make(canonicalSheetId('value', 'netWorth'), labels.netWorth, row => household(row) + Object.values(row.byProperty).filter(p => p.held).reduce((sum, p) => sum + p.closing, 0) - Object.values(row.byDebt).reduce((sum, d) => sum + d.closing, 0), 'closing'),
    bridge('accounts', null, household),
    make(canonicalSheetId('value', 'retirement'), labels.retirement, row => row.retirementSettlement?.spendingFunded ?? null, 'during-year', { applicable: row => !!row.retirementSettlement, inapplicable: 'workingYear' }),
    make(canonicalSheetId('value', 'estate'), labels.estate, () => null, 'terminal', { applicable: row => row.year === coverage.terminalYear, inapplicable: 'nonTerminal' }),
    ...(['scheduledPlanned', 'scheduledApplied', 'scheduledRetained', 'appliedTotal'] as const).map(field => make(canonicalSheetId('value', 'contributions', field), labels[field], row => row.contributionLedger[field], 'during-year', { memo: true, postingDetail: field === 'appliedTotal' })),
  ])]
  for (const [index, id] of Object.keys(coverage.state.byPerson).entries()) {
    const entity = { kind: 'person' as const, id }
    rows.push(group(canonicalSheetId('group', 'person', id), numbered(labels.person, index), [...(['age', 'income', 'earnedIncome', 'benefits', 'tax', 'spending', 'taxableIncome'] as const).map(field =>
      make(canonicalSheetId('value', 'person', id, field), labels[field], row => row.byPerson[id][field], 'during-year', { entity, supplied: field !== 'age', unit: field === 'age' ? 'years' : 'CAD', taxBasis: field === 'taxableIncome' })),
      make(canonicalSheetId('value', 'person', id, 'contributed'), labels.contributed, row => row.contributionLedger.postings.filter(p => p.contributorId === id).reduce((sum, p) => sum + p.amount, 0), 'during-year', { entity, memo: true }),
      group(canonicalSheetId('group', 'person', id, 'accounts'), labels.owned, [...(['opening', 'contribution', 'withdrawal', 'returnAmount', 'closing'] as const).map(field =>
        make(canonicalSheetId('value', 'person', id, 'accounts', field), labels[field], row => Object.values(row.byAccount).filter(a => a.ownerId === id).reduce((sum, a) => sum + a[field], 0), field === 'opening' ? 'opening' : field === 'closing' ? 'closing' : 'during-year', { entity })),
        bridge('personAccounts', id, row => Object.values(row.byAccount).filter(a => a.ownerId === id).reduce((sum, a) => sum + a.closing, 0), entity),
      ], entity),
    ], entity))
  }
  for (const [index, id] of Object.keys(coverage.state.byAccount).entries()) {
    const entity = { kind: 'account' as const, id }
    rows.push(group(canonicalSheetId('group', 'account', id), numbered(labels.account, index), [
      ...(['opening', 'contribution', 'withdrawal', 'returnAmount', 'closing'] as const).map(field => make(canonicalSheetId('value', 'account', id, field), labels[field], row => row.byAccount[id][field], field === 'opening' ? 'opening' : field === 'closing' ? 'closing' : 'during-year', { entity })),
      bridge('account', id, row => row.byAccount[id].closing, entity),
      make(canonicalSheetId('value', 'account', id, 'acb'), labels.acb, row => { const fact = row.byAccount[id].acb; return fact.status === 'known' ? fact.value : null }, 'closing', { entity, taxBasis: true }),
    ], entity))
  }
  for (const [index, id] of Object.keys(coverage.state.byDebt).entries()) {
    const entity = { kind: 'debt' as const, id }
    rows.push(group(canonicalSheetId('group', 'debt', id), numbered(labels.debt, index), [...(['opening', 'interest', 'principal', 'payment', 'closing'] as const).map(field => make(canonicalSheetId('value', 'debt', id, field), labels[field], row => row.byDebt[id][field], field === 'opening' ? 'opening' : field === 'closing' ? 'closing' : 'during-year', { entity })), bridge('debt', id, row => row.byDebt[id].closing, entity)], entity))
  }
  for (const [index, id] of Object.keys(coverage.state.byProperty).entries()) {
    const entity = { kind: 'property' as const, id }
    rows.push(group(canonicalSheetId('group', 'property', id), numbered(labels.property, index), [...(['opening', 'growth', 'closing'] as const).map(field => make(canonicalSheetId('value', 'property', id, field), labels[field], row => row.byProperty[id][field], field === 'opening' ? 'opening' : field === 'closing' ? 'closing' : 'during-year', { entity, applicable: row => row.byProperty[id].held })), bridge('property', id, row => row.byProperty[id].closing, entity, row => row.byProperty[id].held)], entity))
  }
  return { ...context, title: text('Canonical annual ledger', 'Registre annuel canonique', '标准年度账本'), scope: coverage.evaluationBasis === 'canonical-retirement' ? text('Internal canonical retirement settlement using production tax rules. Funded spending and unmet spending are separate; future mandatory rules and estate settlement remain unsupported. No FIRE conclusion is available.', 'Règlement interne de retraite selon les règles fiscales de production. Dépenses financées et non financées distinctes; règles obligatoires futures et succession non prises en charge. Aucune conclusion FIRE.', '使用生产税务规则的内部标准退休结算。已筹资及未满足支出分列；未来强制规则和遗产结算尚不支持。不提供 FIRE 结论。') : copy.scope,
    baseYear: coverage.baseYear, years, rows, resolveExplanation: reference => explanations.get(reference)?.() }
}
