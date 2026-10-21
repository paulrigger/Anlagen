# Anlagen

Persönliche Portfolio-App. Statisches Frontend auf GitHub Pages, Daten im Google Sheet **„Anlagen-DB“**.

- **Kein Backend, keine Daten im Repo.** Die Seite ist öffentlich erreichbar, aber ohne Google-Login mit Zugriff auf das Sheet sieht man nur den Login-Button.
- **Rechenlogik im Frontend** (`js/model.js`): Bestand, Einstand, G/V, Allokation, Klumpenrisiko. Das Sheet enthält nur Rohdaten und die GOOGLEFINANCE-Kurse.
- **Kurshistorie on demand**, nichts davon wird gespeichert: Krypto direkt über CoinGecko, ETFs/Edelmetall über einen kleinen Apps-Script-Proxy (Yahoo).

```
index.html            App-Shell
css/app.css           Styles (hell/dunkel automatisch)
js/config.js          Client-ID, Sheet-ID, Proxy-URL, Snapshot-Spalten
js/auth.js            Google OAuth (Redirect-Flow, funktioniert auch als Homescreen-App)
sw.js                 Service Worker (installierbar, cacht nur App-Dateien, nie Daten)
js/sheets.js          Sheets API v4 (lesen, anhängen)
js/model.js           Rechenlogik (rein, in Node testbar)
js/history.js         Kurshistorie (CoinGecko / Proxy)
js/app.js             Views: Übersicht, Positionen, Historie, Erfassen
apps-script/          Code für das Sheet: Kursproxy, Gold/Silber, Tages-Snapshot
test/                 Modell-Test (Node) und UI-Smoke-Test (Playwright)
```

## Einrichtung

### 1. GitHub Pages

Repo → **Settings → Pages** → Source: *Deploy from a branch*, Branch `main`, Ordner `/ (root)` → Save.
URL danach: `https://paulrigger.github.io/anlagen/`

### 2. Google OAuth-Client (einmalig, ~10 min)

