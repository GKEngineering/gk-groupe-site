// ════════════════════════════════════════════════════════════════
//  GK Groupe inc — Fonction « square-webhook »
//  Reçoit les notifications de Square et met à jour les réservations :
//    payment.updated  → paiement COMPLETED  : paiement_statut = 'payee'
//    booking.updated  → RDV annulé/déplacé  : statut 'annulee' / nouvelle date
//
//  À déployer SANS vérification JWT (Square n'envoie pas de jeton Supabase) :
//  l'authenticité est vérifiée avec la signature HMAC de Square.
//  Secrets : SQUARE_WEBHOOK_SIGNATURE_KEY, SQUARE_WEBHOOK_URL (l'URL exacte de cette fonction)
// ════════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SIGNATURE_KEY = Deno.env.get('SQUARE_WEBHOOK_SIGNATURE_KEY') ?? '';
const WEBHOOK_URL = Deno.env.get('SQUARE_WEBHOOK_URL') ?? '';

// Square signe « URL de notification + corps brut » en HMAC-SHA256, encodé en base64.
async function isValidSignature(rawBody: string, signature: string) {
  if (!SIGNATURE_KEY || !WEBHOOK_URL || !signature) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SIGNATURE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(WEBHOOK_URL + rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  const raw = await req.text();
  if (!(await isValidSignature(raw, req.headers.get('x-square-hmacsha256-signature') ?? ''))) {
    return new Response('Signature invalide', { status: 401 });
  }

  const event = JSON.parse(raw);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  if (event.type === 'payment.updated' || event.type === 'payment.created') {
    const p = event.data?.object?.payment;
    if (p?.status === 'COMPLETED' && p.order_id) {
      await db.from('reservations').update({ paiement_statut: 'payee' }).eq('square_order_id', p.order_id);
    }
  }

  if (event.type === 'booking.updated' || event.type === 'booking.created') {
    const b = event.data?.object?.booking;
    if (b?.id) {
      const patch: Record<string, unknown> = { rdv_debut: b.start_at };
      if (String(b.status).startsWith('CANCELLED') || b.status === 'DECLINED') patch.statut = 'annulee';
      await db.from('reservations').update(patch).eq('square_booking_id', b.id);
    }
  }

  // Toujours répondre 200 à un événement authentique, sinon Square le renvoie en boucle.
  return new Response('ok');
});
