"use client";

import { safeRedirect } from "@/lib/safe-redirect";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandMarks } from "@/components/BrandMarks";
import { Button } from "@/components/ui/button";
import { AuthCard, authInput } from "@/components/essential/auth/AuthFrame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth-context";
import { VerificationModal } from "@/components/essential/auth/OTPModal";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function SignUpPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect");
  const { registerWithEmail, checkEmailExists, isLoading } = useAuth();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    name?: string;
  }>({});
  const [isVerificationModalOpen, setIsVerificationModalOpen] = useState(false);
  const [registrationData, setRegistrationData] = useState<{
    userId?: number;
    email: string;
    isNewUser: boolean;
  } | null>(null);
  const [emailToCheck, setEmailToCheck] = useState("");
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Handle email input change
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const email = e.target.value;
    setEmailToCheck(email);
  };

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setFieldErrors({});
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const terms = formData.get("terms");

    // Validate form
    let hasErrors = false;
    if (!terms) {
      setError("You must accept the terms and conditions to sign up.");
      hasErrors = true;
    }

    if (hasErrors) {
      setIsSubmitting(false);
      return;
    }

    try {
      // Initiate registration process with email and name
      const result = await registerWithEmail(email, name);

      // Set data and open modal for OTP verification
      setRegistrationData(result);
      setIsVerificationModalOpen(true);
    } catch (err) {
      if (err instanceof Error) {
        // The server no longer reports "already exists"; an existing address
        // simply receives a login code and lands in the same modal. Anything
        // reaching here is a genuine failure.
        if (err.message.toLowerCase().includes("email")) {
          setFieldErrors((prev) => ({ ...prev, email: err.message }));
          toast.error(err.message);
        } else {
          toast.error(err.message);
        }
      } else {
        toast.error(
          "There was an error creating your account. Please try again.",
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const loginHref = redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : "/login";

  return (
    <>
      <AuthCard
        title="Create an account"
        description="Free, with unlimited projects and collaborators. We email you a code to confirm the address."
        footer={
          <>
            Already have an account?{" "}
            <Link href={loginHref} className="font-medium text-foreground underline underline-offset-4">
              Sign in
            </Link>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {error && <p className="rounded-[var(--radius)] bg-danger/10 px-3 py-2.5 text-sm text-danger">{error}</p>}
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              autoFocus
              placeholder="Ada Lovelace"
              required
              disabled={isLoading}
              aria-invalid={!!fieldErrors.name || undefined}
              className={cn(authInput, fieldErrors.name && "border-danger")}
            />
            {fieldErrors.name && <p className="text-sm text-danger">{fieldErrors.name}</p>}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@university.edu"
                required
                disabled={isLoading}
                onChange={handleEmailChange}
                aria-invalid={!!fieldErrors.email || undefined}
                className={cn(authInput, fieldErrors.email && "border-danger")}
              />
              {isCheckingEmail && (
                <div className="absolute end-3 top-1/2 -translate-y-1/2">
                  <BrandMarks.spinner className="size-4 animate-spin" />
                </div>
              )}
            </div>
            {fieldErrors.email && <p className="text-sm text-danger">{fieldErrors.email}</p>}
          </div>
          <label htmlFor="terms" className="flex items-start gap-3 text-sm text-muted-foreground">
            <Checkbox id="terms" name="terms" className="mt-0.5" />
            <span>
              I agree to the{" "}
              <Link href="/terms" className="text-foreground underline underline-offset-4">
                terms
              </Link>{" "}
              and the{" "}
              <Link href="/privacy" className="text-foreground underline underline-offset-4">
                privacy policy
              </Link>
              .
            </span>
          </label>
          <Button size="lg" className="w-full" type="submit" disabled={isLoading || isSubmitting}>
            {isLoading || isSubmitting ? (
              <>
                <BrandMarks.spinner className="size-4 animate-spin" />
                Creating your account
              </>
            ) : (
              "Create account"
            )}
          </Button>
        </form>
      </AuthCard>

      {isVerificationModalOpen && registrationData && (
        <VerificationModal
          email={registrationData.email}
          userId={registrationData.userId}
          isOpen={isVerificationModalOpen}
          isNewUser={registrationData.isNewUser}
          onClose={() => {
            setIsVerificationModalOpen(false);
            setRegistrationData(null);
          }}
          onSuccess={() => {
            router.push(safeRedirect(redirect));
          }}
        />
      )}
    </>
  );
}
