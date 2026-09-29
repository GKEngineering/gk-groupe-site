-- ════════════════════════════════════════════════════════════════
--  GK Groupe inc — Soumissions en ligne
--  Le client fait une demande → l'admin la complète (lignes, taxes) et l'envoie
--  → le client la voit, la télécharge en PDF et l'accepte ou la refuse.
--  À lancer après schema.sql (utilise profiles et is_admin). Relançable sans danger.
-- ════════════════════════════════════════════════════════════════

create table if not exists public.soumissions (
  id            uuid primary key default gen_random_uuid(),
  numero        bigint generated always as identity,
  client_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  service       text not null check (service in ('livraison','demenagement','service_auto','detaillage','autre')),
  description   text not null,
  adresse       text,
  date_souhaitee date,
  vehicule_annee  smallint,
  vehicule_marque text,
  vehicule_modele text,
  statut        text not null default 'demandee'
                check (statut in ('demandee','envoyee','acceptee','refusee','annulee')),
  -- Rempli par GK Groupe : [{ "description": "...", "quantite": 1, "prix": 120.00 }]
  lignes        jsonb not null default '[]'::jsonb,
  taxes         boolean not null default true,   -- TPS 5 % + TVQ 9,975 %
  total         numeric(10,2),
  note_admin    text,
  valide_jusqu  date,
  envoyee_at    timestamptz,
  repondue_at   timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.soumissions enable row level security;

drop policy if exists "soum: lecture" on public.soumissions;
create policy "soum: lecture" on public.soumissions for select
  using (client_id = auth.uid() or public.is_admin());
-- Le client crée seulement une demande vide (sans prix).
drop policy if exists "soum: demande" on public.soumissions;
create policy "soum: demande" on public.soumissions for insert
  with check (client_id = auth.uid() and statut = 'demandee' and lignes = '[]'::jsonb and total is null and note_admin is null);
drop policy if exists "soum: admin" on public.soumissions;
create policy "soum: admin" on public.soumissions for all
  using (public.is_admin()) with check (public.is_admin());

-- Réponse du client : accepter / refuser une soumission envoyée, ou annuler sa demande.
create or replace function public.repondre_soumission(p_id uuid, p_reponse text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reponse in ('acceptee', 'refusee') then
    update public.soumissions set statut = p_reponse, repondue_at = now()
    where id = p_id and client_id = auth.uid() and statut = 'envoyee'
      and (valide_jusqu is null or valide_jusqu >= current_date);
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
