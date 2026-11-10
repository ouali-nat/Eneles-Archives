-- Eneles Archives: catégories de contribution professionnelles et polyvalentes.
alter table public.travaux alter column type set default 'contribution';

alter table public.travaux drop constraint if exists travaux_type_check;
alter table public.travaux add constraint travaux_type_check
check (type in (
  'contribution',
  'analyse',
  'commentaire',
  'synthese',
  'fiche_revision',
  'etude_texte',
  'explication',
  'exercice_corrige',
  'recherche',
  'dissertation',
  'lecon',
  'correction',
  'resume',
  'autre'
));