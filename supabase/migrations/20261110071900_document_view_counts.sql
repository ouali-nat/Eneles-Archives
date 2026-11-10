create or replace function public.compter_vues_documents(p_document_ids bigint[])
returns table(document_id bigint, vues bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids bigint[] := coalesce(p_document_ids, array[]::bigint[]);
begin
  if cardinality(v_ids) > 100 then
    raise exception 'La liste est limitée à 100 documents.' using errcode = '22023';
  end if;

  return query
  select d.id, count(v.id)::bigint
  from public."Document" as d
  left join public."Visites_anonymes" as v
    on v.contexte = 'vue_document:' || d.id::text
  where d."Publie" is true
    and d.id = any(v_ids)
  group by d.id;
end;
$$;

revoke all on function public.compter_vues_documents(bigint[]) from public, anon, authenticated;
grant execute on function public.compter_vues_documents(bigint[]) to anon, authenticated;
