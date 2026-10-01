import { z } from 'zod';
import { uuid } from './shared.js';
import { defineTool } from './types.js';

const notifyFlags = z.strictObject({
  pushOptIn: z.boolean().optional(),
  notifyAnnouncements: z.boolean().optional(),
  notifyChores: z.boolean().optional(),
  notifyExpenses: z.boolean().optional(),
  notifyShopping: z.boolean().optional(),
  notifyInventory: z.boolean().optional(),
  notifyReminders: z.boolean().optional(),
  notifyChat: z.boolean().optional(),
  notifyEvents: z.boolean().optional(),
  quietStartHour: z.number().int().min(0).max(23).nullable().optional(),
  quietEndHour: z.number().int().min(0).max(23).nullable().optional(),
});

export const memberTools = [
  defineTool({
    name: 'members_list',
    title: 'Mitglieder auflisten',
    description:
      'Alle Mitglieder mit id, name, color, active, paypalMerchantId und viewerIsAdmin; pagination total/limit/offset. limit max 500 (default 100).',
    method: 'GET',
    input: z.strictObject({
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }),
    path: () => ['members'],
    query: (input) => ({ limit: input.limit, offset: input.offset }),
  }),
  defineTool({
    name: 'member_get',
    title: 'Mitglied und offene Salden lesen',
    description:
      'Ein Mitglied plus openBalances (direction owes|owed). paypalMerchantId nur für das eigene Mitglied.',
    method: 'GET',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['members', input.id],
  }),
  defineTool({
    name: 'member_update',
    title: 'Mitglied ändern (Admin/sensibel)',
    description:
      'Setzt active false für einen reversiblen Auszug oder active true zur Reaktivierung. Nur verifizierte Owner oder Admins (sonst not_owner); Admin-Mitglieder können nicht deaktiviert werden (admin_required). active ist erforderlich. PayPal verbindest du über die WG-Einstellungen im Browser; manuelle Kennungen lassen sich hier weder setzen noch löschen.',
    method: 'PATCH',
    gate: 'destructive',
    input: z.strictObject({
      id: uuid,
      active: z.boolean(),
    }),
    path: (input) => ['members', input.id],
    body: (input) => {
      const { id, ...body } = input;
      return body;
    },
  }),
  defineTool({
    name: 'notifications_get',
    title: 'Benachrichtigungseinstellungen lesen',
    description:
      'Alle notify*-Flags, quietStartHour/quietEndHour (0..23), pushOptIn und pushConfigured.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['notifications'],
  }),
  defineTool({
    name: 'notifications_update',
    title: 'Benachrichtigungseinstellungen ändern',
    description:
      'Beliebige notify*-Flags und/oder Ruhezeiten 0..23 setzen (quiet_hours_invalid sonst). pushOptIn false löscht alle Push-Abos. Ohne Felder passiert nichts (antwortet ok).',
    method: 'PATCH',
    input: notifyFlags,
    path: () => ['notifications'],
    body: (input) => input,
  }),
  defineTool({
    name: 'wg_update',
    title: 'WG-Einstellungen ändern (Admin)',
    description:
      'name 1..100, joiningEnabled schaltet den Beitritt um, rotateShareCode true erzeugt einen NEUEN 8-stelligen Beitrittscode und aktiviert joining — der alte Code funktioniert danach nicht mehr. Nur Admin (not_verified/not_admin), mindestens ein Feld.',
    method: 'PATCH',
    gate: 'destructive',
    input: z.strictObject({
      name: z.string().trim().min(1).max(100).optional(),
      joiningEnabled: z.boolean().optional(),
      rotateShareCode: z.boolean().optional(),
    }),
    path: () => [],
    body: (input) => input,
  }),
];
