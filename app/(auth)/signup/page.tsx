import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignupForm } from "@/components/auth/AuthForms";

export default function SignupPage() {
  return (
    <AuthCard
      title="Create your account"
      subtitle="Upload a PDF, set a goal, and learn it properly."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {/* Reads ?next and ?ref from the address. */}
      <Suspense>
        <SignupForm />
      </Suspense>
    </AuthCard>
  );
}
