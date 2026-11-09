"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";

/** Signed-in visitors have no use for the sales page: send them to the app. Renders nothing. */
export default function RedirectIfAuthed() {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => { if (status === "authed") router.replace("/home"); }, [status, router]);
  return null;
}
