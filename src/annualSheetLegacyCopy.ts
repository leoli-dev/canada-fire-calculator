import type { AnnualTaxLimitationCode } from './engine/types'
import type { FundingGap } from './engine/funding'
import { fundingGapMessageKey } from './fundingGapMessages'
import type { AnnualSheetText } from './annualSheet'
export const sheetText = (en: string, fr: string, zh: string): AnnualSheetText => ({ en, fr, zh })
export const joinSheetText = (...parts: AnnualSheetText[]): AnnualSheetText => Object.fromEntries(['en','fr','zh'].map(lang => [lang, parts.map(p => typeof p === 'string' ? p : p[lang as 'en'|'fr'|'zh']).join(': ')])) as Exclude<AnnualSheetText, string>
export const accountLabels: Record<string, AnnualSheetText> = {
 tfsa: sheetText('TFSA','CELI','TFSA'), rrsp: sheetText('RRSP / RRIF','REER / FERR','RRSP / RRIF'), nonReg: sheetText('Non-registered','Non enregistré','非注册账户'),
 fhsa: sheetText('FHSA','CELIAPP','FHSA'), locked: sheetText('Locked retirement','Retraite immobilisée','锁定退休账户'), property: sheetText('Real estate','Immobilier','房产'),
}
export const stageLabels: Record<string, AnnualSheetText> = {
 'Opening transfers and purchase funding': sheetText('Opening transfers and purchase funding','Transferts initiaux et financement d’achat','期初转移及购房融资'),
 'Property sale settlement': sheetText('Property sale settlement','Règlement de vente immobilière','房产出售结算'),
 'Sale tax funding': sheetText('Sale tax funding','Financement de l’impôt de vente','出售税融资'),
 'Housing funding and HBP repayment/tax': sheetText('Housing funding and HBP repayment/tax','Financement du logement et remboursement/impôt RAP','住房融资及 HBP 还款／税'),
 'Savings contributions including employer contributions': sheetText('Contributions including employer contributions','Cotisations incluant celles de l’employeur','供款（含雇主供款）'),
 'Distribution tax deducted from account': sheetText('Distribution tax deducted from account','Impôt sur distributions prélevé du compte','账户扣除分配税'),
 'After-tax rent saved': sheetText('After-tax rent saved','Loyer après impôt épargné','存入税后租金'),
 'After-tax benefits saved': sheetText('After-tax benefits saved','Prestations après impôt épargnées','存入税后福利'),
 'Regular gross withdrawals and drain rounding': sheetText('Regular gross withdrawals and drain rounding','Retraits bruts réguliers et arrondi d’épuisement','常规毛提款及清空舍入'),
 'Surplus cash reinvested': sheetText('Surplus cash reinvested','Trésorerie excédentaire réinvestie','再投资结余现金'),
 'Investment return net of fees': sheetText('Investment return net of fees','Rendement net de frais','扣费后投资收益'),
 'Property appreciation': sheetText('Property appreciation','Appréciation immobilière','房产升值'),
}
export const transactionLabels: Record<string, AnnualSheetText> = {
 purchaseFunding: sheetText('Purchase funding','Financement d’achat','购房融资'), housingFunding: sheetText('Housing funding','Financement du logement','住房融资'),
 price: sheetText('Price','Prix','购价'), mortgagePrincipal: sheetText('Mortgage originated','Hypothèque créée','新借房贷'), downPaymentFromFhsa: sheetText('FHSA down payment','Mise de fonds CELIAPP','FHSA 首付'), downPaymentFromAccounts: sheetText('Account down payment','Mise de fonds des comptes','账户首付'),
 firstYearCostFromSavings: sheetText('Cost funded from savings','Coût financé par épargne','储蓄承担成本'), firstYearCostFromOpening: sheetText('Cost funded from opening assets','Coût financé par actifs initiaux','期初资产承担成本'), withdrawalTax: sheetText('Withdrawal tax','Impôt sur retraits','提款税'),
 cost: sheetText('Cost','Coût','成本'), fromSavings: sheetText('From savings','De l’épargne','来自储蓄'), fromOpening: sheetText('From opening assets','Des actifs initiaux','来自期初资产'),
 proceeds: sheetText('Sale proceeds after lien','Produit après hypothèque','扣除抵押贷款的出售所得'), cashNeeded: sheetText('Cash needed to discharge lien','Trésorerie requise pour libérer l’hypothèque','解除抵押所需现金'), owed: sheetText('Opening lien due at sale','Hypothèque due à la vente','出售时应清偿期初抵押'),
 hbpWithdrawal: sheetText('HBP withdrawal','Retrait RAP','HBP 提款'), grossWithdrawals: sheetText('Gross withdrawals','Retraits bruts','毛提款'),
}
export function propertyLabel(field: string): AnnualSheetText {
 const index = /investmentProperties\.(\d+)/.exec(field)?.[1]
 return index == null ? sheetText('Principal residence','Résidence principale','自住房') : sheetText(`Investment property ${Number(index)+1}`,`Immeuble locatif ${Number(index)+1}`,`投资房产 ${Number(index)+1}`)
}

