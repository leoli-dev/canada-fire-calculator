# 🇨🇦 Calculateur FIRE Canada

[English](README.md) · **Français** · [中文](README_CN.md)

Un calculateur FIRE (indépendance financière, retraite anticipée) conçu
**spécifiquement pour les Canadiens**. Les outils génériques de la « règle du 4 % »
ignorent tout ce qui décide réellement d'une retraite anticipée canadienne : le
traitement fiscal des comptes (CELI / REER / non enregistré), le calendrier
RPC/RRQ et SV, les retraits minimums obligatoires du FERR, la récupération de la
SV, l'ordre de décaissement, et le sort du REER au décès. Ce calculateur modélise
tout cela.

**Démo en ligne : <https://leoli-dev.github.io/canada-fire-calculator/>**

**Application 100 % frontale, axée sur la vie privée** : pas de serveur, pas de
compte, pas d'IA — vos chiffres ne quittent jamais le navigateur (persistés en
`localStorage`). Anglais / Français / 中文.

![Vue d'ensemble](docs/screenshots/hero.png)

## Démarrage rapide

```sh
npm install
npm run dev      # serveur de développement
npm test         # 48 tests unitaires du moteur (vitest)
npm run build    # vérification de types + build de production
```

Le moteur de calcul (`src/engine/`) est un module TypeScript pur, sans dépendance
UI — chaque chiffre affiché provient d'une simulation année par année,
déterministe et testée.

## Ce qui est calculé

**Une simulation en trois phases, année par année**, en dollars réels (ajustés à
l'inflation) :

1. **Accumulation** (aujourd'hui → FIRE) : l'épargne après impôt alimente
   CELI / REER / non enregistré selon votre répartition.
2. **Pont** (FIRE → RPC/SV) : la fenêtre à faible revenu. Les dépenses sont
   financées par les retraits selon votre stratégie; chaque année le moteur résout
   par recherche binaire le retrait brut qui produit net vos dépenses cibles.
3. **Pension** (RPC/SV → espérance de vie) : les prestations arrivent; dès 72 ans
   les minimums FERR sont forcés, besoin ou pas.

**Le moteur fiscal** : vrais paliers marginaux fédéral + provincial (ON / QC / BC /
AB, chiffres 2025-26, mis à jour annuellement), montants personnels de base,
abattement québécois, inclusion de 50 % des gains en capital suivie par le PBR,
récupération de la SV par personne et, pour les couples, fractionnement du revenu
sur deux déclarations.

**Stratégies de décaissement**, comparées côte à côte avec vos propres chiffres :

- **Meltdown REER plafonné au premier palier** (défaut) : le REER finance d'abord
  les dépenses, mais seulement selon le besoin et jamais au-delà de la place
  restante dans le premier palier après RPC/SV (un palier par conjoint); le reste
  passe 71 ans et sort via les minimums FERR. Rien n'est retiré juste pour payer
  l'impôt d'avance.
- REER d'abord (agressif), non enregistré d'abord, CELI d'abord — pour voir
  exactement ce que coûte chaque choix.

**Honnêteté successorale** : au décès, le REER/FERR restant est entièrement imposé
dans la dernière année et la moitié des gains non réalisés est imposée (le CELI et
la résidence principale passent libres d'impôt). Les stratégies sont donc classées
par **valeur successorale après impôt** — ou, sous l'objectif **Die with Zero**,
par les dépenses annuelles soutenables maximales.

**Également modélisés** : vente de la résidence principale (libre d'impôt),
vente d'immeuble locatif (gain imposé), estimation RPC/RRQ selon l'historique de
travail (règle des 39 meilleures années), SV selon les années de résidence,
tableaux complets des âges de début RPC 60-70 / SV 65-70, et simulation
Monte-Carlo (1 000 essais à rendements aléatoires dans un web worker) avec
anatomie des échecs.

## Comment remplir

Descendez la colonne de gauche; chaque terme souligné ouvre une explication en
langage clair (voir le tiroir-glossaire ci-dessous).

- **Profil** — âges, province, épargne annuelle après impôt, dépenses de retraite
  nettes souhaitées (pouvoir d'achat d'aujourd'hui; une feuille de dépenses aide à
  les construire). Choisissez un **objectif** : maximiser la succession, ou
  **Die with Zero**. L'hypothèse d'inflation et l'affichage réel/nominal ne
  changent que l'*affichage* — le calcul reste en dollars réels.
- **Ménage** — le mode couple totalise comptes et dépenses et impose le revenu
  fractionné sur les deux conjoints; chacun a son propre calendrier RPC/SV.
- **Comptes** — soldes actuels par enveloppe. Pour le non enregistré, entrez le
  **PBR** (« book cost » chez le courtier) : seul le gain au-dessus est imposé,
  laisser 0 gonfle énormément l'impôt. Les préréglages de répartition d'actifs
  fixent des rendements réels et volatilités réalistes.
- **Immobilier** — résidence principale et immeuble locatif optionnels, chacun
  avec un âge de vente optionnel.
- **Prestations gouvernementales** — âges de début et montants à 65 ans RPC/RRQ
  et SV, par conjoint, avec estimateurs intégrés (historique de travail pour le
  RPC, années de résidence pour la SV).

## Comment lire les résultats

**Les quatre onglets-questions** : *Mon argent durera-t-il ?* · *Quand puis-je me
retirer ?* · *Mon chiffre FIRE ?* · *Atteindrai-je ma cible ?* — chaque réponse
est accompagnée de sa méthode.

**Soldes des comptes par âge** — richesse empilée par enveloppe; lignes
pointillées pour FIRE, la première prestation et toute vente immobilière; zone
teintée = années-pont. Regardez le REER bleu fondre pendant le pont tandis que le
CELI vert compose intact.

![Soldes](docs/screenshots/balances-chart.png)

**Revenus de retraite par source** — d'où vient l'argent chaque année (empilé) et
l'impôt payé (pointillé).

![Revenus](docs/screenshots/income-chart.png)

**Détail année par année** (replié par défaut) — le tableau d'audit : retraits par
compte, prestations, brut, impôt, net, revenu imposable par personne et son palier
marginal.

![Tableau annuel](docs/screenshots/year-table.png)

**Comparaison des ordres de décaissement** — les quatre stratégies sur vos
chiffres : impôt total (succession incluse), impôt payé sur l'argent REER/FERR, et
la métrique de classement selon votre objectif. Un clic applique la ligne.

![Stratégies](docs/screenshots/strategy-comparison.png)

**Calendrier RPC/SV** — tableaux complets pour chaque âge de début (RPC 60-70,
SV 65-70).

**Monte-Carlo** — rendements aléatoires, plan rejoué 1 000 fois. Le panneau
d'anatomie des échecs montre comment les mauvais scénarios échouent réellement
(presque toujours : un marché baissier dans les cinq premières années — risque de
séquence des rendements).

![Monte-Carlo](docs/screenshots/monte-carlo.png)

**Le tiroir-glossaire** — chaque terme souligné (REER, PBR, meltdown,
récupération, taux marginal…) ouvre une explication claire; 22 entrées, trois
langues.

![Glossaire](docs/screenshots/glossary-drawer.png)

## Hypothèses et limites

- Tous les montants sont en **pouvoir d'achat d'aujourd'hui**; rendements réels.
- Données fiscales 2025-26, fédéral + ON/QC/BC/AB, mises à jour manuellement.
- Le mode couple suppose un fractionnement idéal 50/50; avant 65 ans, les retraits
  REER sont imposés au seul titulaire — préparez des soldes comparables (REER de
  conjoint).
- Pas encore modélisés : l'imposition annuelle des revenus non enregistrés (ce qui
  *sous-estime* l'avantage réel du meltdown), la surtaxe ontarienne, les crédits
  de dividendes, les plafonds CELI/REER, les autres provinces.

**Estimation éducative seulement — pas un conseil financier.**

## Licence et contributions

Projet personnel, fourni tel quel. Issues et PR bienvenus.
