// ════════════════════════════════════════════════════════════════
//  GK Groupe inc — Fonction « square » (appelée par le tableau admin)
//  Garde la clé secrète Square côté serveur. Réservée aux comptes admin.
//
//  Actions (POST JSON { action, ... }) :
//    payment_link  { reservation_id, montant, description? }  → crée un lien de paiement Square
//    catalog       {}                                          → services Square Appointments
//    create_booking{ reservation_id, start_at, service_variation_id, service_variation_version,
//                    team_member_id, duration_minutes }        → ajoute le RDV dans l'agenda Square
//    list_bookings { start_at_min?, start_at_max? }            → RDV de l'agenda Square (31 jours max)
//
//  Secrets (Supabase > Edge Functions > Secrets) :
//    SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_ENV (« production » ou « sandbox »)
// ════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const SQUARE_BASE = Deno.env.get('SQUARE_ENV') === 'sandbox'
  ? 'https://connect.squareupsandbox.com'
  : 'https://connect.squareup.com';
const SQUARE_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') ?? '';
const LOCATION_ID = Deno.env.get('SQUARE_LOCATION_ID') ?? '';
const SITE = 'https://gkgroupeinc.com/espace-client';

const SERVICE_LABELS: Record<string, string> = {
  livraison: 'Livraison', demenagement: 'Déménagement',
  service_auto: 'Service auto', detaillage: 'Détaillage auto',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function square(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(SQUARE_BASE + path, {
    method: init.method ?? 'GET',
    headers: {
      'Authorization': `Bearer ${SQUARE_TOKEN}`,
      'Square-Version': '2025-01-23',
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data.errors ?? []).map((e: { detail?: string; code?: string }) => e.detail || e.code).join(' · ');
    throw new HttpError(502, `Square : ${detail || res.statusText}`);
  }
  return data;
}

// Client Square correspondant au courriel du client (créé s'il n'existe pas).
async function findOrCreateCustomer(email: string, nom: string, telephone: string) {
  const found = await square('/v2/customers/search', {
    method: 'POST',
    body: { query: { filter: { email_address: { exact: email } } }, limit: 1 },
  });
  if (found.customers?.length) return found.customers[0].id as string;
  const [prenom, ...reste] = (nom || '').trim().split(/\s+/);
  const created = await square('/v2/customers', {
    method: 'POST',
    body: {
      idempotency_key: crypto.randomUUID(),
      email_address: email,
      given_name: prenom || undefined,
      family_name: reste.join(' ') || undefined,
      phone_number: telephone || undefined,
      reference_id: 'gk-site',
    },
  });
  return created.customer.id as string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (!SQUARE_TOKEN || !LOCATION_ID) throw new HttpError(500, 'Square n\'est pas encore configuré (secrets manquants).');

    // Qui appelle ? On vérifie le jeton de session puis le drapeau is_admin.
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData } = await admin.auth.getUser(jwt);
    if (!userData?.user) throw new HttpError(401, 'Non connecté.');
    const { data: me } = await admin.from('profiles').select('is_admin').eq('id', userData.user.id).maybeSingle();
    if (!me?.is_admin) throw new HttpError(403, 'Réservé aux administrateurs.');

    const body = await req.json().catch(() => ({}));

    async function loadReservation(id: string) {
      const { data, error } = await admin.from('reservations')
        .select('*, profiles(nom_complet, email, telephone)').eq('id', id).maybeSingle();
      if (error || !data) throw new HttpError(404, 'Réservation introuvable.');
      return data;
    }

    switch (body.action) {
      case 'payment_link': {
        const r = await loadReservation(body.reservation_id);
        const montant = Math.round(Number(body.montant) * 100);
        if (!Number.isFinite(montant) || montant < 100) throw new HttpError(400, 'Montant invalide (1 $ minimum).');
        const nom = body.description?.trim() ||
          `${SERVICE_LABELS[r.service] ?? r.service} — ${r.date_souhaitee}`;
        const out = await square('/v2/online-checkout/payment-links', {
          method: 'POST',
          body: {
            idempotency_key: crypto.randomUUID(),
            description: `Réservation ${r.id}`,
            quick_pay: { name: nom, price_money: { amount: montant, currency: 'CAD' }, location_id: LOCATION_ID },
            checkout_options: { redirect_url: `${SITE}?paiement=merci`, ask_for_shipping_address: false },
            pre_populated_data: r.profiles?.email ? { buyer_email: r.profiles.email } : undefined,
            payment_note: `GK Groupe — réservation ${r.id}`,
          },
        });
        const patch = {
          paiement_montant: montant / 100,
          paiement_url: out.payment_link.url,
          paiement_statut: 'en_attente',
          square_order_id: out.payment_link.order_id,
        };
        await admin.from('reservations').update(patch).eq('id', r.id);
        return json(patch);
      }

      case 'catalog': {
        const [items, team] = await Promise.all([
          square('/v2/catalog/search-catalog-items', {
            method: 'POST', body: { product_types: ['APPOINTMENTS_SERVICE'], limit: 100 },
          }),
          square('/v2/bookings/team-member-booking-profiles?bookable_only=true&limit=100'),
        ]);
        const services = (items.items ?? []).flatMap((it: any) =>
          (it.item_data?.variations ?? []).map((v: any) => ({
            id: v.id,
            version: v.version,
            name: it.item_data.variations.length > 1 ? `${it.item_data.name} — ${v.item_variation_data?.name}` : it.item_data.name,
            duration_minutes: Math.round((v.item_variation_data?.service_duration ?? 3600000) / 60000),
            team_member_ids: v.item_variation_data?.team_member_ids ?? [],
          })));
        const members = (team.team_member_booking_profiles ?? []).map((m: any) => ({
          id: m.team_member_id, name: m.display_name,
        }));
        return json({ services, members });
      }

      case 'create_booking': {
        const r = await loadReservation(body.reservation_id);
        if (r.square_booking_id) throw new HttpError(409, 'Déjà dans l\'agenda Square.');
        if (!r.profiles?.email) throw new HttpError(400, 'Le client n\'a pas de courriel.');
        const customerId = await findOrCreateCustomer(r.profiles.email, r.profiles.nom_complet, r.profiles.telephone);
        const vehicule = [r.vehicule_marque, r.vehicule_modele, r.vehicule_annee].filter(Boolean).join(' ');
        const note = [
          `Réservation du site (${SERVICE_LABELS[r.service] ?? r.service})`,
          `Adresse : ${r.adresse}`,
          vehicule && `Véhicule : ${vehicule}`,
          r.details && `Détails : ${r.details}`,
        ].filter(Boolean).join('\n');
        const out = await square('/v2/bookings', {
          method: 'POST',
          body: {
            idempotency_key: crypto.randomUUID(),
            booking: {
              start_at: new Date(body.start_at).toISOString(),
              location_id: LOCATION_ID,
              customer_id: customerId,
              customer_note: note.slice(0, 4096),
              appointment_segments: [{
                duration_minutes: Number(body.duration_minutes) || 60,
                service_variation_id: body.service_variation_id,
                service_variation_version: Number(body.service_variation_version),
                team_member_id: body.team_member_id,
              }],
            },
          },
        });
        const patch = { square_booking_id: out.booking.id, rdv_debut: out.booking.start_at, statut: 'confirmee' };
        await admin.from('reservations').update(patch).eq('id', r.id);
        return json(patch);
      }

      case 'list_bookings': {
        const min = body.start_at_min ? new Date(body.start_at_min) : new Date(Date.now() - 864e5);
        const max = body.start_at_max ? new Date(body.start_at_max) : new Date(min.getTime() + 30 * 864e5);
        const bookings: any[] = [];
        let cursor: string | undefined;
        do {
          const qs = new URLSearchParams({
            location_id: LOCATION_ID, limit: '100',
            start_at_min: min.toISOString(), start_at_max: max.toISOString(),
          });
          if (cursor) qs.set('cursor', cursor);
          const page = await square('/v2/bookings?' + qs);
          bookings.push(...(page.bookings ?? []));
          cursor = page.cursor;
        } while (cursor && bookings.length < 500);

        // Noms des clients et des services, pour un affichage lisible.
        const customerIds = [...new Set(bookings.map((b) => b.customer_id).filter(Boolean))];
        const variationIds = [...new Set(bookings.flatMap((b) => (b.appointment_segments ?? []).map((s: any) => s.service_variation_id)).filter(Boolean))];
        const [customers, catalog] = await Promise.all([
          customerIds.length ? square('/v2/customers/bulk-retrieve', { method: 'POST', body: { customer_ids: customerIds } }) : { responses: {} },
          variationIds.length ? square('/v2/catalog/batch-retrieve', { method: 'POST', body: { object_ids: variationIds, include_related_objects: true } }) : { objects: [], related_objects: [] },
        ]);
        const custName: Record<string, { nom: string; email?: string; telephone?: string }> = {};
        for (const [id, r] of Object.entries<any>(customers.responses ?? {})) {
          const c = r.customer;
          if (c) custName[id] = { nom: [c.given_name, c.family_name].filter(Boolean).join(' ') || c.email_address || 'Client', email: c.email_address, telephone: c.phone_number };
        }
        const itemNames: Record<string, string> = {};
        for (const o of catalog.related_objects ?? []) if (o.type === 'ITEM') itemNames[o.id] = o.item_data?.name;
        const serviceName: Record<string, string> = {};
        for (const o of catalog.objects ?? []) serviceName[o.id] = itemNames[o.item_variation_data?.item_id] ?? o.item_variation_data?.name ?? 'Service';

        const { data: linked } = await admin.from('reservations').select('id, square_booking_id').not('square_booking_id', 'is', null);
        const linkedIds = new Set((linked ?? []).map((l) => l.square_booking_id));

        return json({
          bookings: bookings
            .sort((a, b) => a.start_at.localeCompare(b.start_at))
            .map((b) => ({
              id: b.id,
              start_at: b.start_at,
              status: b.status,
              duration_minutes: (b.appointment_segments ?? []).reduce((t: number, s: any) => t + (s.duration_minutes ?? 0), 0),
              service: (b.appointment_segments ?? []).map((s: any) => serviceName[s.service_variation_id]).filter(Boolean).join(', ') || 'Rendez-vous',
              client: custName[b.customer_id] ?? { nom: 'Client' },
              note: b.customer_note ?? '',
              source: linkedIds.has(b.id) ? 'site' : 'square',
            })),
        });
      }

      default:
        throw new HttpError(400, 'Action inconnue.');
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
