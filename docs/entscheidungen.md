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

## E-031 Niveau erst ab 14 vollständigen Tagen

Die Zahl „Ø … letzte 28 Tage“ erscheint erst, wenn es in den letzten 28 Tagen mindestens 14 vollständig eingetragene Tage gibt (`warning.avgMinDays`). Vorher steht dort ruhig, wie viele es bisher sind. Ein Tag ist vollständig, wenn jedes an dem Tag geplante Habit eine Angabe hat und er kein Ausnahmetag ist. Die Zahl steht nur im Verlauf, nie auf „Heute“.

## E-032 Diagramm: Band, Linie, Punkte

Das Niveau-Diagramm zeigt die letzten 84 Tage, bei kürzerer Geschichte ab der ersten Aktivierung, mindestens aber 14 Tage. Punkte sind vollständig eingetragene Tage. Das Band reicht vom Ø-Boden bis zur Ø-Decke der jeweils letzten 28 Tage, die Linie ist der Ø der letzten 28 Tage. Unter der Achse stehen Buchstaben für Ausnahmetage (A), Wiedereinstiege (W), Planänderungen (P) und Archivierungen (X). Die Breite des Diagramms richtet sich beim Anzeigen nach dem Bildschirm, damit es auf dem Handy nicht flach wird; Diagramme kommen ohne Bibliothek aus (SVG).

## E-033 Keine Tageswerte als Zahl

Nach US-10 gibt es keine Zahl für einen einzelnen Tag, weder in Tabellen noch in Tooltips. Die Tabellenalternative zeigt deshalb Wochen (neueste zuerst) mit Anzahl eingetragener Tage und dem Ø der letzten 28 Tage am Wochenende, dazu Boden und Decke. Die Diagramme haben Titel und Beschreibung für Screenreader.

## E-034 Vergleich mit früher

Der Vergleich nutzt das 28-Tage-Fenster vor 182 Tagen, wenn es dort mindestens 14 vollständige Tage gibt; sonst die ersten Wochen nach der ersten Aktivierung; sonst „Noch zu wenig Daten für einen Vergleich.“ Gerade pausierte Habits fallen aus beiden Seiten des Vergleichs heraus, damit eine Pause nicht als Veränderung erscheint. Der Hauptwert rechnet pausierte Habits bis zum Tag der Pause mit, weil er die tatsächlichen Tage beschreibt. Archivierte Habits fallen überall rückwirkend heraus und bleiben nur als Markierung (X) sichtbar.

## E-035 Befinden getrennt vom Niveau

Stimmung und Energie bekommen ein eigenes Diagramm mit Punkten (Mittel beider Angaben) und Ø-Linie, aber ohne Boden und Decke. Befinden fließt nicht in den Score ein; es senkt nur die Toleranz der Hinweislogik (E-038).

## E-036 Kalender

Der Kalender zeigt pro Habit einen Monat. Zu sehen sind aktive und pausierte Habits, archivierte nicht. „Heute“ ohne Angabe ist „noch offen“ und wird nicht als fehlender Eintrag gezählt, die Zukunft ist „nicht geplant“. Gegen-Habits nutzen dieselben Symbole ●◐○ mit eigenen Bezeichnungen (eingehalten, teilweise, nicht eingehalten). Jede Zelle hat einen Text für Screenreader. Geblättert werden kann vom Monat der ersten Aktivierung bis zum aktuellen Monat. Die Ereignisliste nennt „Handlung verkleinert“ nur, wenn beim Wiedereinstieg „Kleiner machen“ gewählt und am selben Tag bearbeitet wurde.

## E-037 „Ratsche“ nicht umgesetzt

Die Vorgabe nennt eine „Ratsche“, definiert sie aber nicht. Statt etwas zu erfinden, ist sie nicht umgesetzt. Boden und Decke folgen allein den Formeln aus der Konfiguration.

## E-038 Hinweiskarte

Die Karte erscheint auf „Heute“, wenn die Hinweislogik ein Muster sieht, höchstens einmal je 7 Tage. Muster heißt: In den letzten 7 Kalendertagen liegen mindestens 5 vollständige Tage unter der Tagesgrenze (Boden mal Toleranz 0,6, bei Befinden ≤ 2 Toleranz 0,4), oder der Ø der letzten 28 Tage liegt bei mindestens 14 vollständigen Tagen unter dem Ø-Boden. Einzelne Tage lösen nie etwas aus. Am Tag, an dem sie zuerst erscheint, bleibt sie sichtbar. Jede Wahl blendet sie für 7 Tage aus.

