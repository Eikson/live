# Architektur

Live ist eine private, installierbare PWA ohne Backend. Alle Daten liegen in IndexedDB auf dem Gerät. Es gibt keine Netzwerkabhängigkeit, keine externen Fonts oder CDNs, keine Analytics und keine Telemetrie.

Dieses Dokument wächst mit den Schritten. Stand: Schritt 6 (Score und Verlauf).

## Schichten

```
src/domain/     reine Logik, keine Browser-APIs (Datum, Planung, Status, Check-in, Score)
src/data/       IndexedDB: Schema, Migrationen, Repository
src/app/        Use Cases: verbinden Domain und Repository, liefern fertige Sichten
src/platform/   Browser-Anbindung: Uhr, IDs, Theme, localStorage, Service-Worker-Update
src/ui/         DOM, Router, Bildschirme; spricht nur mit src/app
src/i18n/de.ts  alle Oberflächentexte
```

Die Abhängigkeiten zeigen nur nach innen: `ui → app → domain` und `app → data → domain`. Die UI greift nie direkt auf IndexedDB zu. Die Domain kennt keine Browser-APIs und lässt sich ohne DOM testen.

Use Cases bekommen ihre Abhängigkeiten über einen `AppContext` (`repo`, `clock`, `newId`). In Tests steckt dort eine feste Uhr (`fixedClock`) und eine Datenbank in fake-indexeddb.

## Datum und Zeit

Tage werden als lokales Datum `YYYY-MM-DD` (`LocalDate`) gespeichert, nie als Zeitstempel. Die Umrechnung „jetzt → heutiger Tag“ passiert genau einmal mit der lokalen Zeitzone (`toLocalDate`). Alles Weitere (Tage addieren, Differenzen, Wochentage) rechnet auf UTC-Basis und ist damit unabhängig von Sommerzeit und Zeitzonenwechseln. Ein gespeicherter Tag verschiebt sich nie.

## Datenmodell

IndexedDB `live`, Schema-Version 1:

| Store | Schlüssel | Indizes | Inhalt |
|---|---|---|---|
| `preferences` | `id` | | ein Datensatz mit Einstellungen |
| `goals` | `id` | | Ziele |
| `habits` | `id` | `goalId` | Habits (Aufbau und Gegen-Habit) mit aktuellem Plan |
| `habitEvents` | `id` | `habitId` | Änderungsprotokoll: angelegt, aktiviert, pausiert, Plan geändert … |
| `checkIns` | `id` | `habitId`, `localDate`, `habitId_localDate` (eindeutig) | eine Angabe pro Habit und Tag |
| `dayRecords` | `localDate` | | Ausnahmetage, Tagesabschluss, Befinden |
| `avoidanceItems` | `id` | | Dinge, die du bewusst lässt |
| `weeklyReviews` | `id` | `weekStart` (eindeutig) | Wochenrückblicke |
| `meta` | `key` | | `dbVersion`, `exportFormatVersion` |

Alle Datensätze haben stabile IDs, `createdAt` und `updatedAt`. Löschbare Datensätze werden zu Löschmarkierungen `{ id, deletedAt }` ohne Inhalt. Weil ihnen `habitId` und `localDate` fehlen, fallen sie aus dem eindeutigen Index, und ein neuer Eintrag für denselben Tag ist wieder möglich. `loadLive()` liefert nur lebende Datensätze, `loadSnapshot()` alles (Grundlage für Export und Zusammenführen).

### Verlauf eines Habits

Ein Habit speichert nur seinen aktuellen Stand. Wie es an einem früheren Tag aussah (Status, Plan, Gewicht), leitet `buildTimeline` aus dem Ereignisprotokoll ab. So bleibt eine Planänderung heute ohne Wirkung auf die Bewertung vergangener Tage.

Neue Ereignisse bekommen ihren Zeitstempel über `eventTime` (`src/app/planning.ts`): jetzt, aber mindestens eine Millisekunde nach dem letzten gespeicherten Ereignis. Damit ist die Reihenfolge auch bei schnell aufeinanderfolgenden Aktionen oder einer zurückgestellten Uhr eindeutig.

## Bildschirme und Routen

