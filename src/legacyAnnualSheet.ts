import type { Inputs, ProjectionResult } from './engine'
import { annualGapLabel, annualTaxLimits, annualTaxLimitationCopy, joinSheetSentences, accountLabels, stageIds, stageLabels, transactionLabels, propertyLabel, joinSheetText, sheetText as text } from './annualSheetLegacyCopy'
import type { AnnualSheetCell, AnnualSheetExplanation, AnnualSheetModel, AnnualSheetRow, AnnualSheetText } from './annualSheet'

export const annualDetailsTitle = text('Annual financial details', 'Détails financiers annuels', '逐年财务明细')
const fieldLabels: Record<string, AnnualSheetText> = {
 cpp: text('CPP/QPP', 'RPC/RRQ', 'CPP/QPP'), oas: text('OAS after recovery', 'SV après récupération', 'OAS（扣回后）'),
 gis: text('GIS including Allowance', 'SRG incluant Allocation', 'GIS（含配偶津贴）'), ccb: text('CCB', 'ACE', 'CCB'),
 rent: text('Net rent before income tax', 'Loyer net avant impôt', '所得税前净租金'), pension: text('Employer pension', 'Pension d’employeur', '雇主养老金'),
 extraIncome: text('Retirement side income', 'Revenu complémentaire à la retraite', '退休兼职收入'), tax: text('Modeled tax (includes account deductions)', 'Impôt modélisé (inclut déductions des comptes)', '模型税额（含账户扣税）'),
 netCash: text('After-tax cash available', 'Trésorerie disponible après impôt', '税后可用现金'), debtPayment: text('Debt payment (scheduled with modeled adjustments)', 'Paiement prévu avec ajustements modélisés', '计划还债金额（含模型调整）'), shortfall: text('Spending shortfall', 'Déficit de dépenses', '支出缺口'),
 estateTax: text('Terminal tax', 'Impôt final', '终年税'), probateFee: text('Estate administration fee', 'Frais successoraux', '遗产管理费'), estateValue: text('Net estate', 'Succession nette', '净遗产'),
}
const limits = text('Household estimate. Salary, working-year living expenses and working-year tax are not modeled; net savings is the budget boundary. Account ownership and staggered retirement are unavailable. Projection ends at the primary person’s life expectancy; no survivor phase. Changes at recording points are net position changes, not a complete cash ledger.', 'Estimation du ménage. Salaire, dépenses et impôt du travail non modélisés; épargne nette comme limite budgétaire. Attribution et retraites décalées indisponibles. Fin à l’espérance de vie du titulaire; aucune phase de survivant. Variations de positions, pas un registre complet de trésorerie.', '家庭汇总估算。工作期未建模工资、生活费和完整税额；以净储蓄为预算边界。逐人归属和错峰退休不可计算。以本人寿命为终点，无幸存者阶段。记账点变动为净头寸变化，并非完整现金账。')