- Die Auswahl, worauf sich die Wahl bezieht, listet aktive Aufbau-Habits, integrierte zuerst; bei nur einem entfällt die Auswahl.
- „So lassen“ ändert nichts außer der Ruhezeit. „Kleiner machen“ und „Auslöser ändern“ öffnen das Bearbeiten-Formular mit Fokus auf dem Feld. „Pausieren“ pausiert das gewählte Habit. „Ausnahmetage nachtragen“ führt zum Abend-Check-in, wo Ausnahmetage gesetzt werden.
- Vorrang auf „Heute“: Wiedereinstieg vor Hinweiskarte vor Abendkarte. Es steht nie mehr als eine Aufforderung oben.

Gespeichert werden nur `lastWarningCardAt` und `warningSnoozedUntil` in den Einstellungen, nie das Muster selbst.

## E-039 Testdaten nur in der Entwicklung

`seed.html` mit `src/dev/seed.ts` erzeugt deterministische Testdaten über rund sieben Monate (Wechsel im Rhythmus, Archivierung, Pause, Lücke mit Wiedereinstieg, Urlaub, Krankheit). Die Seite ist nicht Teil des Builds und nur über `npm run dev` erreichbar. Dieselben Daten nutzen die Integrationstests des Verlaufs.

## E-040 Wochenrückblick folgt in Schritt 7

Werte für den Wochenrückblick kommen mit Schritt 7 und sind hier noch nicht gebaut. Umgesetzt in Schritt 7, siehe E-046.

## E-041 Rückblickswoche und Fälligkeit

Ein Rückblick gehört zu einer Woche, ihr Schlüssel ist der Montag (`weekStart`). Betrachtet werden die sieben Tage bis einschließlich des Rückblickstags (Standard Sonntag, also Montag bis Sonntag). Die Karte erscheint ab dem Rückblickstag und bleibt, bis der Rückblick abgeschlossen oder übersprungen ist oder die nächste Rückblickswoche beginnt. Alte Wochen werden nicht nachgeholt. Überspringen speichert einen leeren Datensatz mit Status `SKIPPED`, damit die Karte verschwindet.

Im Rückblick stehen Habits, die heute aktiv sind und an mindestens einem Tag des Fensters vor dem Rückblickstag aktiv waren. Ein Habit, das erst am Rückblickstag startet, hat noch keine Woche hinter sich. Gibt es kein solches Habit, steht kein Rückblick an.

## E-042 Automatik alle 4 Wochen

Die vier Aussagen zur Automatik erscheinen in jedem 4. Rückblick, gezählt werden alle gespeicherten Rückblicke (auch übersprungene). Gefragt wird für alle Aufbau-Habits im Rückblick, auch integrierte. Gespeichert wird nur, wenn alle vier Aussagen beantwortet sind. Der Verlauf zeigt den Mittelwert mit dem Zusatz „deine Einschätzung“; daraus wird kein Status abgeleitet.

## E-043 Vorschlagsregeln

Vorschläge kommen nur aus festen Regeln (`SUGGESTION_RULES` in `src/domain/review.ts`) und nennen immer den Grund:

- mindestens 3× „Heute nicht“ in der Woche: kleinere Version
- Leichtigkeit 1 oder 2: kleinere Version
- im geplanten Moment „selten“: anderer Auslöser

Eine Steigerung wird nie vorgeschlagen. Die Vorschläge werden beim Abschließen aus denselben Angaben neu berechnet. Wird ein gezeigter Vorschlag nicht gewählt, ruht diese Regel für dieses Habit 28 Tage (`suggestionSnoozes` in den Einstellungen). Überspringen lässt nichts ruhen. In den Einstellungen lassen sich Vorschläge ganz ausschalten.

## E-044 Hinweis im Rückblick

Hätte die Hinweislogik (E-038) an einem Tag der Woche angeschlagen, erscheint der Hinweis auch im Rückblick mit denselben Wahlmöglichkeiten. Die Wahl setzt die Entscheidung des Habits für nächste Woche. Die Ruhezeit der Hinweiskarte auf „Heute“ bleibt davon unberührt.

## E-045 Kompakte Liste

Integrierte Habits und Gegen-Habits stehen in einer kompakten Liste mit „passt“ und „anpassen“. „Passt“ speichert die Entscheidung „so lassen“. „Anpassen“ speichert nichts und bietet nach dem Abschließen einen Link zum Bearbeiten an. Pausieren aus dem Rückblick geschieht in derselben Transaktion wie das Speichern. Nach „etwas kleiner“ oder „anderer Auslöser“ führen Links ins Bearbeiten-Formular mit Fokus auf dem Feld.

## E-046 Rückblick auf „Heute“, im Verlauf und in den Einstellungen

- Vorrang auf „Heute“: Wiedereinstieg vor Hinweiskarte vor Wochenrückblick vor Abendkarte. Ist eine dieser Karten zu sehen, wird die Abendkarte zum Link. Die Seite `#/wochenrueckblick` ist auch erreichbar, wenn der Wiedereinstieg Vorrang hat.
- Der Verlauf zeigt im Kalender je Habit die Rückblickswerte der Wochen, die im Monat beginnen (Leichtigkeit, im geplanten Moment, Automatik).
- Einstellungen: Wochenrückblick an/aus, Wochentag, Vorschläge an/aus. Änderungen werden sofort gespeichert.

