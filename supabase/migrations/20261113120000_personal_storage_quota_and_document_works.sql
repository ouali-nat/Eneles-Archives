-- Eneles : quota de stockage des PDF personnels et association de Travaux.
ALTER TABLE public.travaux ADD COLUMN IF NOT EXISTS document_prive_id bigint;
ALTER TABLE public.travaux ALTER COLUMN document_id DROP NOT NULL;
ALTER TABLE public.travaux DROP CONSTRAINT IF EXISTS travaux_document_prive_id_fkey;
ALTER TABLE public.travaux ADD CONSTRAINT travaux_document_prive_id_fkey
  FOREIGN KEY (document_prive_id) REFERENCES public.documents_personnels_prives(id) ON DELETE CASCADE;
ALTER TABLE public.travaux DROP CONSTRAINT IF EXISTS travaux_exactly_one_document_target;
ALTER TABLE public.travaux ADD CONSTRAINT travaux_exactly_one_document_target CHECK (
  (document_id IS NOT NULL AND document_prive_id IS NULL)
  OR (document_id IS NULL AND document_prive_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS travaux_document_prive_created_idx
  ON public.travaux(document_prive_id, created_at DESC) WHERE document_prive_id IS NOT NULL;

ALTER TABLE public.versions_travaux DROP CONSTRAINT IF EXISTS versions_travaux_travail_id_fkey;
ALTER TABLE public.versions_travaux ADD CONSTRAINT versions_travaux_travail_id_fkey
  FOREIGN KEY (travail_id) REFERENCES public.travaux(id) ON DELETE CASCADE;
ALTER TABLE public.signalements_travaux DROP CONSTRAINT IF EXISTS signalements_travaux_travail_id_fkey;
ALTER TABLE public.signalements_travaux ADD CONSTRAINT signalements_travaux_travail_id_fkey
  FOREIGN KEY (travail_id) REFERENCES public.travaux(id) ON DELETE CASCADE;

ALTER TABLE public.documents_personnels_prives ALTER COLUMN taille_octets SET DEFAULT 0;
ALTER TABLE public.documents_personnels_prives ALTER COLUMN taille_octets SET NOT NULL;
ALTER TABLE public.documents_personnels_prives DROP CONSTRAINT IF EXISTS documents_personnels_prives_taille_nonnegative;
ALTER TABLE public.documents_personnels_prives ADD CONSTRAINT documents_personnels_prives_taille_nonnegative CHECK (taille_octets >= 0);

CREATE OR REPLACE FUNCTION private.eneles_guard_personal_storage_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $function$
DECLARE current_bytes bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.taille_octets IS DISTINCT FROM OLD.taille_octets THEN
      RAISE EXCEPTION 'La taille et le propriétaire du fichier sont immuables.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));
  SELECT COALESCE(SUM(d.taille_octets), 0)::bigint INTO current_bytes
  FROM public.documents_personnels_prives AS d WHERE d.user_id = NEW.user_id;
  IF current_bytes + NEW.taille_octets > 1000000000 THEN
    RAISE EXCEPTION 'QUOTA_STOCKAGE_DEPASSE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS eneles_personal_storage_quota_guard ON public.documents_personnels_prives;
CREATE TRIGGER eneles_personal_storage_quota_guard
BEFORE INSERT OR UPDATE OF user_id, taille_octets ON public.documents_personnels_prives
FOR EACH ROW EXECUTE FUNCTION private.eneles_guard_personal_storage_quota();

CREATE OR REPLACE FUNCTION public.aurore_personal_storage_usage()
RETURNS TABLE(documents_count bigint, bytes_used bigint, storage_limit_bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT COUNT(*)::bigint, COALESCE(SUM(d.taille_octets), 0)::bigint, 1000000000::bigint
  FROM public.documents_personnels_prives AS d WHERE d.user_id = auth.uid();
$function$;
REVOKE ALL ON FUNCTION public.aurore_personal_storage_usage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aurore_personal_storage_usage() TO authenticated;

DROP POLICY IF EXISTS travaux_lecture_publique ON public.travaux;
CREATE POLICY travaux_lecture_publique ON public.travaux FOR SELECT TO anon, authenticated
USING (
  (document_id IS NOT NULL AND (
    statut = 'publie' OR auteur_id = (SELECT auth.uid()) OR public.has_admin_permission('reports')
  ))
  OR (document_prive_id IS NOT NULL AND (
    auteur_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.documents_personnels_prives d
               WHERE d.id = travaux.document_prive_id AND d.user_id = (SELECT auth.uid()))
  ))
);

DROP POLICY IF EXISTS travaux_creation_propre ON public.travaux;
CREATE POLICY travaux_creation_propre ON public.travaux FOR INSERT TO authenticated
WITH CHECK (
  auteur_id = (SELECT auth.uid()) AND statut = 'publie'
  AND COALESCE((SELECT p.banni FROM public."Profils" p WHERE p.id = (SELECT auth.uid())), false) = false
  AND (
    (document_id IS NOT NULL AND document_prive_id IS NULL)
    OR (document_id IS NULL AND document_prive_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.documents_personnels_prives d
                    WHERE d.id = travaux.document_prive_id AND d.user_id = (SELECT auth.uid())))
  )
);

DROP POLICY IF EXISTS travaux_moderation_proprietaire_document_prive ON public.travaux;
CREATE POLICY travaux_moderation_proprietaire_document_prive ON public.travaux FOR UPDATE TO authenticated
USING (document_prive_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.documents_personnels_prives d
  WHERE d.id = travaux.document_prive_id AND d.user_id = (SELECT auth.uid())
))
WITH CHECK (document_prive_id IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.documents_personnels_prives d
  WHERE d.id = travaux.document_prive_id AND d.user_id = (SELECT auth.uid())
));

