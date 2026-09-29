-- ════════════════════════════════════════════════════════════════
--  GK Groupe inc — Espace client
--  À coller dans Supabase > SQL Editor > New query, puis « Run ».
--  Le script peut être relancé sans danger.
-- ════════════════════════════════════════════════════════════════


-- ── PROFILS CLIENTS ─────────────────────────────────────────────
-- Une ligne par compte, créée automatiquement à l'inscription.
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  nom_complet text,
  telephone   text,
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nom_complet, telephone)
  values (new.id, new.email, new.raw_user_meta_data->>'nom_complet', new.raw_user_meta_data->>'telephone')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;


-- ── RÉSERVATIONS ────────────────────────────────────────────────
create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  service     text not null check (service in ('livraison','demenagement','service_auto','detaillage')),
  date_souhaitee date not null,
  plage_horaire  text not null check (plage_horaire in ('matin','apres_midi','soir')),
  adresse     text not null,
  details     text,
  statut      text not null default 'en_attente'
              check (statut in ('en_attente','confirmee','terminee','annulee')),
  created_at  timestamptz not null default now()
);


-- ── SOUMISSIONS ET FACTURES ─────────────────────────────────────
-- fichier = chemin du PDF dans le bucket « documents », sous la forme
-- <id du client>/<nom du fichier>.pdf
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in ('soumission','facture')),
  numero      text not null,
  titre       text not null,
  montant     numeric(10,2),
  statut      text not null default 'envoyee'
              check (statut in ('envoyee','acceptee','refusee','payee','en_retard')),
  date_doc    date not null default current_date,
  fichier     text,
  created_at  timestamptz not null default now()
);


-- ── LIVRAISONS (SUIVI) ──────────────────────────────────────────
create table if not exists public.livraisons (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references public.profiles(id) on delete set null,
  numero_suivi text not null unique,
  destination  text not null,
  statut       text not null default 'recue'
               check (statut in ('recue','en_preparation','en_route','livree','probleme')),
  date_prevue  date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.livraison_etapes (
  id           bigint generated always as identity primary key,
  livraison_id uuid not null references public.livraisons(id) on delete cascade,
  statut       text not null,
  note         text,
  created_at   timestamptz not null default now()
);

-- Chaque changement de statut ajoute automatiquement une étape à l'historique.
create or replace function public.log_livraison_etape()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.statut is distinct from old.statut then
    insert into public.livraison_etapes (livraison_id, statut) values (new.id, new.statut);
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists livraisons_etape_ins on public.livraisons;
create trigger livraisons_etape_ins after insert on public.livraisons
  for each row execute function public.log_livraison_etape();
drop trigger if exists livraisons_etape_upd on public.livraisons;
create trigger livraisons_etape_upd before update on public.livraisons
  for each row execute function public.log_livraison_etape();


-- ── SÉCURITÉ (Row Level Security) ───────────────────────────────
-- Un client ne voit que SES données. Un admin (profiles.is_admin = true) voit tout.
alter table public.profiles         enable row level security;
alter table public.reservations     enable row level security;
alter table public.documents        enable row level security;
alter table public.livraisons       enable row level security;
alter table public.livraison_etapes enable row level security;

drop policy if exists "profil: lecture" on public.profiles;
create policy "profil: lecture" on public.profiles for select
  using (id = auth.uid() or public.is_admin());
drop policy if exists "profil: modif" on public.profiles;
create policy "profil: modif" on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (public.is_admin() or (id = auth.uid() and is_admin = false));

drop policy if exists "resa: lecture" on public.reservations;
create policy "resa: lecture" on public.reservations for select
  using (client_id = auth.uid() or public.is_admin());
drop policy if exists "resa: creation" on public.reservations;
create policy "resa: creation" on public.reservations for insert
  with check (client_id = auth.uid() and statut = 'en_attente');
drop policy if exists "resa: admin" on public.reservations;
create policy "resa: admin" on public.reservations for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "docs: lecture" on public.documents;
create policy "docs: lecture" on public.documents for select
  using (client_id = auth.uid() or public.is_admin());
drop policy if exists "docs: admin" on public.documents;
create policy "docs: admin" on public.documents for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "livr: lecture" on public.livraisons;
create policy "livr: lecture" on public.livraisons for select
  using (client_id = auth.uid() or public.is_admin());
drop policy if exists "livr: admin" on public.livraisons;
create policy "livr: admin" on public.livraisons for all
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "etapes: lecture" on public.livraison_etapes;
create policy "etapes: lecture" on public.livraison_etapes for select
  using (public.is_admin() or exists (
    select 1 from public.livraisons l where l.id = livraison_id and l.client_id = auth.uid()));
drop policy if exists "etapes: admin" on public.livraison_etapes;
create policy "etapes: admin" on public.livraison_etapes for all
  using (public.is_admin()) with check (public.is_admin());


-- ── ANNULATION D'UNE RÉSERVATION PAR LE CLIENT ──────────────────
-- Le client peut seulement annuler une réservation encore « en attente ».
create or replace function public.annuler_reservation(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.reservations set statut = 'annulee'
  where id = p_id and client_id = auth.uid() and statut = 'en_attente';
  if not found then
    raise exception 'Réservation introuvable ou déjà traitée';
  end if;
end $$;
revoke all on function public.annuler_reservation(uuid) from public, anon;
grant execute on function public.annuler_reservation(uuid) to authenticated;


-- ── SUIVI PUBLIC PAR NUMÉRO ─────────────────────────────────────
-- Permet de suivre un colis sans compte, avec seulement le numéro de suivi.
-- Ne renvoie ni l'adresse complète ni le client.
create or replace function public.suivre_livraison(p_numero text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'numero_suivi', l.numero_suivi,
    'statut',       l.statut,
    'date_prevue',  l.date_prevue,
    'updated_at',   l.updated_at,
    'etapes', coalesce((
      select json_agg(json_build_object('statut', e.statut, 'note', e.note, 'created_at', e.created_at)
                      order by e.created_at)
      from public.livraison_etapes e where e.livraison_id = l.id), '[]'::json)
  )
  from public.livraisons l
  where upper(l.numero_suivi) = upper(trim(p_numero));
$$;
grant execute on function public.suivre_livraison(text) to anon, authenticated;


-- ── STOCKAGE DES PDF (soumissions / factures) ───────────────────
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "pdf: lecture client" on storage.objects;
create policy "pdf: lecture client" on storage.objects for select
  using (bucket_id = 'documents'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
drop policy if exists "pdf: admin" on storage.objects;
create policy "pdf: admin" on storage.objects for all
  using (bucket_id = 'documents' and public.is_admin())
  with check (bucket_id = 'documents' and public.is_admin());
