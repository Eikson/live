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

## E-019 Wann die Wiedereinstiegskarte erscheint

Die Karte erscheint auf „Heute“, wenn seit der letzten Angabe irgendeiner Art (Check-in, Befinden, Ausnahmetag) oder dem letzten Neustart mindestens 5 Tage liegen (`appConfig.recovery.daysWithoutAnyEntry`). Als Neustart zählen Aktivieren, Fortsetzen und eine Wahl auf der Wiedereinstiegskarte. Betroffen ist ein Habit, wenn seitdem mindestens 2 geplante Tage ohne Angabe vergangen sind (`minMissedPlannedOpportunities`). Ausnahmetage und heute zählen nicht mit.

Die Wahl wird sofort als Ereignis `REENTERED` gespeichert, für jedes betroffene Habit. Das gewählte Habit trägt die Wahl, die übrigen „Weitermachen“. Damit verschwindet die Karte und es beginnt eine neue Zählung. „Kleiner machen“ und „Auslöser ändern“ öffnen danach das Bearbeiten-Formular mit dem Fokus auf der Minimalversion bzw. dem Auslöser. „Pausieren“ pausiert das gewählte Habit in derselben Transaktion. „Ausblenden“ speichert nichts in der Datenbank. Es merkt sich nur in localStorage den Schlüssel `since`; bei einer späteren Pause erscheint die Karte wieder.

## E-020 Bearbeiten auf einem Bildschirm

Bearbeiten ist kein Assistent, sondern ein kompaktes Formular mit denselben Feldern und Prüfungen. Der vorherige Stand landet im Änderungsprotokoll. Rhythmus und Gewicht gelten ab heute; frühere Tage und ihre Angaben bleiben unverändert. Der Wenn-dann-Satz ist hier ein festes Feldpaar ohne Vorschlag. Beide Teile leer heißt: kein Wenn-dann-Satz. Ist nur ein Teil ausgefüllt, wird der andere verlangt. Ohne Änderung wird nichts geschrieben; der Plan meldet „Gespeichert. Es gab keine Änderung.“

## E-021 Archivieren, Löschen und Fortsetzen

Archivieren ist endgültig: Ein archiviertes Habit lässt sich nicht fortsetzen oder bearbeiten und zählt auch rückwirkend nicht mehr mit. Es bleibt nur „Löschen“. Löschen setzt Löschmarkierungen und entfernt Änderungsprotokoll und Wochenrückblick-Einträge des Habits. Ein Ziel zu löschen löscht alle seine Habits mit, auch Entwürfe, pausierte und archivierte; die Rückfrage nennt die Anzahl. Ziele zu archivieren ist nicht gebaut, weil die Spezifikation dafür keinen Ablauf vorgibt. Ein bereits integriertes Habit braucht zum Fortsetzen keinen freien Platz im Aufbau.

## E-022 Rückfragen direkt an Ort und Stelle

Archivieren und Löschen fragen nicht in einem Dialog nach, sondern ersetzen die Aktionsleiste des Habits durch die Frage mit „Ja, …“ und „Abbrechen“. Der Fokus geht auf die Frage und bei „Abbrechen“ zurück auf den auslösenden Knopf. Aktionsknöpfe sind sichtbar kurz („Bearbeiten“); ihr zugänglicher Name nennt das Habit („Bearbeiten: 10 Minuten spazieren“).

## E-023 Eindeutige Reihenfolge im Änderungsprotokoll

Ereignisse am selben Tag werden nach Zeitstempel sortiert. Zwei Aktionen in derselben Millisekunde (oder eine zurückgestellte Uhr) hätten die Reihenfolge offen gelassen, z. B. Pausieren und sofortiges Fortsetzen. Neue Ereignisse bekommen deshalb mindestens den letzten gespeicherten Zeitstempel plus eine Millisekunde (`eventTime`).

## E-024 Abend-Check-in speichert beim Abschließen

Der Abend-Check-in sammelt Stimmung, Energie, Gegen-Habits, die Ausweichliste und noch offene Aufbau-Habits auf einem Bildschirm. Gespeichert wird erst mit „Tag abschließen“, dann aber alles in einer Transaktion (`closeDay`). So entsteht kein halb gespeicherter Abend, und ein Doppeltipp erzeugt keine doppelten Einträge. Ein abgeschlossener Tag bleibt änderbar; der Bildschirm sagt das ruhig dazu („Dieser Tag ist abgeschlossen. Du kannst die Angaben noch ändern.“).

## E-025 Abend-Karte ab 18:00

Auf „Heute“ erscheint ab `appConfig.eveningCardFrom` (18:00) eine Karte zum Abend-Check-in. Vorher und wenn die Wiedereinstiegskarte sichtbar ist, gibt es nur einen unauffälligen Link, damit nie zwei Aufforderungen gleichzeitig oben stehen. Nach dem Abschließen steht dort „Tag abgeschlossen.“ mit einem Link zum Ändern.

## E-026 Stimmung und Energie

Beide Angaben sind freiwillige Stufen 1–5 als Umschaltknöpfe. Ein zweiter Tipp auf die gewählte Stufe hebt die Auswahl auf. Eine bereits gespeicherte Angabe lässt sich ändern, aber nicht leeren, weil „nicht angegeben“ und „gelöscht“ sonst nicht unterscheidbar wären.

## E-027 Gegen-Habits

Die beiden vordefinierten Gegen-Habits (Aufschieben, Ausweichen) gibt es höchstens je einmal; ihr Text ist fest, nur das Gewicht lässt sich ändern. Eigene Gegen-Habits haben einen frei bearbeitbaren Text. Gegen-Habits haben keinen Rhythmus, werden jeden Abend gefragt und zählen nicht zur Grenze von zwei Habits im Aufbau. Ab mehr als fünf aktiven Gegen-Habits erscheint ein ruhiger Hinweis, dass der Abend länger dauert; verboten wird nichts.

Im ersten Start fragt ein letzter, freiwilliger Schritt, ob du abends zusätzlich festhalten willst. „Einrichten“ legt beide vordefinierten Gegen-Habits an, „Später“ keines.

## E-028 Ausweichliste

Die App liefert keine vorgegebenen Einträge. Doppelte Einträge werden ohne Groß-/Kleinschreibung erkannt. Ausgeblendete Einträge erscheinen nicht mehr im Abend-Check-in, frühere Angaben bleiben erhalten. Gelöschte Einträge verschwinden aus der Liste; frühere Tage zeigen dafür „+ n gelöschter Eintrag“, am Ergebnis des Tages ändert das nichts. Ein im Abend schnell ergänzter Eintrag ist sofort abgehakt, weil er gerade deshalb hinzugefügt wird.

## E-029 Ausnahmetage

Gründe sind „Krank“, „Urlaub“ und „Anderes“, dazu eine freiwillige Notiz (als Text dargestellt, nie als HTML). Ein Ausnahmetag wird sofort gesetzt und aufgehoben, ohne „Tag abschließen“. Er zählt in keinem Durchschnitt, keiner Quote und keiner Hinweislogik; Angaben des Tages bleiben gespeichert. Ausnahmetage lassen sich für heute und frühere Tage setzen, nicht für die Zukunft.

## E-030 Formulierung für frühere Tage

Beim Nachtragen heißt „nicht gemacht“ für Aufbau-Habits „An dem Tag nicht“. Das beschreibt den Tag, ohne zu werten.
