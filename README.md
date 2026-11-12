# aumczakkaartam.github.io

Zakkaart Anesthesiemedewerkers: drie apps uit één bron.

| App | Bestand | Inhoud |
|---|---|---|
| Zakkaart | `index.html` | Alles |
| Zakkaart Info | `info.html` | Alles behalve Calculator en Medicatie |
| Zakkaart Calculator | `calculator.html` | Alleen Calculator en Medicatie |

## Iets aanpassen

De html-bestanden in de hoofdmap worden **gegenereerd**. Wijzig ze niet met de hand; de volgende build overschrijft ze.

1. Pas de bron aan in `src/`:
   - `src/app.jsx`: alle inhoud en schermen
   - `src/shell.html`: de pagina eromheen (stijlen, wachtwoordscherm)
   - `src/sw.js`: offline werken
   - `src/img/`: afbeeldingen
2. Bouw opnieuw:

   ```
   npm install     # alleen de eerste keer
   node build.mjs
   ```

3. Commit de bron én de gegenereerde bestanden (`index.html`, `info.html`, `calculator.html`, `sw.js`, de manifesten).

Een wijziging in `src/app.jsx` komt zo automatisch in alle drie de apps.

Stukken die maar in één app horen staan tussen `//#if full,info` (of `!calc`) en `//#endif`. De constante `APP` (`"full"`, `"info"` of `"calc"`) zegt in de code welke app er draait.

## Goed om te weten

- De apps werken na het eerste bezoek ook zonder internet. Is er wel verbinding, dan komt een nieuwe versie bij het openen vanzelf binnen.
- Het wachtwoordscherm is een drempel, geen beveiliging: de repo is openbaar en de inhoud staat leesbaar in de bestanden.
- Kleurcodes van spuitlabels, buisdoppen, bewegwijzering, EPA-categorieën en isolatievormen zijn bewust niet aan de app-stijl aangepast.
