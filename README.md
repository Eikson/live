# Live

Private Web-App für Gewohnheiten, nächste Schritte und Vorhaben mit Deadline. Live läuft komplett im Browser: kein Konto, kein Server, keine Analyse. Die Daten liegen in IndexedDB auf dem jeweiligen Gerät.

## Voraussetzungen

- Node.js 22 oder neuer
- Für die E2E-Tests einmalig die Browser von Playwright: `npx playwright install chromium`

Unter Windows blockiert PowerShell oft das Skript `npm.ps1`. Dann `npm.cmd` statt `npm` schreiben (`npm.cmd run build`) oder die Eingabeaufforderung (cmd) nutzen.

## Start

```bash
npm install
npm run dev
```

Die App läuft dann unter http://localhost:5173. Im Entwicklungsmodus ist der Service Worker aus.

Testdaten über rund sieben Monate: `npm run dev`, dann http://localhost:5173/seed.html öffnen. Die Seite ersetzt nach Rückfrage alle Daten in diesem Browser.

## Build

```bash
npm run build
npm run preview
```

`build` prüft zuerst die Typen und schreibt dann nach `dist/`. `preview` liefert den Build unter http://localhost:4173 aus, mit Service Worker und Offline-Betrieb.

Für einen Unterpfad wie auf GitHub Pages: `LIVE_BASE=/live/ npm run build`. Unter PowerShell: `$env:LIVE_BASE='/live/'; npm.cmd run build`.

## Tests

| Befehl | Inhalt |
| --- | --- |
| `npm run typecheck` | TypeScript im strikten Modus |
| `npm test` | Unit- und Integrationstests (Vitest, fake-indexeddb) |
| `npm run test:e2e` | Playwright gegen den Production-Build, Pixel-8-Viewport und Desktop |

Weitere Varianten der E2E-Tests:

- **Port 4173 belegt:** `E2E_PORT=4175 npm run test:e2e`
- **Unterpfad wie auf GitHub Pages:** `LIVE_BASE=/live/ npm run test:e2e -- base-path`. In Git Bash zusätzlich `MSYS_NO_PATHCONV=1` setzen, sonst wird `/live/` in einen Windows-Pfad umgewandelt.

## Offline-Verhalten

- Nach dem ersten vollständigen Laden liegen alle Dateien im Cache des Service Workers. Danach startet Live ohne Internet, mit allen Daten.
- Beim allerersten Aufruf braucht Live eine Verbindung. Ohne frühere Besuche zeigt der Browser seine eigene Fehlerseite.
- Neue Versionen werden nie von selbst aktiv. Es erscheint „Neue Version verfügbar – neu laden“, und erst nach dem Tippen wird neu geladen. Live fragt höchstens einmal pro Stunde nach einer neuen Version und nur mit Netz.
- Der Service Worker läuft nur über https oder localhost. Über eine WLAN-Adresse mit http gibt es keinen Offline-Betrieb und keine Installation.

## Installation auf Android

1. Die Adresse von Live (https) in Chrome öffnen.
2. Menü (drei Punkte) → „Zum Startbildschirm hinzufügen“ oder „App installieren“.
3. Bestätigen. Live erscheint als eigenes Symbol und öffnet sich ohne Adressleiste.

Die Anleitung steht auch in der App unter Einstellungen → „App installieren“. Wenn Chrome es anbietet, gibt es dort einen Knopf „Jetzt installieren“.

**Wichtig:** Die installierte App und der Chrome-Tab mit derselben Adresse teilen sich die Daten. Beim Deinstallieren können die Daten verloren gehen, also vorher exportieren.

## Backups und Abgleich

- **Wo die Daten liegen:** nur in diesem Browser auf diesem Gerät. Pixel und Desktop haben getrennte Bestände, ebenso `localhost` und die GitHub-Pages-Adresse.
- **Export:** Einstellungen → „Exportieren und importieren“. Die Datei lässt sich optional mit einem Passwort verschlüsseln. Ohne dieses Passwort lässt sie sich nicht mehr öffnen.
- **Backup-Hinweis:** Liegt der letzte Export mehr als 14 Tage zurück, erinnert eine Karte auf „Heute“ daran (abschaltbar).
- **Import:** „Ersetzen“ übernimmt den Stand der Datei vollständig. Vorher speichert Live eine Sicherheitskopie des bisherigen Stands als Datei. „Zusammenführen“ verbindet zwei Bestände, zum Beispiel vom Handy und vom Computer. Je Eintrag gewinnt der neuere Stand, und Löschungen werden übertragen. Bei beiden zeigt Live vorher eine Vorschau.
- **Abgleich zwischen Geräten** geht nur von Hand: auf dem einen Gerät exportieren, auf dem anderen zusammenführen.
- **Mehrere Personen:** Jede Person nutzt Live auf ihrem eigenen Gerät und hat damit ihren eigenen Bestand. Ein Konto gibt es nicht.
- Browser dürfen Website-Daten bei Speichermangel löschen. Nur ein Export liegt sicher außerhalb des Browsers.

## GitHub Pages

Die Veröffentlichung ist vorbereitet, aber noch nicht eingerichtet.

- `.github/workflows/pages.yml` prüft bei jedem Push auf `main` die Tests, baut mit dem Repository-Namen als Unterpfad (z. B. `/live/`) und veröffentlicht `dist/`.
- Heißt das Repository `<name>.github.io`, liegt die App direkt unter `/`.
- Die Routen laufen über den Hash (`#/heute`), daher braucht GitHub Pages keine Sonderregeln für Unterseiten.
- Der Scope des Service Workers und die Adressen im Manifest sind relativ und folgen dem Unterpfad.

Einrichtung, einmalig:

1. Ein Repository auf GitHub anlegen. Auf dem kostenlosen Plan muss es für Pages öffentlich sein. Der Code enthält keine persönlichen Daten. Die Spezifikation und die Recherche (`Input/`, `Live-Implementierungsprompt.md`) sind per `.gitignore` ausgeschlossen.
2. Das lokale Repository mit dem neuen verbinden und `main` pushen.
3. Auf GitHub unter Settings → Pages als Quelle „GitHub Actions“ wählen.
4. Nach dem ersten Lauf ist Live unter `https://<name>.github.io/<repository>/` erreichbar.

## Aufbau

- `src/domain/`: reine Logik ohne Browser-APIs
- `src/app/`: Use Cases
- `src/data/`: IndexedDB-Repository und Migrationen
- `src/ui/`: Bildschirme und Komponenten
- `src/platform/`: Service Worker, Installation, Merkwerte im localStorage

Details stehen in `docs/architektur.md`, Entscheidungen in `docs/entscheidungen.md`.