/** Stable identifiers do not depend on which phases occur in a run. */
export const stageIds: Record<string, string> = {
 'Opening transfers and purchase funding': 'opening-transfers-purchase',
 'Property sale settlement': 'property-sale', 'Sale tax funding': 'sale-tax-funding',
 'Housing funding and HBP repayment/tax': 'housing-hbp-funding',
 'Savings contributions including employer contributions': 'contributions',
 'Distribution tax deducted from account': 'distribution-tax',
 'After-tax rent saved': 'rent-saved', 'After-tax benefits saved': 'benefits-saved',
 'Regular gross withdrawals and drain rounding': 'regular-withdrawals',
 'Surplus cash reinvested': 'surplus-reinvested',
 'Investment return net of fees': 'investment-return', 'Property appreciation': 'property-appreciation',
}

/** Compact, native labels share the same reason mapping as validation and results. */
const gapLabels: Record<ReturnType<typeof fundingGapMessageKey>, AnnualSheetText> = {
 valHouseholdExpenseUnfunded: sheetText('One-time household expense shortfall','Déficit de dépense ponctuelle du ménage','家庭一次性支出缺口'),
 valPurchaseInvalid: sheetText('Invalid purchase terms','Conditions d’achat invalides','购房条件无效'),
 valPurchaseMortgageRequired: sheetText('Mortgage terms missing','Conditions hypothécaires manquantes','房贷条件缺失'),
 valFhsaContributionUnfunded: sheetText('FHSA contribution funding gap','Déficit de financement de cotisation CELIAPP','FHSA 供款融资缺口'),
 valContributionsUnfunded: sheetText('Employee contribution funding gap','Déficit de financement de cotisation salariale','雇员供款融资缺口'),
 valSaleDischargeUnfunded: sheetText('Sale mortgage-discharge funding gap','Déficit de financement pour libérer l’hypothèque à la vente','出售抵押清偿融资缺口'),
 valSaleTaxUnfunded: sheetText('Property sale tax funding gap','Déficit de financement de l’impôt sur vente immobilière','房产出售税融资缺口'),
 valHbpTaxUnfunded: sheetText('Tax funding gap on unpaid HBP repayment','Déficit de financement de l’impôt sur remboursement RAP impayé','HBP 未还款税融资缺口'),
 valPurchaseCostUnfunded: sheetText('Housing-cost funding gap','Déficit de financement des frais de logement','住房成本融资缺口'),
 valDownPaymentUnfunded: sheetText('Down-payment funding gap','Déficit de financement de la mise de fonds','首付融资缺口'),
}
export function annualGapLabel(gap: FundingGap): AnnualSheetText {
 if (gap.reason === 'householdExpense') return sheetText('One-time household expense shortfall', 'Déficit de dépense ponctuelle du ménage', '家庭一次性支出缺口')
 const label = gapLabels[fundingGapMessageKey(gap.reason)]
 return /^(principalResidence|investmentProperties)/.test(gap.field) ? joinSheetText(propertyLabel(gap.field), label) : label
}
export const annualTaxLimits = {
 workingMarginal: sheetText('This accumulation year uses an assumed flat marginal tax rate for known income. Employment income and full working-year tax are not modeled.', 'Cette année d’accumulation utilise un taux marginal forfaitaire supposé pour les revenus connus. Le revenu d’emploi et l’impôt complet du travail ne sont pas modélisés.', '本积累年度对已知收入采用假定固定边际税率；未建模就业收入及完整工作期税额。'),
 householdEstimate: sheetText('This year uses the legacy household tax estimate. Person-specific tax attribution or required tax facts are not verified for this year.', 'Cette année utilise l’estimation fiscale héritée du ménage. L’attribution fiscale par personne ou les faits fiscaux requis ne sont pas vérifiés pour cette année.', '本年度采用旧家庭税额估算；该年度逐人税务归属或所需税务事实未获验证。'),
 quebecTerminal: sheetText('The estate figure uses simplified Quebec rules for the final return; treat it as an estimate.', 'La succession utilise des règles québécoises simplifiées pour la déclaration finale; il s’agit d’une estimation.', '遗产数值采用简化魁北克最终报税规则，应视为估算。'),
}
export const joinSheetSentences = (...parts: AnnualSheetText[]): AnnualSheetText => Object.fromEntries(['en','fr','zh'].map(lang => [lang, parts.map(p => typeof p === 'string' ? p : p[lang as 'en'|'fr'|'zh']).join(' ')])) as Exclude<AnnualSheetText, string>