/** Consumes the main run only; never invokes a projection or invents person splits. */
export function legacyAnnualSheet(result: ProjectionResult, inputs: Inputs, context: { scenarioId: string; revision: string | number; disclosures?: AnnualSheetText[] }): AnnualSheetModel {
  const rows = result.rows
  const years = rows.flatMap(row => row.annualDetails ? [{ year: row.annualDetails.year, realFactor: 1 / row.annualDetails.factor, openingRealFactor: 1 / row.annualDetails.openingFactor }] : [])
  const stageNames = Object.keys(stageLabels)
  const accumulationGapReason = text('Accumulation all-cost spending gap is not computed: this path uses net savings and has no modeled living-cost target. Recorded event financing gaps remain available separately.', 'Le déficit total de dépenses en accumulation n’est pas calculé: ce parcours utilise l’épargne nette sans objectif de dépenses de vie modélisé. Les déficits de financement des événements restent disponibles séparément.', '积累期总支出缺口未计算：此路径采用净储蓄，未建模生活费目标。已记账事件融资缺口仍单独提供。')
  const missingReason = (id: string, row: typeof rows[number]): AnnualSheetText => {
    if (id === 'shortfall' && row.phase === 'accumulation') return accumulationGapReason
    if (['funding.','purchaseFunding.','housingFunding.','sale.','debtSource.','debtEvent.'].some(prefix=>id.startsWith(prefix))) return text('No transaction or active schedule for this source in this year.','Aucune transaction ou échéancier actif pour cette source cette année.','此来源在该年没有交易或有效计划。')
    if (id === 'partnerAge' && !inputs.partner) return text('No partner in this scenario.','Aucun conjoint dans ce scénario.','此情景没有伴侣。')
    if (id === 'ccb' && row.phase === 'accumulation') return text('Working CCB is folded into input net savings; no separate entitlement is priced.','L’ACE au travail est incluse dans l’épargne nette saisie; aucun droit calculé séparément.','工作期 CCB 假定已包含在输入净储蓄内，未单独计算资格。')
    if (id === 'gis' && row.phase === 'accumulation') return text('Working GIS/Allowance is not priced; employment income is unknown.','SRG/Allocation au travail non calculé; revenu d’emploi inconnu.','工作期 GIS／配偶津贴未定价，就业收入未知。')
    if (['estateTax','estateValue','probateFee'].includes(id)) return row !== rows.at(-1) ? text('Applies only at the terminal year.','Applicable uniquement à l’année finale.','仅适用于终年。') : text('Terminal tax is unsupported; net estate cannot be verified from the available closing facts.','Impôt final non pris en charge; succession nette non vérifiable avec les faits disponibles.','终年税不可计算；现有结算事实不足以验证净遗产。')
    if (id === 'oas') return text('Working OAS is gross on its own row; recovery is not priced.','La SV brute au travail figure séparément; récupération non calculée.','工作期 OAS 毛额另列，未计算扣回。')
    if (id === 'oasGross') return text('Gross working-year OAS applies only during accumulation.','SV brute au travail applicable seulement en accumulation.','工作期 OAS 毛额仅适用于积累期。')
    if (id === 'hbp.unpaidTax') return text('Retirement HBP income is included in the withdrawal tax evaluation; its separate tax increment is unavailable.','Le revenu RAP de retraite est inclus dans l’évaluation fiscale des retraits; impôt distinct indisponible.','退休 HBP 应税收入已计入提款税评估；无法取得独立税额增量。')
    if (id === 'debtFundedPrincipal') return text('Ordinary debt amortizes on a schedule even when resources are exhausted; actual funded principal is unavailable.','La dette ordinaire suit un échéancier même sans ressources; capital réellement financé indisponible.','即使资金不足，普通负债仍按计划摊销；实际已付本金不可取得。')
    return limits
  }
  const missingStatus = (id: string, row: typeof rows[number], timing: AnnualSheetCell['timing']): AnnualSheetCell['status'] =>
    id === 'shortfall' && row.phase === 'accumulation' ? 'not-computed' :
    ['funding.','purchaseFunding.','housingFunding.','sale.','debtSource.','debtEvent.'].some(prefix=>id.startsWith(prefix)) || id === 'partnerAge' && !inputs.partner || timing === 'terminal' && row !== rows.at(-1) || id === 'oas' && row.phase === 'accumulation' || id === 'oasGross' && row.phase !== 'accumulation' || id === 'savings' && row.phase !== 'accumulation' ? 'not-applicable' : 'unknown'
  const make = (id: string, label: AnnualSheetText, get: (row: typeof rows[number]) => number | null | undefined, timing: AnnualSheetCell['timing'] = 'during-year', unit: AnnualSheetCell['unit'] = 'CAD', nominal = false, options: { alreadyNominal?: boolean; realFactor?: (row: typeof rows[number]) => number; realValue?: (row: typeof rows[number]) => number; status?: AnnualSheetCell['status']; summary?: AnnualSheetText } = {}): AnnualSheetRow => ({
    id, label, cells: Object.fromEntries(rows.flatMap(row => {
      const d = row.annualDetails
      if (!d) return []
      const openingEvent = id.startsWith('purchaseFunding.') && !id.endsWith('.firstYearCostFromSavings') || id.startsWith('sale.') || id.startsWith('debtEvent.') || id.startsWith('funding.purchase:') && !id.endsWith('.firstYearCostFromSavings') || id.startsWith('funding.sale:') && !id.includes(':tax:') || /\.change\.(opening-transfers-purchase|property-sale)$/.test(id)
      const cellTiming = openingEvent ? 'opening' : timing
      // Opening positions carry last closing's factor; opening events are
      // current-year transactions and use the current opening event clock.
      const nativeFactor = cellTiming === 'opening' && !openingEvent ? d.openingFactor : d.factor
      const value = get(row)
      return [[d.year, { value: value == null ? null : value * (unit === 'CAD' && !nominal && !options.alreadyNominal ? nativeFactor : 1), unit,
        status: value == null || !Number.isFinite(value) ? missingStatus(id, row, cellTiming)
          : options.status ?? (unit === 'years' || id === 'accumulation' ? 'calculated' : 'estimated'), timing: cellTiming,
        ...(options.realFactor ? { realFactor: options.realFactor(row) } : openingEvent ? { realFactor: 1 / d.factor } : {}),
        ...(options.realValue ? { realValue: options.realValue(row) } : id.endsWith('.inflation') ? { realValue: 0 } : {}),
        basis: nominal ? 'nominal-tax-basis' : 'nominal-CAD',
        nativeBasis: nominal ? text('Nominal CAD tax basis','Base fiscale nominale CAD','名义加元税基') : options.alreadyNominal ? text('Contractual nominal CAD','CAD nominaux contractuels','合同名义加元') : text('Legacy base-year CAD','CAD réels hérités de l’année de base','旧模型基准年实际加元'),
        conversion: nominal ? text('No conversion: nominal ACB','Aucune conversion: PBR nominal','不换算：名义 ACB') : options.alreadyNominal ? text('Already nominal; real display uses the selected timing factor once','Déjà nominal; facteur réel appliqué une fois selon la date','已为名义值；实际显示按时点因子换算一次') : text(`Native × ${nativeFactor}; carried positions use the prior closing factor, opening events use the current factor`, `Valeur native × ${nativeFactor}; positions reportées au facteur précédent, événements initiaux au facteur courant`, `原生值 × ${nativeFactor}；承接头寸用上年期末因子，期初事件用当年因子`),
        explanationRefs: [`${d.year}:${id}`], reason: value == null ? options.summary ?? missingReason(id, row) : undefined,
      } satisfies AnnualSheetCell]]
    })),
  })
  const positions = ['tfsa', 'rrsp', 'nonReg', 'fhsa', 'locked', 'property']
  const closing = (r: typeof rows[number], key: string) => key === 'fhsa' ? r.fhsaBalance : key === 'locked' ? r.lockedRetirementBalance : key === 'property' ? r.propertyValue : r.balances[key as keyof typeof r.balances]
  const accountRows: AnnualSheetRow[] = positions.map(key => ({ id: key, label: accountLabels[key], kind: 'group', initiallyExpanded: false, children: [
    make(`${key}.opening`, joinSheetText(accountLabels[key], text('Opening', 'Ouverture', '期初')), r => r.annualDetails?.opening[key], 'opening'),
    make(`${key}.inflation`, joinSheetText(accountLabels[key], text('Inflation translation (not return or cash)', 'Conversion inflation (ni rendement ni trésorerie)', '通胀换算（非收益或现金）')), r => r.annualDetails ? r.annualDetails.opening[key] * (1 - r.annualDetails.openingFactor / r.annualDetails.factor) : null),
    ...stageNames.map(label => make(`${key}.change.${stageIds[label]}`, joinSheetText(accountLabels[key], stageLabels[label] ?? label), r => r.annualDetails?.changes.find(c => c.label === label)?.amounts[key] ?? 0)),
    make(`${key}.closing`, joinSheetText(accountLabels[key], text('Closing', 'Clôture', '期末')), r => closing(r, key), 'closing'),
  ] }))
  const values: AnnualSheetRow[] = [
    make('age', text('Primary age', 'Âge du titulaire', '本人年龄'), r => r.age, 'during-year', 'years'),
    make('partnerAge', text('Partner age (no separate retirement model)', 'Âge du conjoint (retraite séparée indisponible)', '伴侣年龄（未支持错峰退休）'), r => inputs.partner ? inputs.partner.currentAge + r.age - inputs.currentAge : null, 'during-year', 'years'),
    make('accumulation', text('Accumulation phase (1=yes)', 'Accumulation (1=oui)', '积累期（1=是）'), r => r.phase === 'accumulation' ? 1 : 0, 'during-year', 'number'),
    make('salary', text('Salary / working-year living costs', 'Salaire / dépenses du travail', '工资／工作期生活费'), () => null),
    make('savings', text('Input net savings budget', 'Budget d’épargne nette saisi', '输入净储蓄预算'), r => r.phase === 'accumulation' ? inputs.annualSavings : null),
    make('target', text('All-cost spending target', 'Objectif de dépenses total', '总支出目标'), r => r.annualDetails?.spendingTarget),
    ...(['cpp','oas','gis','ccb','rent','pension','extraIncome','tax','netCash','debtPayment','shortfall'] as const).map(key => make(key, fieldLabels[key] ?? key, r => ['netCash','oas','gis','ccb','shortfall'].includes(key) && r.phase === 'accumulation' ? null : r[key])),
    make('oasGross', text('Working OAS gross (recovery not priced)', 'SV brute au travail (récupération non calculée)', '工作期 OAS 毛额（未计扣回）'), r => r.phase === 'accumulation' ? r.oas : null),
    make('debtInterest', text('Scheduled interest on held debt', 'Intérêts prévus des dettes conservées', '持有负债计划利息'), r => r.annualDetails?.debtInterest),
    make('debtPrincipal', text('Scheduled principal (before payment reconciliation)', 'Capital prévu (avant rapprochement du paiement)', '计划本金（实际支付调整前）'), r => r.annualDetails?.debtPrincipal),
    make('debtOpening', text('Opening debt carried from prior closing', 'Dette initiale reportée', '承接上年期末的期初负债'), r => { const i = rows.indexOf(r); return i > 0 ? rows[i-1].debtBalance : (inputs.debts ?? []).reduce((s,d)=>s+d.balance,0) + (inputs.principalResidence?.mode !== 'planned' ? inputs.principalResidence?.mortgage?.balance ?? 0 : 0) + (inputs.investmentProperties ?? []).reduce((s,p)=>s+(p.mortgage?.balance ?? 0),0) }, 'opening'),
    make('debtBalance', text('Closing debt', 'Dette finale', '期末负债'), r => r.debtBalance, 'closing'),
    make('eventGap', text('Event financing gap', 'Déficit de financement des événements', '事件融资缺口'), r => r.unfundedObligations.reduce((sum,g) => sum + g.amount, 0)),
    make('acb', text('Non-registered ACB (nominal tax basis)', 'PBR non enregistré (base fiscale nominale)', '非注册账户 ACB（名义税基）'), r => r.annualDetails?.nonRegAcbNominal, 'closing', 'CAD', true),
    make('netWorth', text('Closing net worth', 'Valeur nette finale', '期末净资产'), r => Object.values(r.balances).reduce((s,v)=>s+v,0)+r.fhsaBalance+r.lockedRetirementBalance+r.propertyValue-r.debtBalance, 'closing'),
    ...(['estateTax','probateFee','estateValue'] as const).map(key => make(key, fieldLabels[key] ?? key, r => r === rows.at(-1) && (key === 'probateFee' || result.terminalTaxStatus !== 'unsupported') ? result[key] : null, 'terminal')),
  ]
  for (const key of ['tfsa', 'rrsp', 'nonReg'] as const) {
    values.push(make(`withdrawals.${key}`, joinSheetText(accountLabels[key], text('Regular gross withdrawals','Retraits bruts réguliers','常规毛提款')), r => r.withdrawals[key]))
    for (const field of ['purchaseFunding','housingFunding'] as const)
      values.push(make(`${field}.gross.${key}`, joinSheetText(accountLabels[key], transactionLabels[field], transactionLabels.grossWithdrawals), r => r[field]?.grossWithdrawals[key]))
  }
  const sales = new Set(rows.flatMap(r => r.annualDetails?.sales.map(s => s.field) ?? []))
  for (const field of sales) for (const key of ['owed','proceeds','cashNeeded'] as const)
    values.push(make(`sale.${field}.${key}`, joinSheetText(propertyLabel(field), transactionLabels[key]), r => r.annualDetails?.sales.find(s=>s.field===field)?.[key]))
  const eventRows = ['purchaseFunding','housingFunding'] as const
  for (const field of eventRows) {
    const keys = new Set(rows.flatMap(r => r[field] ? Object.keys(r[field]!).filter(k => typeof (r[field] as unknown as Record<string, unknown>)[k] === 'number') : []))
    for (const key of keys) values.push(make(`${field}.${key}`, joinSheetText(transactionLabels[field], transactionLabels[key] ?? key), r => (r[field] as unknown as Record<string, number> | null)?.[key]))
  }
  // Contractual debt uses the stream's settlement factor F(t+1), whereas
  // legacy result charts scale the same real number by F(t). Keep both.
  const inflationStep = 1 + (inputs.inflation ?? .021)
  const scheduled = (r: typeof rows[number], field: 'opening'|'borrowing'|'saleDischarge'|'payment'|'interest'|'closing') => {
    const d = r.annualDetails
    return d ? d.debtSchedule.reduce((sum, item) => sum + item[field], 0) * d.factor * (['opening','borrowing','saleDischarge'].includes(field) ? 1 : inflationStep) : null
  }
  const nominalRow = (id: string, label: AnnualSheetText, get: (r: typeof rows[number]) => number | null, timing: AnnualSheetCell['timing'] = 'during-year') => {
    const opening = timing === 'opening' || id === 'debtContractBorrowing' || id === 'debtContractSaleDischarge' || /debtSource\..*\.(borrowing|saleDischarge)$/.test(id)
    return make(id, label, get, opening ? 'opening' : timing, 'CAD', false, {
      alreadyNominal: true,
      realFactor: r => 1 / (r.annualDetails!.factor * (opening ? 1 : inflationStep)),
      ...(id === 'debtContractInflation' ? { realValue: (r: typeof rows[number]) => -(scheduled(r,'opening')! + scheduled(r,'borrowing')! - scheduled(r,'saleDischarge')!) / r.annualDetails!.factor * (1 - 1 / inflationStep) } : {}),
      ...(id === 'debtDisplayTranslation' ? { realValue: () => 0 } : {}),
      ...(id === 'debtOpeningTranslation' ? { realValue: (r: typeof rows[number]) => {
        const i = rows.indexOf(r)
        const carried = i > 0 ? rows[i-1].debtBalance : values.find(v=>v.id==='debtOpening')!.cells![r.annualDetails!.year].value!
        return scheduled(r,'opening')! / r.annualDetails!.factor - carried
      } } : {}),
    })
  }
  values.push(
    nominalRow('debtContractOpening', text('Scheduled contractual opening debt (before sales)', 'Dette contractuelle initiale prévue (avant ventes)', '计划合同期初负债（出售前）'), r => scheduled(r,'opening'), 'opening'),
    nominalRow('debtOpeningTranslation', text('Carried opening to scheduled-only basis difference (not cash; excludes retained obligations)', 'Écart entre ouverture reportée et échéancier seul (sans trésorerie; exclut obligations conservées)', '承接期初至仅计划口径差额（非现金；不含保留欠款）'), r => { const i = rows.indexOf(r); const carried = i > 0 ? rows[i-1].debtBalance * r.annualDetails!.openingFactor : (values.find(v=>v.id==='debtOpening')?.cells?.[r.annualDetails!.year]?.value ?? 0); return scheduled(r,'opening')! - carried }, 'opening'),
    nominalRow('debtContractBorrowing', text('Scheduled new mortgage borrowing', 'Nouvel emprunt hypothécaire prévu', '计划新增房贷'), r => scheduled(r,'borrowing')),
    nominalRow('debtContractSaleDischarge', text('Opening lien removed from schedule at sale (not proof of payment)', 'Hypothèque retirée de l’échéancier à la vente (paiement non confirmé)', '出售时从计划移除的期初抵押（并非实付证据）'), r => scheduled(r,'saleDischarge')),
    nominalRow('debtContractPayment', text('Contractual scheduled payment (not confirmed funded)', 'Paiement contractuel prévu (financement non confirmé)', '合同计划还款（未确认实付）'), r => scheduled(r,'payment')),
    nominalRow('debtContractInterest', text('Contractual scheduled interest', 'Intérêts contractuels prévus', '合同计划利息'), r => scheduled(r,'interest')),
    nominalRow('debtContractPrincipal', text('Contractual scheduled principal (not confirmed funded)', 'Capital contractuel prévu (financement non confirmé)', '合同计划本金（未确认实付）'), r => scheduled(r,'payment')! - scheduled(r,'interest')!),
    nominalRow('debtContractInflation', text('Contractual purchasing-power change (real display only; not cash)', 'Variation du pouvoir d’achat contractuel (affichage réel seulement; sans trésorerie)', '合同购买力变化（仅实际显示；非现金）'), () => 0),
    nominalRow('debtContractClosing', text('Contractual scheduled closing debt', 'Dette contractuelle finale prévue', '合同计划期末负债'), r => scheduled(r,'closing'), 'closing'),
    nominalRow('debtScheduleAdjustment', text('Schedule maturity adjustment (not a cash payment)', 'Ajustement d’échéance (pas un paiement)', '计划到期调整（非现金支付）'), r => scheduled(r,'closing')! - (scheduled(r,'opening')! + scheduled(r,'borrowing')! - scheduled(r,'saleDischarge')! + scheduled(r,'interest')! - scheduled(r,'payment')!)),
    nominalRow('debtDisplayTranslation', text('Contract-to-legacy closing basis translation (not cash)', 'Conversion de clôture contractuelle vers base héritée (sans trésorerie)', '合同期末至旧显示口径换算（非现金）'), r => scheduled(r,'closing')! * (1 / inflationStep - 1), 'closing'),
    make('debtRetainedSale', text('Retained unpaid sale obligations', 'Obligations de vente impayées conservées', '保留的未付出售义务'), r => r.annualDetails?.retainedDebt.sale, 'closing'),
    make('debtRetainedMortgage', text('Retained planned-mortgage arrears', 'Arriérés hypothécaires prévus conservés', '保留的计划房贷欠款'), r => r.annualDetails?.retainedDebt.mortgage, 'closing'),
    make('debtFundedPrincipal', text('Actually funded principal (unavailable for ordinary debt)', 'Capital réellement financé (indisponible pour dette ordinaire)', '实际已付本金（普通负债不可取得）'), () => null),
    make('livingTarget', text('Retirement living-cost target', 'Objectif de dépenses de retraite', '退休生活费目标'), r => r.annualDetails?.cash?.living),
    make('debtTarget', text('Debt included in spending target (before funding adjustments)', 'Dette incluse dans l’objectif (avant ajustements)', '支出目标所含还债额（资金调整前）'), r => r.annualDetails?.cash?.debt),
    make('housingTarget', text('Housing cost change included in target', 'Variation du coût du logement incluse', '目标所含住房成本变化'), r => r.annualDetails?.cash?.housing),
    make('payroll', text('Side-income payroll withheld', 'Cotisations prélevées du revenu complémentaire', '兼职收入工资扣款'), r => r.annualDetails?.cash?.payroll),
    make('prepaidPurchaseTax', text('Prepaid tax on opening events (cash-solve credit)', 'Impôt prépayé sur événements initiaux (crédit de trésorerie)', '期初事件预缴税（现金求解抵扣）'), r => r.annualDetails?.cash?.prepaidPurchaseTax),
    make('workingSavings', text('Net savings plus released mortgage payments', 'Épargne nette plus versements hypothécaires libérés', '净储蓄加释放房贷还款'), r => r.annualDetails?.workingSavings),
    ...(['due','repaid','unpaidTax'] as const).map(key => make(`hbp.${key}`, joinSheetText(text('HBP','RAP','HBP'), { due:text('Instalment due','Remboursement dû','应还款'), repaid:text('Repaid into RRSP','Remboursé au REER','还入 RRSP'), unpaidTax:text('Tax on unpaid instalment','Impôt sur remboursement manquant','未还款税额') }[key]), r => key === 'unpaidTax' && r.phase !== 'accumulation' ? null : r.annualDetails?.hbp[key])),
  )
  for (const source of new Set(rows.flatMap(r => r.annualDetails?.debtSchedule.map(d=>d.id) ?? []))) {
    for (const field of ['opening','borrowing','saleDischarge','payment','interest','closing'] as const)
      values.push(nominalRow(`debtSource.${source}.${field}`, joinSheetText(source === 'debts' ? text('General household debts','Dettes générales du ménage','家庭一般债务') : propertyLabel(source), {
        opening:source === 'debts' ? text('Contractual opening debt','Dette contractuelle initiale','合同期初负债') : text('Contractual opening lien','Hypothèque contractuelle initiale','合同期初抵押'), borrowing:text('New borrowing','Nouvel emprunt','新增借款'), saleDischarge:source === 'debts' ? text('Debt removed from schedule','Dette retirée de l’échéancier','从计划移除负债') : text('Lien removed at sale','Hypothèque retirée à la vente','出售移除抵押'), payment:text('Scheduled payment','Paiement prévu','计划还款'), interest:text('Scheduled interest','Intérêts prévus','计划利息'), closing:text('Scheduled closing','Clôture prévue','计划期末'),
      }[field]), r => {
        const d = r.annualDetails, item = d?.debtSchedule.find(i=>i.id===source)
        return d && item ? item[field] * d.factor * (['opening','borrowing','saleDischarge'].includes(field) ? 1 : inflationStep) : null
      }, field === 'opening' ? 'opening' : field === 'closing' ? 'closing' : 'during-year'))
  }
  for (const eventId of new Set(rows.flatMap(r => r.annualDetails?.funding.map(f=>f.eventId) ?? []))) {
    const event = rows.flatMap(r=>r.annualDetails?.funding ?? []).find(f=>f.eventId===eventId)!
    const eventLabel = joinSheetText(propertyLabel(event.field), eventId.startsWith('hbp:') ? text('HBP tax funding','Financement impôt RAP','HBP 税融资') : eventId.includes(':tax:') ? stageLabels['Sale tax funding'] : eventId.startsWith('sale:') ? text('Sale discharge funding','Financement de libération à la vente','出售清偿融资') : transactionLabels.purchaseFunding)
    for (const field of ['firstYearCostFromSavings','firstYearCostFromOpening','withdrawalTax','hbpWithdrawal'] as const)
      values.push(make(`funding.${eventId}.${field}`, joinSheetText(eventLabel, transactionLabels[field]), r => r.annualDetails?.funding.find(f=>f.eventId===eventId)?.allocation[field]))
    for (const account of ['tfsa','rrsp','nonReg'] as const)
      values.push(make(`funding.${eventId}.gross.${account}`, joinSheetText(eventLabel, accountLabels[account], transactionLabels.grossWithdrawals), r => r.annualDetails?.funding.find(f=>f.eventId===eventId)?.allocation.grossWithdrawals[account]))
  }
  for (const event of rows.flatMap(r=>r.annualDetails?.debtEvents ?? [])) {
    const id = `debtEvent.${event.eventId}.${event.kind}`
    if (values.some(row=>row.id===id)) continue
    const item = make(id, joinSheetText(propertyLabel(event.id), event.kind === 'borrowing' ? text('Borrowing recorded at purchase','Emprunt enregistré à l’achat','购房时记账借款') : text('Lien discharged from modeled funds (unpaid remainder excluded)','Hypothèque réglée par fonds modélisés (impayé exclu)','模型资金已清偿抵押（不含未付余款）')), r=>r.annualDetails?.debtEvents.find(e=>e.eventId===event.eventId && e.kind===event.kind)?.amount, 'opening')
    item.entity = {kind:'event',id:event.eventId}
    values.push(item)
  }
  for (const item of values) {
    const funding = rows.flatMap(r=>r.annualDetails?.funding ?? []).find(f=>item.id.startsWith(`funding.${f.eventId}.`))
    if (funding) item.entity = { kind: 'event', id: funding.eventId }
    if (item.id.startsWith('debtSource.')) item.entity = { kind: 'debt', id: item.id.slice('debtSource.'.length, item.id.lastIndexOf('.')) }
  }
  const sourceGroups = new Map<string, AnnualSheetRow>()
  for (const item of values) if (item.entity) {
    const groupId = `${item.entity.kind}:${item.entity.id}`
    if (!sourceGroups.has(groupId)) {
      const funding = rows.flatMap(r=>r.annualDetails?.funding ?? []).find(f=>f.eventId===item.entity!.id)
      const eventYear = rows.find(r=>r.annualDetails?.funding.some(f=>f.eventId===item.entity!.id) || r.annualDetails?.debtEvents.some(event=>event.eventId===item.entity!.id))?.annualDetails?.year
      const yearLabel = eventYear === undefined ? [] : [text(`Year ${eventYear}`, `Année ${eventYear}`, `${eventYear} 年`)]
      sourceGroups.set(groupId, { id:groupId, kind:'group', entity:item.entity, initiallyExpanded:false,
        label:funding ? joinSheetText(propertyLabel(funding.field), text('Recorded event funding','Financement d’événement enregistré','已记账事件融资'), ...yearLabel) : joinSheetText(item.entity.id === 'debts' ? text('General household debts','Dettes générales du ménage','家庭一般债务') : propertyLabel(item.entity.id), item.entity.kind === 'event' ? text('Recorded property transaction','Transaction immobilière enregistrée','已记账房产交易') : text('Contractual schedule','Échéancier contractuel','合同计划'), ...yearLabel),
        children:[] })
    }
    sourceGroups.get(groupId)!.children!.push(item)
  }
  const accountingLimits = text('Debt payment, interest and principal are scheduled, before funding reconciliation; unpaid ordinary debt is not separately settled. Legacy debt streams use an end-of-period inflation factor, including the mortgage origination offset; these rows preserve the main result’s base-year CAD convention and its F(t) display scaling. Net cash includes payroll and prepaid purchase-tax handling; benefits, tax and cash rows must not be added as a cash reconciliation. GIS includes Allowance. Spending shortfall covers all costs and may overlap the event financing gap: never add the two.', 'Dette, intérêts et capital sont prévus avant rapprochement du financement. Les flux de dette hérités utilisent un facteur de fin de période; affichage conforme au résultat principal F(t). La trésorerie inclut cotisations et impôt prépayé; ces lignes ne sont pas additives. Le SRG inclut l’Allocation. Le déficit de dépenses peut recouper celui des événements: ne pas les additionner.', '债务支付、利息与本金为资金调整前的计划值；普通债务欠付未单独结算。旧债务流使用期末通胀因子（含未来房贷起始偏移），本表保留主结果实际币值及 F(t) 显示口径。净现金含工资扣款与预缴购房税处理，福利、税和现金行不可直接相加对账。GIS 含配偶津贴。总支出缺口可能与事件融资缺口重叠，勿相加。')
  return { scenarioId: context.scenarioId, revision: context.revision, title: text('Household annual estimate', 'Estimation annuelle du ménage', '家庭汇总年度估算'), scope: joinSheetSentences(limits, text('All-cost spending and event gaps can overlap; do not add them.','Les déficits de dépenses totales et d’événements peuvent se recouper; ne pas les additionner.','总支出与事件缺口可能重叠，勿相加。'), ...(context.disclosures ?? [])), baseYear: years[0]?.year ?? 2026, years, rows: [...values.filter(row=>!row.entity), ...sourceGroups.values(), ...accountRows],
    jumps: rows.flatMap(r => { const year = r.annualDetails?.year; if (!year) return []; return [
      ...(r.age === inputs.fireAge ? [{ id:'retirement', label:text('Retirement','Retraite','退休'),year,kind:'retirement' as const }] : []),
      ...(r.shortfall > 0 && !rows.some(p=>p.age<r.age&&p.shortfall>0) ? [{id:'living-gap',label:text('First spending gap','Premier déficit de dépenses','首次支出缺口'),year,kind:'living-shortfall' as const,rowId:'shortfall',reason:text('All-cost spending gap; may overlap an event gap.','Déficit total; peut recouper un événement.','总支出缺口；可能与事件缺口重叠。')}] : []),
      ...(r.unfundedObligations.length && !rows.some(p=>p.age<r.age&&p.unfundedObligations.length) ? [{id:'event-gap',label:text('First event gap','Premier déficit événementiel','首次事件缺口'),year,kind:'event-shortfall' as const,rowId:'eventGap',reason:joinSheetSentences(...r.unfundedObligations.map(annualGapLabel)),entityId:r.unfundedObligations[0]?.eventId}] : []),
      ...(r === rows.at(-1) ? [{id:'terminal',label:text('Terminal year','Année finale','终年'),year,kind:'terminal' as const}] : []),
    ] }),
    resolveExplanation: reference => {
      const separator = reference.indexOf(':')
      const year = Number(reference.slice(0, separator))
      const id = reference.slice(separator + 1)
      const row = rows.find(r => r.annualDetails?.year === year)
      const d = row?.annualDetails
      if (!row || !d) return undefined
      const all = [...values, ...accountRows.flatMap(r=>r.children ?? [])]
      const selected = all.find(r=>r.id===id)
      if (!selected) return undefined
      const explanations: Record<string, AnnualSheetText> = {
        salary: limits,
        age: text('Age advances one year per calendar column from the input age.','L’âge avance d’un an par colonne depuis l’âge saisi.','年龄按输入年龄每个日历列递增一岁。'),
        partnerAge: text('Partner input age plus elapsed years; this does not model separate retirement.','Âge du conjoint plus années écoulées; aucune retraite distincte modélisée.','伴侣输入年龄加经过年数；并非错峰退休计算。'),
        oasGross: text('Gross OAS during accumulation. Employment income is unknown; no recovery tax is priced. Saved after the assumed working marginal tax rate.','SV brute en accumulation. Revenu d’emploi inconnu; récupération non calculée. Épargnée après impôt marginal supposé.','积累期 OAS 毛额。就业收入未知，未计算扣回税；按假定工作边际税率扣税后存入。'),
        oas: text('Retirement OAS is net of modeled recovery. Working-year gross OAS is on a separate row.','La SV de retraite est nette de récupération modélisée. La SV brute au travail figure séparément.','退休 OAS 已扣模型扣回额；工作期毛额另列。'),
        gis: row.phase === 'accumulation' ? text('Working-year GIS/Allowance is not priced; zero in the legacy output is not a benefit entitlement calculation.','Le SRG/Allocation au travail n’est pas calculé; zéro hérité ne détermine pas le droit.','工作期 GIS／配偶津贴未定价；旧输出零值并非福利资格计算。') : text('Modeled GIS includes any spousal Allowance; do not add Allowance again.','Le SRG inclut l’Allocation du conjoint; ne pas l’ajouter.','模型 GIS 含配偶津贴，勿再次相加。'),
        ccb: row.phase === 'accumulation' ? text('Working CCB is assumed folded into input net savings; it is not separately priced.','L’ACE au travail est supposée incluse dans l’épargne nette; non calculée séparément.','工作期 CCB 假定已包含在输入净储蓄内，未单独定价。') : text('Retirement CCB uses the anchored payment-period rule pack and modeled family income.','L’ACE utilise la période de prestations de référence et le revenu familial modélisé.','退休 CCB 使用锚定支付期规则及模型家庭收入。'),
        savings: text('Input annual net savings; existing living costs, payroll, tax and debt payments are assumed already covered. An excluded debt-payment budget remains an unverified estimate.','Épargne nette saisie; dépenses, cotisations, impôt et dettes existantes supposés couverts. Un budget excluant les dettes reste non vérifié.','输入年度净储蓄；假定已承担生活费、工资扣款、税和既有还债额。若预算不含还债，仍为未验证估算。'),
        target: text('Living target plus scheduled debt and the planned-home holding-cost change, before any unfunded mortgage reconciliation.','Dépenses de vie plus dette prévue et variation du coût du logement, avant rapprochement d’hypothèque impayée.','生活费目标加计划还债和计划住房持有成本变化；在未付房贷调整之前。'),
        netCash: text('Accepted retirement cash evaluation: benefits, rent, side income and regular gross withdrawals less tax and payroll, plus tax already prepaid on opening events (purchases or sale-lien funding). Reinvested distributions are not spendable cash.','Évaluation acceptée: prestations, loyers, revenu complémentaire et retraits bruts moins impôt et cotisations, plus impôt prépayé sur événements initiaux. Distributions réinvesties non disponibles.','已接受退休现金评估：福利、租金、兼职收入和常规毛提款，减税及工资扣款，加期初事件（购房或出售抵押融资）已预付税。再投资分配不属于可支用现金。'),
        shortfall: row.phase === 'accumulation' ? accumulationGapReason : accountingLimits,
        eventGap: accountingLimits,
        tax: text('Modeled tax, with working marginal-rate deductions and retirement evaluation taxes following the main result. Account deductions are not an additional cash outflow to add again.','Impôt modélisé selon le résultat principal; les prélèvements des comptes ne doivent pas être ajoutés encore comme sortie.','税额遵循主结果工作边际税近似及退休评估；账户扣税不可再次计为现金流出。'),
        estateValue: result.terminalTaxStatus === 'unsupported' ? text('Net estate unavailable because terminal tax is unsupported; a numeric legacy surrogate is intentionally suppressed.','Succession nette indisponible: impôt final non pris en charge; valeur de substitution masquée.','终年税不可计算，因此净遗产未知；不显示旧模型替代数值。') : text('Final net worth less terminal tax and estate administration fee.','Valeur nette finale moins impôt final et frais successoraux.','终年净资产减终年税及遗产管理费。'),
      }
      const cell = (key: string) => all.find(r=>r.id===key)?.cells?.[year]
      const parts = (entries: [string, 'add'|'subtract'][]): NonNullable<AnnualSheetExplanation['formula']> => entries.flatMap(([key,direction]) => {
        const source = all.find(r=>r.id===key), value = cell(key)
        return value?.value != null && Number.isFinite(value.value) ? [{ label: source?.label ?? key, value:value.value, direction, unit:value.unit, basis:value.basis }] : []
      })
      let formula: AnnualSheetExplanation['formula']
      if (id === 'shortfall' && d.spendingTarget !== null && row.shortfall > 0) formula = parts([['target','add'],['netCash','subtract']])
      if (id === 'shortfall' && row.phase !== 'accumulation' && row.shortfall === 0) formula = [{label:text('No all-cost deficit after tolerance','Aucun déficit total après tolérance','计入容差后无总支出缺口'),value:0,direction:'add',unit:'CAD',basis:'nominal-CAD'}]
      if (id === 'eventGap') formula = row.unfundedObligations.map(g=>({label:annualGapLabel(g),sourceId:g.eventId,field:g.field,code:g.reason,value:g.amount*d.factor,direction:'add',unit:'CAD',basis:'nominal-CAD'}))
      if (id === 'target') formula = parts([['livingTarget','add'],['debtTarget','add'],['housingTarget','add']])
      if (id === 'netCash' && d.cash) formula = parts([...(['cpp','oas','gis','ccb','rent','pension','extraIncome','withdrawals.tfsa','withdrawals.rrsp','withdrawals.nonReg'] as const).map(k=>[k,'add'] as [string,'add']), ['tax','subtract'],['payroll','subtract'],['prepaidPurchaseTax','add']])
      if (id === 'debtOpeningTranslation') formula = parts([['debtContractOpening','add'],['debtOpening','subtract']])
      if (id === 'debtContractOpening') formula = parts([['debtOpening','add'],['debtOpeningTranslation','add']])
      if (id === 'debtOpening') {
        const previous = rows[rows.indexOf(row)-1]
        formula = [{ label: previous ? text(`Prior legacy closing (${year-1})`,`Clôture héritée précédente (${year-1})`,`上年旧显示期末（${year-1}）`) : selected.label, value: selected.cells![year].value!, direction:'add', unit:'CAD', basis:'nominal-CAD' }]
      }
      if (id === 'debtContractClosing') formula = parts([['debtContractOpening','add'],['debtContractBorrowing','add'],['debtContractInterest','add'],['debtContractPayment','subtract'],['debtContractSaleDischarge','subtract'],['debtScheduleAdjustment','add'],['debtContractInflation','add']])
      if (id === 'debtBalance') formula = parts([['debtContractClosing','add'],['debtDisplayTranslation','add'],['debtRetainedSale','add'],['debtRetainedMortgage','add']])
      if (id === 'debtContractPrincipal') formula = parts([['debtContractPayment','add'],['debtContractInterest','subtract']])
      if (id === 'netWorth') formula = parts([...positions.map(k=>[`${k}.closing`,'add'] as [string,'add']),['debtBalance','subtract']])
      if (id === 'estateValue' && result.terminalTaxStatus !== 'unsupported') formula = parts([['netWorth','add'],['estateTax','subtract'],['probateFee','subtract']])
      for (const key of positions) if (id === `${key}.closing`) formula = parts([[`${key}.opening`,'add'],[`${key}.inflation`,'add'],...stageNames.map(label=>[`${key}.change.${stageIds[label]}`,'add'] as [string,'add'])])
      const relatedFunding = d.funding.filter(f=>id.includes(f.eventId))
      const relatedGaps = id === 'eventGap' || id === 'shortfall' ? row.unfundedObligations : []
      const available = ['calculated','estimated'].includes(selected.cells![year].status)
      const benefit = id === 'ccb' && row.phase !== 'accumulation' && available
      const taxRelated = ['tax','netCash','estateTax','estateValue','prepaidPurchaseTax','hbp.unpaidTax'].includes(id) || id.endsWith('.withdrawalTax')
      // Only the accepted evaluate() result emits byPersonTax, and only
      // when personProjectionTax returned status 'ok'. The legacy row
      // taxCapability instead carries the run's first failure forward.
      const acceptedPersonTax = row.byPersonTax !== undefined
      const marginalTax = taxRelated && row.phase === 'accumulation' && available && !['estateTax','estateValue'].includes(id)
      const provenance = available ? benefit ? result.benefitRules : taxRelated && !marginalTax ? d.taxRules : undefined : undefined
      const accountKey = positions.find(key=>id.startsWith(`${key}.`))
      const stage = accountKey && stageNames.find(name=>id === `${accountKey}.change.${stageIds[name]}`)
      const operation = accountKey ? id.endsWith('.opening') ? text('Carries the prior nominal closing value unchanged. Base-year opening factor is 1.','Reprend sans changement la clôture nominale précédente. Facteur initial de base = 1.','原样承接上年名义期末值；基准年期初因子为 1。') : id.endsWith('.inflation') ? text('Opening native real position × (F(t) − F(t−1)); translation only, not investment return or cash.','Position initiale réelle native × (F(t) − F(t−1)); conversion seule, ni rendement ni trésorerie.','原生实际期初头寸 ×（F(t) − F(t−1)）；仅为换算，非收益或现金。') : stage ? joinSheetText(stageLabels[stage], text('Actual net position difference across this recording stage. Transfers and purchase changes may include multiple uses; no gross cash split is inferred.','Variation nette observée à cette étape. Transferts et achats peuvent regrouper plusieurs emplois; aucune ventilation brute déduite.','该记账阶段实际净头寸差额。转移及购房变化可能包含多种用途，不推断现金毛额拆分。')) : text('Opening plus inflation translation and named recorded changes; each component is normalized once.','Ouverture plus conversion inflation et variations enregistrées; normalisation unique de chaque composante.','期初加通胀换算及已命名记账变动；各项仅归一化一次。') : undefined
      const debtRelated = id.startsWith('debt') || id.startsWith('sale.')
      return {
        summary: joinSheetText(selected.label, explanations[id] ?? operation ?? (debtRelated ? accountingLimits : selected.cells?.[year]?.reason ?? text('Observed at this row’s legacy recording point; no person allocation is inferred.','Observé au point d’enregistrement hérité; aucune attribution personnelle déduite.','来自该行旧模型记账点；不推断逐人归属。'))),
        formula,
        sources: [
          {label: selected.label, id, granularity:'year'},
          ...(['age','partnerAge','savings','livingTarget'].includes(id) ? [{label:selected.label,id:({age:'currentAge',partnerAge:'partner.currentAge',savings:'annualSavings',livingTarget:'retirementSpending'} as Record<string,string>)[id],granularity:'input' as const}] : []),
          ...(id.endsWith('.opening') && positions.includes(id.split('.')[0]) && row === rows[0] ? [{label:selected.label,id:({tfsa:'balances.tfsa',rrsp:'balances.rrsp',nonReg:'balances.nonReg',fhsa:'fhsa.balance',locked:'lockedRetirement.balance',property:'principalResidence / investmentProperties'} as Record<string,string>)[id.split('.')[0]],granularity:'input' as const}] : []),
          ...(taxRelated ? d.taxLimitations.map(limit=>({label:annualTaxLimitationCopy[limit.code], id:limit.eventId, field:limit.field, code:limit.code, granularity:limit.eventId ? 'event' as const : 'year' as const})) : []),
          ...relatedGaps.map(g=>({label:annualGapLabel(g),id:g.eventId,field:g.field,code:g.reason,granularity:'event' as const})),
          ...relatedFunding.map(f=>({label:propertyLabel(f.field),id:f.eventId,granularity:'event' as const})),
          ...(id.startsWith('purchaseFunding') && row.purchaseFunding ? [{label:transactionLabels.purchaseFunding,id:row.purchaseFunding.eventId,granularity:'event' as const}] : []),
          ...(id.startsWith('housingFunding') && row.housingFunding ? [{label:transactionLabels.housingFunding,id:row.housingFunding.eventId,granularity:'event' as const}] : []),
          ...(marginalTax ? [{label:text(`Legacy flat marginal-rate estimate: ${(inputs.accumulationMarginalRate ?? .35)*100}%`, `Estimation marginale forfaitaire héritée: ${(inputs.accumulationMarginalRate ?? .35)*100}%`, `旧模型固定边际税率估算：${(inputs.accumulationMarginalRate ?? .35)*100}%`), id:inputs.accumulationMarginalRate == null ? 'legacy-default-marginal-rate' : 'accumulationMarginalRate', granularity:inputs.accumulationMarginalRate == null ? 'run' as const : 'input' as const}] : []),
          ...(benefit && result.benefitRules ? [{label:result.benefitRules.paymentPeriod,id:result.benefitRules.rulePackId,granularity:'run' as const}] : []),
        ],
        rulePackage: provenance?.rulePackId,
        taxYear: provenance && !benefit ? d.taxRules.ruleYear : undefined,
        projectionYear: d.year,
        formulaBasis: formula && !debtRelated ? text('Formula components use normalized nominal CAD. Pure nominal-basis translations show zero in real display; ordinary account and cash rows retain the main result’s native real basis.', 'Composantes en CAD nominaux normalisés. Les conversions purement nominales valent zéro en affichage réel; les comptes et la trésorerie conservent la base réelle du résultat principal.', '公式各项为归一化名义加元。纯名义口径换算在实际显示中为零；普通账户及现金各行保留主结果原生实际币值口径。') : formula ? text('Formula components are normalized nominal CAD. Contractual rows use their own settlement factors in real display; the purchasing-power row supplies the real-only inflation change. Basis-translation rows are not cash flows.', 'Composantes en CAD nominaux normalisés. Les lignes contractuelles utilisent leurs facteurs de règlement; la ligne de pouvoir d’achat fournit l’inflation réelle seule. Les conversions ne sont pas des flux de trésorerie.', '公式各项为归一化名义加元。合同各行在实际显示中采用自身结算因子；购买力行补充仅实际币值下的通胀变化。口径换算不是现金流。') : undefined,
        limitations: [...(debtRelated ? [text(`Contractual stream opening × F(t)=${d.factor}; payment/interest/closing × F(t+1)=${d.factor*inflationStep}. Legacy chart closing × F(t)=${d.factor}. A future mortgage keeps its stream origination offset; basis differences are not payments.`, `Ouverture contractuelle × F(t)=${d.factor}; paiements/intérêts/clôture × F(t+1)=${d.factor*inflationStep}. Clôture du graphique × F(t)=${d.factor}. L’hypothèque future conserve le décalage d’origine; écarts de base sans paiements.`, `合同流期初 × F(t)=${d.factor}；还款／利息／期末 × F(t+1)=${d.factor*inflationStep}。旧图表期末 × F(t)=${d.factor}。未来房贷保留起始偏移；口径差额不是支付。`)] : []), ...(debtRelated || id === 'netCash' || id === 'shortfall' || id === 'eventGap' ? [accountingLimits] : []), ...(taxRelated && available ? row.phase === 'accumulation' ? [annualTaxLimits.workingMarginal] : !acceptedPersonTax ? [annualTaxLimits.householdEstimate] : [] : []), ...(taxRelated && available ? [...new Set(d.taxLimitations.map(limit=>limit.code))].map(code=>annualTaxLimitationCopy[code]) : []), ...(available && result.terminalTaxStatus === 'estimated' && ['estateTax','estateValue'].includes(id) && row === rows.at(-1) && result.terminalTaxDisclosure === 'quebecSimplified' ? [annualTaxLimits.quebecTerminal] : [])],
        forwardAssumption: text('Deterministic main result. Future tax and benefit assumptions follow the cited rule pack; no second projection.','Résultat déterministe principal. Hypothèses fiscales et prestations futures selon les règles citées; aucune seconde projection.','确定性主结果。未来税及福利假设遵循所引规则；未进行第二次投影。'),
      }
    },
  }
}
