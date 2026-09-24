import { z } from 'zod';

export type PromptDef = {
  name: string;
  title: string;
  description: string;
  args: z.ZodType;
  render: (args: Record<string, string | undefined>) => string;
};

const noArgs = z.strictObject({});

function prompt(
  name: string,
  title: string,
  description: string,
  args: z.ZodType,
  render: (args: Record<string, string | undefined>) => string,
): PromptDef {
  return { name, title, description, args, render };
}

export const PROMPT_DEFS: PromptDef[] = [
  prompt(
    'daily_brief',
    'WG-Tagesbericht',
    'Liest Dashboard, Aktivität, Einkauf, Putzplan und Kalender und liefert eine kompakte Lage.',
    z.strictObject({ fokus: z.string().max(200).optional() }),
    (args) => `Erstelle einen kompakten Tagesbericht für die WG.

Vorgehen:
1. dashboard_get für Salden, Ausgaben, offene Einkäufe, fällige Putzaufgaben und WG-Gesundheit.
2. activity_get für Änderungen seit dem letzten Bericht.
3. shopping_list und chores_list für offene Punkte.
4. events_list und absences_list für die nächsten Termine und Abwesenheiten.

Ausgabe (deutsch, höchstens 10 Punkte, keine Tabellen):
- Salden und auffällige Ausgaben
- offene Einkäufe und wer eingekauft hat
- fällige und überfällige Putzaufgaben
- anstehende Termine und Abwesenheiten
- Ankündigungen mit status open
${args.fokus ? `\nZusätzlicher Fokus des Nutzers: ${args.fokus}` : ''}
Nichts erfunden: jeder Punkt muss aus einer Tool-Antwort stammen; fehlende Daten kurz als "keine Daten" markieren.`,
  ),
  prompt(
    'shopping_run',
    'Einkaufstour planen',
    'Fügt die Einkaufsliste mit Vorratsbestand zusammen und liefert eine gruppierte Tourliste.',
    noArgs,
    () => `Plane eine Einkaufstour für die WG.

Vorgehen:
1. shopping_list für alle offenen und gekauften Artikel.
2. inventory_list, um zu prüfen, was bereits im Vorrat ist.

Ausgabe (deutsch):
- Checkliste nach Kategorie oder Laden, offene Artikel zuerst
- pro Artikel: Menge, wer es eingetragen hat, und "bereits im Vorrat" falls zutreffend
- am Ende: gekaufte Artikel, die mit shopping_set_bought als erledigt markiert werden sollten

Nichts ändern: nur planen, keine Shopping-Tools aufrufen.`,
  ),
  prompt(
    'payment_reminder',
    'Zahlungserinnerung entwerfen',
    'Formuliert eine freundliche Erinnerung an offene Salden — nur Entwurf, kein Versand.',
    z.strictObject({ ton: z.string().max(200).optional() }),
    (args) => `Formuliere eine freundliche Zahlungserinnerung für die WG.

Vorgehen:
1. balances_get für offene Salden.
2. reminders_list, um bereits gesendete Erinnerungen zu vermeiden.

Ausgabe (deutsch):
- Anrede und Betreff
- Betrag in Euro, wofür (Ausgabe/Referenz) und fällig seit wann
- eine sachliche, freundliche Formulierung ohne Vorwurf
${args.ton ? `\nGewünschter Ton: ${args.ton}` : ''}
WICHTIG: Nur den Entwurf zurückgeben. reminder_send nicht aufrufen, bevor der Nutzer ausdrücklich zustimmt.`,
  ),
  prompt(
    'settlement_plan',
    'Ausgleich vorschlagen',
    'Ermittelt die minimalen Überweisungen zwischen den Mitgliedern, ohne sie auszuführen.',
    noArgs,
    () => `Schlage den minimalen Geldausgleich zwischen den Mitgliedern vor.

Vorgehen:
1. balances_get für die aktuellen Salden.
2. settlement_preview für die vom Server vorgeschlagenen Überweisungen.

Ausgabe (deutsch):
- Tabelle: von → Betrag → an
- Anzahl der Überweisungen und ob sie die Mindestsumme unterschreiten
- Abweichungen zwischen balances_get und settlement_preview erklären

WICHTIG: settlement_commit nicht aufrufen. Der Plan wird nur vorgeschlagen, die Ausführung braucht eine ausdrückliche Freigabe.`,
  ),
];