/** Capability limits belong to the detecting year, not to the accepted pricing method. */
export const annualTaxLimitationCopy: Record<AnnualTaxLimitationCode, AnnualSheetText> = {
 saleLienTaxEstimate: sheetText('Sale-lien funding uses the legacy household tax estimate this year. This event-tax approximation is separate from the annual tax calculation.', 'Le financement de libération d’hypothèque à la vente utilise l’estimation fiscale héritée du ménage cette année. Cette approximation fiscale d’événement est distincte du calcul fiscal annuel.', '本年度出售抵押清偿融资采用旧家庭税额估算。该事件税额近似与年度税额计算相互独立。'),
 nonRegLoss: sheetText('A non-registered disposal realized a capital loss this year. Superficial-loss confirmation and owner-specific loss carry are unavailable; tax treatment is unverified.', 'Une cession non enregistrée a réalisé une perte en capital cette année. La confirmation des pertes apparentes et le report par propriétaire sont indisponibles; traitement fiscal non vérifié.', '本年度非注册资产处置实现资本亏损。尚不能确认表面亏损规则及逐人亏损结转，税务处理未获验证。'),
 investmentPropertySale: sheetText('This year’s investment-property sale needs verified building/land allocation and depreciation tax history, even when no taxable gain is priced.', 'La vente immobilière locative de cette année nécessite une répartition bâtiment/terrain et un historique fiscal d’amortissement vérifiés, même sans gain imposable calculé.', '本年度投资房产出售仍需验证建筑／土地分配及折旧税务历史，即使模型未计入应税收益。'),
 saleExpensesExceedValue: sheetText('Selling expenses exceed the property value this year; the legacy preview caps them and does not verify the tax result.', 'Les frais de vente dépassent la valeur immobilière cette année; l’aperçu hérité les plafonne sans vérifier le résultat fiscal.', '本年度出售费用高于房产价值；旧模型将其封顶，税务结果未获验证。'),
 propertyDisposalBasis: sheetText('The property disposition’s tax basis or loss treatment cannot be verified from the available facts this year.', 'La base fiscale ou le traitement des pertes de la cession immobilière ne peut être vérifié avec les faits disponibles cette année.', '现有事实不足以验证本年度房产处置税基或亏损处理。'),
 workingRrifMinimum: sheetText('A live RRIF is held during accumulation this year; working-year minimum-withdrawal cash and tax settlement are not supported.', 'Un FERR actif est détenu en accumulation cette année; le règlement de trésorerie et d’impôt des retraits minimaux au travail n’est pas pris en charge.', '本积累年度持有非零 RRIF；尚不支持工作期最低提款的现金及税务结算。'),
 rrifMinimumUnconfirmed: sheetText('This year’s RRIF minimum could not be confirmed from the account and age-election facts; the preview does not invent a mandatory withdrawal.', 'Le minimum FERR de cette année n’a pu être confirmé à partir du compte et du choix d’âge; aucun retrait obligatoire n’est inventé.', '账户及年龄选择事实不足以确认本年度 RRIF 最低提款；模型不虚构强制提款。'),
 multipleRegisteredAccounts: sheetText('Multiple registered accounts require funding and tax allocation that this annual legacy path does not support.', 'Plusieurs comptes enregistrés nécessitent une répartition de financement et d’impôt non prise en charge par ce parcours annuel hérité.', '多个注册账户需要逐账户融资及税额分配；旧年度路径尚不支持。'),
 personTaxUnsupported: sheetText('The accepted annual tax evaluation could not verify person-specific taxation from this year’s available facts.', 'L’évaluation fiscale annuelle retenue n’a pu vérifier l’imposition par personne à partir des faits disponibles cette année.', '本年度已接受的税额评估无法依据该年现有事实验证逐人税额。'),
 propertyCashSettlement: sheetText('This year’s property-related taxable proceeds, opening withdrawals or rental mortgage interest require event cash and tax settlement that is not yet verified.', 'Les produits immobiliers imposables, retraits initiaux ou intérêts hypothécaires locatifs de cette année nécessitent un règlement d’événement de trésorerie et d’impôt non encore vérifié.', '本年度房产相关应税所得、期初提款或出租房贷利息仍需验证事件现金及税务结算。'),
}
