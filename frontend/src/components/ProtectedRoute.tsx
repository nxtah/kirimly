"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: "admin" | "user";
}

export default function ProtectedRoute({
  children,
  requiredRole,
}: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace("/login");
      return;
    }

    if (requiredRole && user.role !== requiredRole) {
      // Role mismatch — redirect to appropriate dashboard
      if (user.role === "admin") {
        router.replace("/admin/dashboard");
      } else {
        router.replace("/connect-wa");
      }
    }
  }, [user, loading, router, requiredRole]);

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) return null;

  if (requiredRole && user.role !== requiredRole) return null;

  return <>{children}</>;
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    </div>
  );
}
