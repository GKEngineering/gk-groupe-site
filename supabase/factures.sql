-- ════════════════════════════════════════════════════════════════
--  GK Groupe inc — Factures finales + réservations créées par l'admin
--  À lancer après schema.sql et soumissions.sql. Relançable sans danger.
-- ════════════════════════════════════════════════════════════════

-- ── Réservations créées par GK Groupe (client au téléphone, sans compte) ──
-- client_id devient facultatif : sans compte, on garde le nom et les coordonnées ici.
alter table public.reservations alter column client_id drop not null;
alter table public.reservations add column if not exists client_nom       text;
alter table public.reservations add column if not exists client_telephone text;
alter table public.reservations add column if not exists client_courriel  text;
alter table public.reservations add column if not exists creee_par_admin  boolean not null default false;


-- ── FACTURES FINALES ────────────────────────────────────────────
-- Créées par l'admin (souvent à partir d'une soumission acceptée), puis envoyées au client.
create table if not exists public.factures (
  id             uuid primary key default gen_random_uuid(),
  numero         bigint generated always as identity,
  client_id      uuid not null references public.profiles(id) on delete cascade,
  soumission_id  uuid references public.soumissions(id) on delete set null,
  service        text not null,
  titre          text not null,
  -- [{ "description": "...", "quantite": 1, "prix": 120.00 }]
  lignes         jsonb not null default '[]'::jsonb,
  taxes          boolean not null default true,   -- TPS 5 % + TVQ 9,975 %
  total          numeric(10,2),
  note           text,
  date_echeance  date,
  statut         text not null default 'brouillon'
                 check (statut in ('brouillon','envoyee','payee','annulee')),
  envoyee_at     timestamptz,
  payee_at       timestamptz,
  created_at     timestamptz not null default now()
);
create unique index if not exists factures_une_par_soumission
  on public.factures (soumission_id) where soumission_id is not null and statut <> 'annulee';

alter table public.factures enable row level security;

-- Le client voit ses factures envoyées (jamais les brouillons).
drop policy if exists "fact: lecture client" on public.factures;
create policy "fact: lecture client" on public.factures for select
  using ((client_id = auth.uid() and statut <> 'brouillon') or public.is_admin());
drop policy if exists "fact: admin" on public.factures;
create policy "fact: admin" on public.factures for all
  using (public.is_admin()) with check (public.is_admin());