Der Router arbeitet über den Hash (`#/heute`, `#/plan`, …, siehe E-005). Assistenten haben eigene Routen und bekommen Parameter über die Abfrage im Hash, z. B. `#/gewohnheit-neu?ziel=<id>`. Die Tab-Leiste markiert bei diesen Routen den Bereich „Plan“.

- `src/ui/wizard.ts`: gemeinsamer Rahmen für Assistenten (Fortschritt, Zurück/Weiter, Fehlermeldung je Feld, Schutz vor Doppeltipp beim Speichern)
- `src/ui/habit-steps.ts`: die Schritte für Ziel und Gewohnheit, genutzt vom ersten Start, von „+ Ziel“ und von „+ Gewohnheit“. Die Bausteine (`FormPart`: Knoten plus Prüfung) stecken auch im Bearbeiten-Formular.
- `src/ui/edit-form.ts`: kompaktes Formular auf einem Bildschirm für `#/gewohnheit-bearbeiten?id=<id>` und `#/ziel-bearbeiten?id=<id>`. `fokus=minimum|cue` setzt den Fokus auf ein Feld (vom Wiedereinstieg aus).
- Plan-Aktionen (Bearbeiten, Pausieren, Fortsetzen, Archivieren, Löschen) hängen am aufgeklappten Habit. Endgültige Aktionen fragen direkt an Ort und Stelle nach; der Fokus wandert auf die Frage und bei „Abbrechen“ zurück.
- Die Wiedereinstiegskarte erscheint auf „Heute“ über den Karten. Ob sie ausgeblendet wurde, steht in `src/platform/ui-memory.ts` (localStorage, unkritisch).
- „Heute“ hält den gewählten Tag nur im Bildschirm. Nachtragen lädt dieselbe Sicht für einen der letzten sieben Tage.
- `#/abend?tag=<YYYY-MM-DD>`: Abend-Check-in (Stimmung, Energie, Gegen-Habits, Ausweichliste, offene Aufbau-Habits) und Ausnahmetag. Ohne `tag` gilt heute; die Tagauswahl (`src/ui/day-picker.ts`) teilt sich der Bildschirm mit „Heute“. Use Cases in `src/app/evening.ts`, reine Regeln in `src/domain/evening.ts`.
- `#/gegen-habit-neu`: neues Gegen-Habit, vordefiniert (höchstens je eins) oder eigenes. Bearbeiten läuft über `#/gewohnheit-bearbeiten`, das bei Gegen-Habits ein eigenes kurzes Formular zeigt. Use Cases in `src/app/counter-habits.ts`.
- `#/ausweichliste`: persönliche Ausweichliste (hinzufügen, umbenennen, sortieren, ausblenden, löschen). Prüfung und Reihenfolge in `src/domain/avoidance.ts`.
- `#/verlauf?monat=<YYYY-MM>`: Niveau mit Diagramm und Wochentabelle, Kalender je Habit mit Ereignissen, Befinden. Die Sicht baut `loadHistoryView` (`src/app/history.ts`); die Diagramme sind selbst gezeichnetes SVG in `src/ui/screens/history.ts`.
- `#/info`: Infoseite „Über Live“ (erreichbar aus Verlauf und Einstellungen).
- Die Hinweiskarte auf „Heute“ kommt aus `src/app/hint.ts` (`hintFor`, `markHintShown`, `chooseHint`), siehe E-038.

## Transaktionen

- `commit(ChangeSet)` schreibt alle betroffenen Stores in **einer** Transaktion: alles oder nichts. Der erste Start legt so Ziel, Habit, Ereignisse und Abschluss gemeinsam an.
- `upsertCheckIn(habitId, localDate, update)` liest und schreibt den Check-in eines Tages in einer Transaktion. Parallele Aufrufe (Doppeltipp) sehen sich gegenseitig, es entsteht genau ein Eintrag.
- `closeDay` (`src/app/evening.ts`) schreibt Tagesdatensatz (Stimmung, Energie, Abschlusszeit) und alle Antworten des Abend-Check-ins über `commit` in einer Transaktion. Bestehende Check-ins desselben Tages werden aktualisiert, nicht verdoppelt.
- `replaceAll(snapshot)` ersetzt den gesamten Bestand transaktional (für den Import, ab Schritt 7).

