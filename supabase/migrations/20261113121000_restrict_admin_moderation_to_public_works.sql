-- Les outils de modération administrateur restent limités à la bibliothèque publique.
DROP POLICY IF EXISTS travaux_moderation_admin ON public.travaux;
CREATE POLICY travaux_moderation_admin ON public.travaux FOR UPDATE TO authenticated
USING (public.has_admin_permission('reports') AND document_id IS NOT NULL)
WITH CHECK (public.has_admin_permission('reports') AND document_id IS NOT NULL);

DROP POLICY IF EXISTS signalements_travaux_lecture_admin ON public.signalements_travaux;
CREATE POLICY signalements_travaux_lecture_admin ON public.signalements_travaux FOR SELECT TO authenticated
USING (
  public.has_admin_permission('reports')
  AND EXISTS (SELECT 1 FROM public.travaux t
              WHERE t.id = signalements_travaux.travail_id AND t.document_id IS NOT NULL)
);
