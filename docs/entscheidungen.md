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

Der erste Start fragt Ziel, Handlung, Auslöser, Wenn-dann-Satz, Minimalversion und Gewicht ab. Seit Schritt 3 gehören Rhythmus (täglich oder Wochentage) und bis zu drei optionale Hindernispläne dazu. Gegen-Habits folgen in Schritt 5.

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

## E-014 Assistenten als eigene Routen

„+ Ziel“ und „+ Gewohnheit“ öffnen eigene Routen (`#/ziel-neu`, `#/gewohnheit-neu?ziel=<id>`) statt eines Dialogs. Sie nutzen dieselben Schritte wie der erste Start. Nach dem Speichern eines Ziels geht es direkt zur ersten Gewohnheit dafür, damit kein Ziel ohne Handlung entsteht. Abbrechen ist im ersten Schritt möglich und führt zurück zum Plan; ein bereits gespeichertes Ziel bleibt dann ohne Gewohnheit im Plan stehen.

## E-015 Neue Gewohnheit an der Aufbau-Grenze

Sind beide Plätze im Aufbau belegt, sagt der letzte Schritt des Assistenten das vorher und speichert die Gewohnheit als Entwurf. Im Plan steht sie unter „Entwürfe“. „Aktivieren“ erscheint nur, wenn ein Platz frei ist; sonst steht dort ein ruhiger Satz, warum es gerade nicht geht.

## E-016 Nachtragen über „Heute“

Nachtragen passiert auf „Heute“ über „Tag wechseln“: Es zeigt die letzten sieben Tage und heute. Der gewählte Tag wird nicht gespeichert; beim nächsten Öffnen zeigt „Heute“ wieder den heutigen Tag. Für vergangene Tage lauten Überschrift und Bestätigungen anders („Nachtragen“, „An diesem Tag hat es nicht gepasst.“). Angezeigt werden nur Habits, die an diesem Tag aktiv waren.

## E-017 „Trotzdem gemacht“ lässt sich zurücknehmen

An einem nicht geplanten Tag gibt es statt der drei Knöpfe nur „Trotzdem gemacht“. Der Eintrag wird als nicht geplant markiert und zählt nicht im Score. Weil es dafür kein „Ändern“ mit Alternativen gibt, bietet die Karte „Rückgängig“; das legt eine Löschmarkierung an.

## E-018 Vorschlag für den Wenn-dann-Satz

Der Vorschlag entsteht aus dem Auslöser nach festen Mustern ohne KI: Zeitangaben werden zu „es … ist“ („Nach dem Mittagessen“ → „Wenn es nach dem Mittagessen ist“), Ortsangaben mit „bei/beim“ zu „ich … bin“, einleitendes „Wenn/Sobald/Nachdem“ entfällt („Sobald ich nach Hause komme“ → „Wenn ich nach Hause komme“), eine Uhrzeit ohne Beschreibung wird zu „Wenn es 7:30 Uhr ist“. Unbekannte Formen bleiben unverändert. Der Dann-Teil ist die Handlung. Solange du den Satz nicht selbst änderst, wird der Vorschlag gespeichert.
