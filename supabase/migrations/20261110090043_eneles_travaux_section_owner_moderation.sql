-- Gestion de l'espace Travaux par le propriétaire du document.
-- Le propriétaire est identifié par la liaison Depots_deposants(document_id, user_id).
create policy travaux_lecture_proprietaire_section
on public.travaux for select to authenticated
using (
  exists (
    select 1 from public."Depots_deposants" d
    where d.document_id = travaux.document_id
      and d.user_id = (select auth.uid())
  )
);

create policy travaux_moderation_proprietaire_section
on public.travaux for update to authenticated
using (
  exists (
    select 1 from public."Depots_deposants" d
    where d.document_id = travaux.document_id
      and d.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public."Depots_deposants" d
    where d.document_id = travaux.document_id
      and d.user_id = (select auth.uid())
  )
);

-- Même si l'owner dispose du droit UPDATE pour modérer, il ne peut modifier
-- ni le contenu, ni le titre, ni le type, ni l'auteur d'une contribution.
create or replace function private.eneles_proteger_modification_travail()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and auth.uid() <> old.auteur_id
     and not public.has_admin_permission('reports') then
    if not exists (
      select 1 from public."Depots_deposants" d
      where d.document_id = old.document_id
        and d.user_id = auth.uid()
    ) then
      raise exception 'Modification réservée au contributeur ou au propriétaire de la section';
    end if;
    if new.document_id is distinct from old.document_id
       or new.auteur_id is distinct from old.auteur_id
       or new.auteur_nom is distinct from old.auteur_nom
       or new.titre is distinct from old.titre
       or new.type is distinct from old.type
       or new.contenu is distinct from old.contenu
       or new.created_at is distinct from old.created_at then
      raise exception 'Le propriétaire de section peut uniquement gérer la visibilité des contributions';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.eneles_proteger_modification_travail() from public, anon, authenticated;
drop trigger if exists eneles_travaux_owner_guard on public.travaux;
create trigger eneles_travaux_owner_guard
before update on public.travaux
for each row execute function private.eneles_proteger_modification_travail();

drop policy if exists versions_travaux_lecture_autorisee on public.versions_travaux;
create policy versions_travaux_lecture_autorisee
on public.versions_travaux for select to anon, authenticated
using (
  exists (
    select 1 from public.travaux t
    where t.id = versions_travaux.travail_id
      and (
        t.statut = 'publie'
        or t.auteur_id = (select auth.uid())
        or public.has_admin_permission('reports')
        or exists (
          select 1 from public."Depots_deposants" d
          where d.document_id = t.document_id
            and d.user_id = (select auth.uid())
        )
      )
  )
);

create policy signalements_travaux_lecture_proprietaire_section
on public.signalements_travaux for select to authenticated
using (
  exists (
    select 1 from public.travaux t
    join public."Depots_deposants" d on d.document_id = t.document_id
    where t.id = signalements_travaux.travail_id
      and d.user_id = (select auth.uid())
  )
);

create policy signalements_travaux_traitement_proprietaire_section
on public.signalements_travaux for update to authenticated
using (
  exists (
    select 1 from public.travaux t
    join public."Depots_deposants" d on d.document_id = t.document_id
    where t.id = signalements_travaux.travail_id
      and d.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.travaux t
    join public."Depots_deposants" d on d.document_id = t.document_id
    where t.id = signalements_travaux.travail_id
      and d.user_id = (select auth.uid())
  )
);

grant select on public.signalements_travaux to authenticated;
grant update (statut) on public.signalements_travaux to authenticated;

