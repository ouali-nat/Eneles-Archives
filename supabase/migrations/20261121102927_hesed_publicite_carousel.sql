-- Hesed Archives: group advertisement slides into manageable carousel campaigns.
alter table public."Publicites"
  add column if not exists carousel_id uuid not null default gen_random_uuid(),
  add column if not exists slide_order integer not null default 0;

alter table public."Publicites"
  add constraint publicites_slide_order_nonnegative
  check (slide_order >= 0);

create unique index if not exists publicites_carousel_slide_order_uidx
  on public."Publicites"(carousel_id, slide_order);

create index if not exists publicites_active_carousel_idx
  on public."Publicites"(active, carousel_id, slide_order);