## E-047 Exportformat

Eine einzige JSON-Datei mit allen Stores außer `meta`. Sie enthält Format, Formatversion, Exportzeitpunkt und App-Version. Löschmarkierungen gehören dazu, damit „Zusammenführen“ Löschungen auf ein anderes Gerät übertragen kann. Abgeleitete Werte (Score, Status, Boden, Decke, Hinweise) fehlen, denn sie werden beim Laden neu berechnet. Unbekannte Felder werden beim Import verworfen. Neuere Formatversionen lehnt die App ab, statt sie halb zu lesen.

## E-048 Verschlüsselung

Wahlweise mit Passwort (mindestens 8 Zeichen, zweimal eingeben). Verschlüsselt wird mit WebCrypto: AES-GCM 256 mit einem Schlüssel aus PBKDF2-SHA-256 und 600 000 Iterationen. Salt und IV sind je Export zufällig. Die Hülle verrät nur Format und Parameter, keine Inhalte. Das Passwort wird nirgends gespeichert. Geht es verloren, lässt sich die Datei nicht mehr öffnen; das steht beim Export. Beim Einlesen werden unplausible Parameter abgelehnt, etwa eine sehr hohe Iterationszahl oder ein anderes Verfahren.

## E-049 Regeln für „Zusammenführen“

- Datensätze mit derselben ID: Der neuere Stand gewinnt (`updatedAt` oder `deletedAt`). Bei gleichem Zeitpunkt gewinnt eine Löschmarkierung, sonst bleibt der lokale Stand.
- Check-ins sind je Habit und Tag eindeutig. Gibt es auf beiden Seiten verschiedene IDs für denselben Tag, bleibt der neuere. Der andere wird zur Löschmarkierung.
- Tagesdatensätze werden je Datum verglichen. Pro Woche bleibt höchstens ein Rückblick, der neuere.
- Ereignisse werden vereinigt (gleiche ID nur einmal).
- Löschungen wirken weiter: Ein gelöschtes Ziel löscht seine Habits. Gelöschte Habits verlieren ihre Check-ins, Ereignisse und Rückblick-Einträge.
- Einstellungen: Der neuere Stand gewinnt. Der erste Start ist der früheste der beiden, der letzte Export der späteste.
- Dieselbe Datei zweimal einzuspielen ändert nichts.
- Die Grenze von zwei Habits im Aufbau wird beim Zusammenführen nicht erzwungen. Kommen so mehr zusammen, bleiben alle bestehen. Neue Habits lassen sich erst wieder anlegen, wenn Platz ist.

## E-050 Sicherheitskopie und Prüfung vor dem Ersetzen

Vor „Ersetzen“ speichert die App automatisch eine Sicherheitskopie des aktuellen Stands als Datei (`live-sicherheitskopie-…json`). Scheitert das, wird nichts ersetzt. Das Ersetzen selbst läuft in einer Transaktion. Eine Datei, der ein Store fehlt, gilt als ungültig, statt als leerer Store gelesen zu werden. Sonst könnte eine unvollständige Datei beim Ersetzen still Daten löschen.

## E-051 Backup-Hinweis

- **Wann:** Die Karte auf „Heute“ erscheint, wenn der letzte Export mehr als 14 Tage zurückliegt. Ohne Export zählt der erste Start.
- **Vorrang:** Sie hat den niedrigsten Vorrang aller Karten (nach Wiedereinstieg, Hinweiskarte, Wochenrückblick und Abendkarte). So drängt sie sich nicht vor das Eintragen.
- **Text:** „Exportieren“ führt zu `#/daten`. „Später“ blendet die Karte für heute aus; das steht in `ui-memory`, nicht in der Datenbank.
- **Einstellungen:** Dort lässt sich der Hinweis abschalten, und der Zeitpunkt des letzten Exports ist zu sehen.
- **Was zählt:** Ein Export zählt erst nach dem Speichern oder Teilen. Ein eingespielter Stand zählt mit seinem Exportzeitpunkt.

## E-052 Import nur aus den Einstellungen, „Alle Daten löschen“

- **Import:** Er ist über Einstellungen → „Exportieren und importieren“ erreichbar, nicht aus dem ersten Start. Wer auf einem neuen Gerät anfängt, durchläuft den kurzen ersten Start und ersetzt danach den Bestand. Ein eigener Einstieg im ersten Start wäre zusätzlicher Umfang, der nicht verlangt war.
- **Alle Daten löschen:** Das verlangt die Eingabe „löschen“. Dann wird die Datenbank vollständig entfernt, Löschmarkierungen eingeschlossen, ebenso die Merkwerte im localStorage. Danach beginnt die App mit dem ersten Start.
