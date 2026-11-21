# Retour d'expérience — usage de `html-engine` par un agent IA

**Date** : 6 octobre 2026
**Contexte** : construction d'un deck de 4 slides au format 1920×1080 pour un webinaire (charte
imposée, logos, texte français), avec navigation clavier et export PDF. Session menée de bout en
bout par un agent, moteur piloté en CLI.
**Périmètre** : `issues/resolved/07-…` à `issues/resolved/17-…` (sauf `16-…`, encore ouverte dans
`issues/new/`)

## Résumé

La **boucle de validation** est la meilleure partie du produit : `validate --json`, des codes
stables, le fichier et le champ fautifs, un `schema` machine-lisible. Une quarantaine de passes
de validation ont permis de corriger les erreurs sans jamais deviner.

Ce qui a coûté du temps n'est pas la validation mais **la mise en page**, **la forme des données
de liste** et **l'absence de conteneur de page**. Sur ce projet, le résultat est révélateur :

- ~180 lignes de CSS de mise en page dans `global.css` (le seul fichier non scopé), indexées sur
  les ids générés par le moteur (`body > section#benefits-0`) ;
- ~40 lignes de CSS à l'intérieur des composants, réduites à de la décoration ;
- 2 scripts hors moteur ajoutés au build (`mark-slides.mjs` pour la classe de page,
  `export-pdf.mjs` pour le PDF) ;
- 1 bug silencieux livré dans deux builds (image cassée, voir `12-…`).

Autrement dit : pour une demande de type « slides / poster / A4 », l'essentiel du travail de
l'agent se fait **contre** l'abstraction du produit plutôt qu'avec elle.

## Tableau de priorisation

| # | Issue | Sévérité | Coût observé |
| --- | --- | --- | --- |
| 07 | [`htmlng` tool: `ctx.shell.run is not a function`](../resolved/07-htmlng-tool-context-shell-run-error.md) | Haute | interface documentée inutilisable (contournement CLI) |
| 07 | [CSS composant ne peut pas cibler `<body>` / `:root`](../resolved/07-component-css-cannot-target-body.md) | Haute | cause racine de ~80 % des difficultés de layout |
| 08 | [Rôles de wrapper positionnels](../resolved/08-wrapper-semantics-are-positional.md) | Moyenne | 2 itérations perdues sur `section#deck` |
| 09 | [Aucun conteneur de page](../resolved/09-no-page-level-container.md) | Haute | grille 2×2 et canvas fixes impossibles à exprimer |
| 10 | [`<body>` sans identité de page](../resolved/10-body-has-no-page-identity.md) | Moyenne-Haute | script post-build obligatoire dans `build.sh` |
| 11 | [Forme des données `list` documentée à l'envers](../resolved/11-list-data-shape-documented-backwards.md) | Haute | 4 composants remodelés, validation trompeuse |
| 12 | [`{{image:x}}` dans un attribut corrompt le HTML](../resolved/12-image-placeholder-in-attribute-corrupts-markup.md) | Moyenne-Haute | image cassée livrée malgré `validate: ok` |
| 13 | [Scripts de page forcés dans `<head>`](../resolved/13-page-scripts-forced-into-head.md) | Moyenne | piège `document.body === null`, bug « à moitié silencieux » |
| 14 | [Pas de conditionnel de champ](../resolved/14-no-field-level-conditionals.md) | Moyenne | 3 contournements, 1 champ supprimé du schéma |
| 15 | [Diagnostics : index d'élément, faux positifs, `explain`, cache](../resolved/15-validation-diagnostics-quick-wins.md) | Basse-Moyenne | 6 correctifs courts, chacun ≥ 1 itération |
| 16 | [Pas d'export PDF, `vh` non fiable à l'impression](16-no-pdf-export-and-print-vh-mismatch.md) | Moyenne | pipeline PDF hors moteur (captures + Pillow) |
| 17 | [Pages triées alphabétiquement](../resolved/17-pages-ordered-alphabetically.md) | Basse | couplage ordre ↔ numérotation des slides |

## Ce qui fonctionne très bien (à préserver)

- **`validate --json`** : codes stables, fichier + champ, sortie exploitable par un script. C'est
  ce qui rend la boucle agent viable.
- **Séparation composant / données** : les trois sections (template / CSS / schéma) imposent une
  discipline utile et empêchent de mélanger fond et forme.
- **Auto-scoping CSS** : zéro collision entre composants, CSS natif, pas d'étape de compilation.
  Le revers est l'issue `07` (pas d'échappatoire), mais le mécanisme lui-même est agréable.
- **`global.css` non scopé** : filet de sécurité indispensable (même si j'y ai mis trop de choses,
  faute d'alternative).
- **Copie automatique des assets** vers `build/assets/` : transparente et fiable.
- **Validateur de texte** (whitelist des balises inline) : m'a attrapé une fois, à raison.

## Trois changements qui auraient transformé cette session

1. **Un conteneur de page** (`layout.wrapper: true` ou un composant de rôle `page`) — débloque
   slides, posters, A4, et rend `display: contents` utilisable (issue `09`).
2. **Une échappatoire de scoping** (`:global(...)`, ou exemption de `html`/`body`/`:root`) —
   remet la mise en page dans les composants au lieu de `global.css` (issue `07`).
3. **`{{#if:field}}`** — supprime les puces vides, les champs supprimés du schéma et les classes
   passées dans les données (issue `14`).

Avec ces trois-là, plus l'émission de la classe de page sur `<body>` (issue `10`), le projet
n'aurait eu besoin d'**aucun** script hors moteur, et `htmlng build` aurait produit directement
l'artefact final.

## Note de méthode

Les issues `07-…` à `17-…` sont rédigées pour être actionnables telles quelles : reproduction
minimale, référence au fichier et à la ligne du moteur, correctif proposé par ordre de
préférence, et contournement réellement appliqué dans le projet. Deux d'entre elles (`08`, `09`)
sont des **choix de conception** documentés dans `specs/html-engine.md` : elles ne signalent pas
un bug mais l'absence d'une échappatoire pour un cas d'usage (présentation à format fixe) que le
produit vise pourtant, puisqu'il se présente comme un générateur de « landing pages / marketing
sites ».
