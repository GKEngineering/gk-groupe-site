-- ════════════════════════════════════════════════════════════════
--  GK Groupe inc — Correctifs de sécurité (novembre 2026)
--  À coller dans Supabase > SQL Editor > New query, puis « Run ».
--  À lancer APRÈS schema.sql, soumissions.sql et factures.sql. Relançable sans danger.
-- ════════════════════════════════════════════════════════════════


-- ── 1. Réservations : un client ne peut pas remplir les colonnes réservées à GK Groupe ──
-- Sans ce trigger, un client pouvait créer (via l'API) une réservation déjà « payée »,
-- avec un faux message de GK Groupe ou un faux lien de paiement.
create or replace function public.reservations_colonnes_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  new.statut            := 'en_attente';
  new.paiement_montant  := null;
  new.paiement_url      := null;
  new.paiement_statut   := null;
  new.square_order_id   := null;
  new.square_booking_id := null;
  new.rdv_debut         := null;
  new.reponse_admin     := null;
  new.repondu_at        := null;
  new.creee_par_admin   := false;
  new.client_nom        := null;
  new.client_telephone  := null;
  new.client_courriel   := null;
  new.created_at        := now();
  return new;
end $$;

drop trigger if exists reservations_colonnes_admin on public.reservations;
create trigger reservations_colonnes_admin before insert on public.reservations
  for each row execute function public.reservations_colonnes_admin();


-- ── 2. Soumissions : même protection pour une demande créée par un client ──
create or replace function public.soumissions_colonnes_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  new.statut       := 'demandee';
  new.lignes       := '[]'::jsonb;
  new.taxes        := true;
  new.total        := null;
  new.note_admin   := null;
  new.valide_jusqu := null;
  new.envoyee_at   := null;
  new.repondue_at  := null;
  new.created_at   := now();
  return new;
end $$;

drop trigger if exists soumissions_colonnes_admin on public.soumissions;
create trigger soumissions_colonnes_admin before insert on public.soumissions
  for each row execute function public.soumissions_colonnes_admin();


-- ── 3. Suivi public : plus de notes internes ──
-- Les numéros de suivi se devinent (GKX-1042, GKX-1043…). Le suivi sans compte ne renvoie
-- donc plus que les statuts et les dates. Le client connecté voit toujours les notes de SES colis.
create or replace function public.suivre_livraison(p_numero text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'numero_suivi', l.numero_suivi,
    'statut',       l.statut,
    'date_prevue',  l.date_prevue,
    'updated_at',   l.updated_at,
    'etapes', coalesce((
      select json_agg(json_build_object('statut', e.statut, 'created_at', e.created_at)
                      order by e.created_at)
      from public.livraison_etapes e where e.livraison_id = l.id), '[]'::json)
  )
  from public.livraisons l
  where upper(l.numero_suivi) = upper(trim(p_numero));
$$;
grant execute on function public.suivre_livraison(text) to anon, authenticated;


-- ── 4. Soumission expirée : date du jour à l'heure du Québec (et non UTC) ──
create or replace function public.repondre_soumission(p_id uuid, p_reponse text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reponse in ('acceptee', 'refusee') then
    update public.soumissions set statut = p_reponse, repondue_at = now()
    where id = p_id and client_id = auth.uid() and statut = 'envoyee'
      and (valide_jusqu is null or valide_jusqu >= (now() at time zone 'America/Toronto')::date);
  elsif p_reponse = 'annulee' then
    update public.soumissions set statut = 'annulee', repondue_at = now()
    where id = p_id and client_id = auth.uid() and statut = 'demandee';
  else
    raise exception 'Réponse invalide';
  end if;
  if not found then
    raise exception 'Soumission introuvable, déjà traitée ou expirée';
  end if;
end $$;
revoke all on function public.repondre_soumission(uuid, text) from public, anon;
grant execute on function public.repondre_soumission(uuid, text) to authenticated;
