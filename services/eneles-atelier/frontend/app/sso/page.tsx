"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function EnelesSsoPage() {
  const { isAuthenticated, isInitialized, error } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <section className="w-full max-w-md rounded-2xl border border-line bg-card p-7 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Eneles Atelier</p>
        <h1 className="mt-3 text-2xl font-semibold">Ouverture de votre espace</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Votre session Eneles sécurisée est vérifiée automatiquement. Aucune deuxième connexion n’est nécessaire.</p>
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
        {!isInitialized && <p className="mt-5 text-sm text-muted-foreground">Connexion en cours…</p>}
        {isInitialized && !isAuthenticated && !error && <p className="mt-5 text-sm text-muted-foreground">Connectez-vous d’abord à Eneles, puis rouvrez l’atelier.</p>}
      </section>
    </main>
  );
}