1. [console.cloud.google.com](https://console.cloud.google.com) → neues Projekt, z. B. `anlagen`.
2. **APIs & Services → Library** → „Google Sheets API“ → *Enable*.
3. **APIs & Services → OAuth consent screen** (bzw. *Google Auth Platform*):
   - User Type **External**, App-Name `Anlagen`, deine Gmail als Support- und Entwickler-Kontakt.
   - Scope: `.../auth/spreadsheets`.
   - Publishing status **Testing** lassen und unter *Test users* deine Gmail-Adresse eintragen.
     → Nur Test-User können sich überhaupt anmelden. Beim ersten Login erscheint „Google hat diese App nicht überprüft“ → *Weiter*.
4. **Credentials → Create credentials → OAuth client ID** → Typ **Web application**:
   - *Authorized JavaScript origins*: `https://paulrigger.github.io` (ohne Pfad, ohne `/` am Ende)
   - *Authorized redirect URIs*: `https://paulrigger.github.io/anlagen/` (**mit** `/` am Ende, exakt so)
   - Für lokalen Test zusätzlich Origin `http://localhost:8000` und Redirect `http://localhost:8000/`

   Der Login läuft als Redirect (kein Popup), damit er auch in der installierten App am iPhone funktioniert.
5. Client-ID (`….apps.googleusercontent.com`) in `js/config.js` bei `CLIENT_ID` eintragen, committen.

Die Client-ID ist kein Geheimnis. Ohne Origin-Freigabe und ohne Test-User-Eintrag kann niemand anders damit etwas anfangen, und Datenzugriff hat ohnehin nur dein Google-Konto.

### 3. Apps Script im Sheet „Anlagen-DB“

1. Sheet öffnen → **Erweiterungen → Apps Script**.
2. Inhalt von `apps-script/Code.gs` in `Code.gs` einfügen.
3. Zahnrad (Projekteinstellungen) → *„appsscript.json“ im Editor anzeigen* aktivieren → Inhalt von `apps-script/appsscript.json` übernehmen.
4. Funktion **`setupTrigger`** auswählen → *Ausführen* → Berechtigungen bestätigen.
   Legt an: `dailySnapshot` täglich ~22 Uhr, `updateEdelmetall` alle 4 h.
5. Einmal **`dailySnapshot`** manuell ausführen und prüfen, ob im Tab `Snapshots` eine Zeile erscheint und `Kurse` für XAU/XAG einen Wert hat.
6. **Bereitstellen → Neue Bereitstellung → Web-App**: *Ausführen als: Ich*, *Zugriff: Jeder* → URL (endet auf `/exec`) in `js/config.js` bei `KURS_PROXY_URL` eintragen.
   Der Proxy gibt nur öffentliche Marktkurse zurück, keine Portfolio-Daten. Gegen Fremdnutzung optional denselben Wert in `PROXY_KEY` (Code.gs) und `KURS_PROXY_KEY` (config.js) setzen.

### 4. Als App installieren

Dieselbe URL `https://paulrigger.github.io/anlagen/` überall:

| Gerät | Schritte |
|---|---|
| iPhone / iPad | **Safari** öffnen → Teilen-Symbol → *Zum Home-Bildschirm* (nur Safari kann das) |
| Android | Chrome → Menü ⋮ → *App installieren* bzw. *Zum Startbildschirm hinzufügen* |
| Mac / Windows | Chrome oder Edge → Installieren-Symbol rechts in der Adressleiste; Safari (Mac) → Ablage → *Zum Dock hinzufügen* |

Danach startet die App im eigenen Fenster ohne Browser-Leisten. Erster Start: einmal bei Google anmelden. Danach meldet sich die App automatisch wieder an, solange du bei Google angemeldet bist (Token ~1 h, dann kurzer Redirect).

Updates: Neue Commits sind beim nächsten Öffnen mit Netz sofort aktiv (Service Worker lädt immer zuerst vom Netz). Offline startet die Oberfläche, Daten gibt es aber nur online. Portfolio-Daten werden nie auf dem Gerät gecacht.

### 5. Altes Sheet „Sparen“

Läuft unverändert weiter. Wenn die App ein paar Tage plausible Snapshots schreibt, die Trigger im alten Sheet deaktivieren (Apps Script → Trigger), damit nicht zwei Systeme Snapshots erzeugen.

## Datenmodell (Sheet „Anlagen-DB“)

| Tab | Zweck | Wer schreibt |
|---|---|---|
| `Assets` | Positionen: `asset_id`, `instrument` (→ Kurse), `konto_id`, Klasse, Risiko | manuell |
| `Kurse` | je Instrument: GOOGLEFINANCE + FX, Fallback `kurs_manuell_eur`, `hist_symbol` | Formeln / Script (XAU, XAG) |
| `Transaktionen` | `Basis`, `Kauf`, `Sparplan`, `Verkauf`, `Einlieferung`, `Auslieferung` | App / manuell |
| `Sparplaene` | Konfiguration | manuell |
| `Konten` | Depots, Wallets, Cash-Konten | manuell |
| `Salden` | Saldo-Log der Cash-Konten (letzter Eintrag gilt) | App / manuell |
| `Snapshots` | Tageswerte je Konto/Risiko für den Verlauf | Script / App |
| `Meta` | Schema-Version, Regeln | – |

Regeln: Locale `en_US`, Datum ISO `yyyy-mm-dd`, Bestand = Summe der Transaktionen. **Keine Berechnungs-Formeln im Sheet** außer im Tab `Kurse`.

Neue Position: Zeile in `Assets` (+ ggf. Instrument in `Kurse`) und eine `Kauf`- oder `Basis`-Transaktion.
Neue Snapshot-Spalte: Spalte in `Snapshots` anlegen und in `SNAPSHOT_MAP` (config.js **und** Code.gs) ergänzen.

## Lokal testen

```bash
python3 -m http.server 8000          # → http://localhost:8000
node test/model.test.mjs             # Rechenlogik gegen migrierte Werte
python3 test/ui_check.py /tmp/ui     # Screenshots aller Views mit Mock-Daten (Playwright)
```
