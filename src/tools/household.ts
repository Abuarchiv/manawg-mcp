import { z } from 'zod';
import { defineTool } from './types.js';

export { defineTool } from './types.js';

const uuid = z.uuid();
const importSource = z.enum(['splitwise_csv', 'splid_csv', 'ocr_text']);

export const householdTools = [
  defineTool({
    name: 'calendar_subscription_get',
    title: 'Kalender-Abo lesen',
    description:
      'Eigene Kalender-Subscription der WG: feedUrl, token, createdAt und revokedAt — oder subscription null, wenn keine existiert. Die feedUrl in eine Kalender-App abonnieren; sie enthält einen Geheimtoken und wird deshalb nie in Chats geteilt.',
    method: 'GET',
    input: z.strictObject({}),
    path: () => ['calendar-subscription'],
  }),
  defineTool({
    name: 'import_preview',
    title: 'Import vorberechnen',
    description:
      'Parst splitwise_csv, splid_csv oder ocr_text (payload als String) ohne etwas zu schreiben: parsed, payloadHash, memberMapping, conflicts und members. memberMapping (Name → memberId oder null) legt die Zuordnung fest, sonst greift der automatische Namensabgleich. Danach import_commit mit gleichem payload und payloadHash aufrufen.',
    method: 'POST',
    input: z.strictObject({
      source: importSource,
      payload: z.string().min(1),
      memberMapping: z.record(z.string(), z.string().nullable()).optional(),
    }),
    path: () => ['imports', 'preview'],
    body: (input) => input,
    readOnly: true,
  }),
  defineTool({
    name: 'import_commit',
    title: 'Import ausführen',
    description:
      'Schreibt die geparsten Ausgaben (skipDuplicates default true). memberMapping ist vollständig und uuid-gebunden; previewPayloadHash aus import_preview schützt vor geändertem payload (payload_changed), skipIndexes ohne Hash liefert preview_hash_required. Antworten von import_preview und import_commit müssen dieselbe payload besitzen.',
    method: 'POST',
    gate: 'destructive',
    input: z.strictObject({
      source: importSource,
      payload: z.string().min(1),
      memberMapping: z.record(z.string(), z.uuid().nullable()),
      previewPayloadHash: z.string().optional(),
      skipDuplicates: z.boolean().default(true),
      skipIndexes: z.array(z.number().int().min(0)).default([]),
    }),
    path: () => ['imports', 'commit'],
    body: (input) => input,
  }),
  defineTool({
    name: 'paypal_order_create',
    title: 'PayPal-Zahlung anlegen',
    description:
      'Erstellt eine PayPal-Order für die offene Schuld fromMemberId → toMemberId und gibt orderId und amountCents zurück. Nur EUR, der Aufrufer muss der debtor sein (not_party_to_debt), das Konto muss verifiziert sein (member_not_verified) und beim Empfänger muss ein PayPal-Merchant hinterlegt sein (paypal_recipient_missing). Die Zahlung bewegt erst paypal_capture Geld.',
    method: 'POST',
    gate: 'destructive',
    input: z.strictObject({ fromMemberId: uuid, toMemberId: uuid }),
    path: () => ['paypal', 'order'],
    body: (input) => ({ ...input, currency: 'EUR' }),
  }),
  defineTool({
    name: 'paypal_capture',
    title: 'PayPal-Zahlung einlösen',
    description:
      'Zahlt die zuvor angelegte Order ein (orderId) und markiert die Splits als beglichen; Antwort status COMPLETED mit amountCents und currency. Nur der anlegendende debtor darf einlösen, bereits erledigte Orders antworten erneut COMPLETED (idempotent). paypal_order_expired, paypal_order_not_found und paypal_not_configured erscheinen als conflict.',
    method: 'POST',
    gate: 'destructive',
    input: z.strictObject({ orderId: z.string().trim().min(1).max(100) }),
    path: () => ['paypal', 'capture'],
    body: (input) => input,
  }),
  defineTool({
    name: 'member_claim',
    title: 'Mitglied mit Account verknüpfen',
    description:
      'Verknüpft das angemeldete Konto dauerhaft mit dem Mitglied id (legacy_member_token wird mitsgesendet). Scheitert mit account_already_linked, member_already_linked oder member_deactivated; nach dem Claim ist der Account-Inhaber dieses Mitglied.',
    method: 'POST',
    gate: 'destructive',
    input: z.strictObject({ id: uuid }),
    path: (input) => ['members', input.id, 'claim'],
  }),
  defineTool({
    name: 'wg_create',
    title: 'Neue WG anlegen',
    description:
      'Legt eine neue WG an (name 1..100, creatorName 1..100) und liefert wg.shareCode sowie creator.token zurück. Account-scoped, hängt aber nicht an die aktuelle WG; anschließend mit MANAWG_WG_CODE neu verbinden, um sie zu nutzen. 3 Anfragen pro Stunde (wg_create_rate_limited).',
    method: 'POST',
    gate: 'destructive',
    scope: 'account',
    input: z.strictObject({
      name: z.string().trim().min(1).max(100),
      creatorName: z.string().trim().min(1).max(100),
    }),
    path: () => ['wg'],
    body: (input) => input,
  }),
];
