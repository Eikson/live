# Entscheidungen

Kurze Notizen zu Detailfragen, die die Spezifikation offen lässt. Jede Entscheidung ist die einfachste robuste Lösung, die zur Spezifikation passt. Bei einem Widerspruch gilt die Spezifikation.

## E-001 Abendkarte und Review-Wochentag

`eveningCardFrom` (Standard 18:00) und `reviewWeekday` (Standard Sonntag) kommen als Standardwerte aus `src/domain/app-config.ts`. Beide lassen sich in den Einstellungen ändern und werden in `preferences` gespeichert.

## E-002 Wiedereinstiegskarte

Die Karte erscheint, wenn seit 5 Tagen keine Angabe mehr gemacht wurde und es mindestens ein aktives Habit gibt, bei dem mindestens 2 geplante Gelegenheiten ohne Angabe geblieben sind. Treffen mehrere Habits zu, fragt die Karte, mit welchem du wieder anfangen willst. (Umsetzung in Schritt 4.)

## E-003 Gegen-Habits

Gegen-Habits erscheinen nur im Abend-Check-in, nicht als Karte unter „Heute“. Ein Tag ohne „Tag abschließen“ gilt für sie als Tag ohne Angabe. (Umsetzung in Schritt 5.)

## E-004 Pausierte Habits im Vergleich

Ein aktuell pausiertes Habit wird beim Vergleich (Abschnitt 4.6) aus **beiden** Fenstern herausgerechnet, also aus dem heutigen Ø28-Fenster und aus dem Fenster vor 182 Tagen. Sonst würde ein Habit, das damals lief und jetzt bewusst pausiert, nur auf einer Seite zählen. (Umsetzung in Schritt 6.)

## E-005 Routing über den Hash

Die App nutzt Hash-Routen (`#/heute`, `#/plan`, `#/verlauf`, `#/einstellungen`, beim ersten Start `#/start`). Damit funktioniert sie ohne Server-Konfiguration, auch unter einem Unterpfad auf GitHub Pages und offline aus dem Service-Worker-Cache.

## E-006 Spezifikation und Recherche bleiben lokal

`Input/` und `Live-Implementierungsprompt.md` stehen in `.gitignore`. Sie sind Arbeitsgrundlage, gehören aber nicht in ein später möglicherweise öffentliches Repository.

## E-007 Integrationslogik früher als geplant

Die Integrationsberechnung (Abschnitt Score-Logik) war für Schritt 6 vorgesehen. Sie steckt schon jetzt in der Domain, weil die Aufbau-Grenze von 2 Habits davon abhängt: Ein integriertes Habit gibt seinen Platz frei. Die Oberfläche zeigt noch keinen Score.

## E-008 Umfang des ersten Starts in Schritt 2

Der erste Start fragt Ziel, Handlung, Auslöser, Wenn-dann-Satz, Minimalversion und Gewicht ab. Neue Habits sind zunächst täglich geplant. Hindernisplan und Wochentage folgen in Schritt 3, Gegen-Habits in Schritt 5.

## E-009 Basis-Pfad für GitHub Pages

`vite.config.ts` liest den Basis-Pfad aus der Umgebungsvariable `LIVE_BASE` (Standard `/`). Für GitHub Pages wird später z. B. `LIVE_BASE=/live/ npm run build` gesetzt. Der Scope des Service Workers folgt automatisch dem Basis-Pfad.

## E-010 Fehlschlagende Migration bricht das Upgrade ab

`idb` wartet nicht auf eine asynchrone `upgrade`-Funktion. Ohne Gegenmaßnahme würde ein Fehler in einer Migration verschluckt und die neue Version trotzdem festgeschrieben. `openDatabase` fängt den Fehler deshalb ab, bricht die Upgrade-Transaktion ausdrücklich ab und reicht den ursprünglichen Fehler weiter. Die Datenbank bleibt auf der alten Version, die Daten bleiben erhalten (Test in `tests/integration/repository.test.ts`).

## E-011 Keine `@types/node`

`@types/node` steht nicht auf der Paketliste. Der einzige Test, der `process.env.TZ` braucht, deklariert `process` lokal mit dem minimal nötigen Typ. Die Vitest-Konfiguration setzt die Zeitzone auf `Europe/Berlin`.

## E-012 Doppeltipp und Korrektur

Ein Check-in wird per `upsertCheckIn` in einer einzigen Transaktion gelesen und geschrieben. Der eindeutige Index `[habitId, localDate]` verhindert zusätzlich doppelte Einträge. Eine Korrektur ändert den bestehenden Eintrag und behält `id` und `createdAt`.

## E-013 Icons

Das Icon ist ein eigenes SVG (`public/icon.svg`): eine ansteigende Linie in Petrol auf hellem Grund. Die PNG-Varianten (192, 512, maskierbar, Apple) erzeugt `npm run icons` lokal mit dem ohnehin installierten Playwright-Chromium. Das optionale `@vite-pwa/assets-generator` ist dafür nicht nötig.