## Abgeleitete Werte

Score, Integrationsstatus, Boden, Decke, Schnitte und Hinweise werden **nie gespeichert**. `src/app/derived.ts` berechnet sie bei jedem Laden aus den Rohdaten (Habits, Ereignisse, Check-ins, Tagesdatensätze). Dadurch gibt es keine veralteten Zwischenstände, und ein Import oder eine Korrektur wirkt sofort überall.

Die Rechenregeln liegen als reine Funktionen in `src/domain/scoring/` und lesen ihre Schwellen aus `config.ts`:

- `fulfillment.ts`: Erfüllung je Angabe (gemacht/anders 1, kleinste Version 0,5; Gegen-Habits nein 1, teilweise 0,5, ja 0)
- `integration.ts`: Integration (30-Tage-Fenster, Eintritt ab 80 %, Austritt unter 50 %, Abdeckung mindestens zwei Drittel, frühestens 30 Tage nach der Aktivierung). Sie bestimmt auch, ob ein Habit noch einen der zwei Plätze im Aufbau belegt.
- `day-score.ts`: Tagesscore und Bewertbarkeit (alle geplanten Habits eingetragen, kein Ausnahmetag)
- `corridor.ts`: Boden (Faktor 0,6) und Decke je Tag, Durchschnitte über Fenster
- `comparison.ts`: Vergleich mit vor 6 Monaten oder den ersten Wochen
- `wellbeing.ts`: Befinden je Tag und im Schnitt
- `patterns.ts`: Hinweislogik und Ruhezeit der Hinweiskarte

`src/app/scoring.ts` setzt daraus mit den Rohdaten den Kontext eines Tages zusammen; `history.ts` und `hint.ts` bauen darauf ihre Sichten.

## Testdaten

`npm run dev`, dann `/seed.html` öffnen. Die Seite ersetzt nach Rückfrage alle Daten in diesem Browser durch Testdaten über rund sieben Monate, wahlweise mit gleichmäßigem Verlauf oder mit schwacher letzter Woche (dann erscheint die Hinweiskarte). Erzeugt werden sie deterministisch von `buildSeed` in `src/dev/seed.ts`. Die Seite gehört nicht zum Build (siehe E-039).

## Migrationen

`src/data/migrations.ts` enthält pro Schema-Version eine Migration (`1` legt die Stores an). `openDatabase` prüft vor dem Öffnen, dass für jede Version bis zur Zielversion eine Migration existiert, und führt die fehlenden nacheinander in der Upgrade-Transaktion aus. Schlägt eine Migration fehl, wird die Transaktion abgebrochen: Die Datenbank bleibt auf der alten Version und behält ihre Daten (siehe E-010). Danach steht die aktuelle Version in `meta.dbVersion`.

Öffnet ein anderer Tab eine neuere Version, gibt dieser Tab seine Verbindung frei und bittet um ein Neuladen.

## Service Worker und Updates

`vite-plugin-pwa` erzeugt Manifest und Service Worker (Precache aller Dateien, damit die App offline startet). Updates werden nicht automatisch aktiviert: Die App zeigt einen Hinweis, und erst auf Tippen wird die neue Version geladen, damit keine Eingabe verloren geht.

## Tests

- `tests/unit/`: Domain-Logik (Datum inklusive Sommerzeit, Planung, Status, Check-in, Erfüllung, Integration, Score, Korridor, Vergleich, Hinweislogik, Abend und Ausweichliste)
- `tests/integration/`: Repository und Use Cases gegen fake-indexeddb (Transaktionen, eindeutiger Index, Migrationen, erste Schleife, Planung, Bearbeiten/Pausieren/Löschen/Wiedereinstieg, Tagesabschluss, Ausnahmetage, Gegen-Habits, Verlauf und Hinweiskarte mit den Testdaten)
- `tests/e2e/`: Playwright in Chromium mit Pixel-8-Viewport und Desktop; gemeinsame Abläufe in `tests/e2e/helpers.ts`

## Grenzen der PWA

Wird im Lauf der Schritte ergänzt (Speicherbereinigung durch den Browser, Benachrichtigungen, Installation unter Android).
