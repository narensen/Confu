import Link from "next/link";
import { Suspense } from "react";
import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/AuthForms";

export default function LoginPage() {
  return (
    <AuthCard
      title="Welcome back"
      subtitle="Pick up where you left off."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className="font-medium text-ink underline-offset-4 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthCard>
  );
}
