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
