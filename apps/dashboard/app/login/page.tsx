import { MessagesSquare } from "lucide-react";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";

import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border bg-surface p-6">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <MessagesSquare aria-hidden="true" className="size-8 text-primary" />
          <h1 className="text-2xl font-semibold">Group Assistant</h1>
          <p className="text-sm text-muted-foreground">Log in to manage the WhatsApp assistant.</p>
        </div>
        {/* The form reads the URL's error parameter, which is request data. */}
        <Suspense fallback={<Skeleton className="h-56 w-full" />}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