DROP POLICY IF EXISTS signalements_travaux_creation_publique ON public.signalements_travaux;
CREATE POLICY signalements_travaux_creation_publique ON public.signalements_travaux FOR INSERT TO anon, authenticated
WITH CHECK (
  (signale_par IS NULL OR signale_par = (SELECT auth.uid()))
  AND EXISTS (
    SELECT 1 FROM public.travaux t
    WHERE t.id = signalements_travaux.travail_id AND t.statut = 'publie'
    AND (t.document_id IS NOT NULL OR (
      t.document_prive_id IS NOT NULL AND (SELECT auth.uid()) IS NOT NULL
      AND (t.auteur_id = (SELECT auth.uid()) OR EXISTS (
        SELECT 1 FROM public.documents_personnels_prives d
        WHERE d.id = t.document_prive_id AND d.user_id = (SELECT auth.uid())
      ))
    ))
  )
);

DROP POLICY IF EXISTS signalements_travaux_lecture_proprietaire_document_prive ON public.signalements_travaux;
CREATE POLICY signalements_travaux_lecture_proprietaire_document_prive ON public.signalements_travaux FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.travaux t JOIN public.documents_personnels_prives d ON d.id = t.document_prive_id
  WHERE t.id = signalements_travaux.travail_id AND d.user_id = (SELECT auth.uid())
));

DROP POLICY IF EXISTS signalements_travaux_traitement_proprietaire_document_prive ON public.signalements_travaux;
CREATE POLICY signalements_travaux_traitement_proprietaire_document_prive ON public.signalements_travaux FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.travaux t JOIN public.documents_personnels_prives d ON d.id = t.document_prive_id
  WHERE t.id = signalements_travaux.travail_id AND d.user_id = (SELECT auth.uid())
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.travaux t JOIN public.documents_personnels_prives d ON d.id = t.document_prive_id
  WHERE t.id = signalements_travaux.travail_id AND d.user_id = (SELECT auth.uid())
));

DROP POLICY IF EXISTS versions_travaux_lecture_autorisee ON public.versions_travaux;
CREATE POLICY versions_travaux_lecture_autorisee ON public.versions_travaux FOR SELECT TO anon, authenticated
USING (EXISTS (
  SELECT 1 FROM public.travaux t WHERE t.id = versions_travaux.travail_id AND (
    (t.document_id IS NOT NULL AND (
      t.statut = 'publie' OR t.auteur_id = (SELECT auth.uid())
      OR public.has_admin_permission('reports')
      OR EXISTS (SELECT 1 FROM public."Depots_deposants" d
                 WHERE d.document_id = t.document_id AND d.user_id = (SELECT auth.uid()))
    ))
    OR (t.document_prive_id IS NOT NULL AND (
      t.auteur_id = (SELECT auth.uid())
      OR EXISTS (SELECT 1 FROM public.documents_personnels_prives d
                 WHERE d.id = t.document_prive_id AND d.user_id = (SELECT auth.uid()))
    ))
  )
));

CREATE OR REPLACE FUNCTION private.eneles_proteger_modification_travail()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $function$
DECLARE owner_allowed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR public.has_admin_permission('reports') THEN RETURN NEW; END IF;
  IF auth.uid() = OLD.auteur_id THEN
    IF NEW.document_id IS DISTINCT FROM OLD.document_id OR NEW.document_prive_id IS DISTINCT FROM OLD.document_prive_id THEN
      RAISE EXCEPTION 'La cible du travail ne peut pas être modifiée.';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.document_prive_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.documents_personnels_prives d
                   WHERE d.id = OLD.document_prive_id AND d.user_id = auth.uid()) INTO owner_allowed;
  ELSE
    SELECT EXISTS (SELECT 1 FROM public."Depots_deposants" d
                   WHERE d.document_id = OLD.document_id AND d.user_id = auth.uid()) INTO owner_allowed;
  END IF;
  IF NOT owner_allowed THEN RAISE EXCEPTION 'Modification réservée au contributeur ou au propriétaire de la section'; END IF;
  IF NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.document_prive_id IS DISTINCT FROM OLD.document_prive_id
     OR NEW.auteur_id IS DISTINCT FROM OLD.auteur_id
     OR NEW.auteur_nom IS DISTINCT FROM OLD.auteur_nom
     OR NEW.titre IS DISTINCT FROM OLD.titre
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.contenu IS DISTINCT FROM OLD.contenu
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Le propriétaire peut uniquement gérer la visibilité des contributions';
  END IF;
  RETURN NEW;
END;
$function$;
