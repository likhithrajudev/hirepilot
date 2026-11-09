"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Briefcase, MapPin } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorNote, PageHeader, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import type { HiringJob } from "@/lib/portal";
export default function Careers() {
  const q = useQuery({ queryKey: ["careers"], queryFn: () => api<HiringJob[]>("/careers") });
  return <div className="mx-auto max-w-5xl space-y-8 px-5 py-14"><PageHeader eyebrow="Opportunities at your fingertips" title="Find work that moves you." subtitle="Explore roles published directly on HirePilot. A clear process, from application to decision." actions={<Link href="/applications" className="btn">My applications</Link>} />{q.error && <ErrorNote>{q.error.message}</ErrorNote>}{q.isPending ? <Skeleton className="h-48" /> : !q.data?.length ? <EmptyState icon={<Briefcase size={24} />} title="New opportunities are on the way" body="Published roles will appear here. Check back for your next opportunity." /> : <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">{q.data.map((job) => <li key={job.id}><Link href={`/careers/${job.slug}`} className="group flex items-center gap-4 p-6 transition hover:bg-surface2"><div className="min-w-0 flex-1"><p className="eyebrow mb-2">{job.company}</p><h2 className="text-lg font-semibold group-hover:text-brand">{job.title}</h2><p className="mt-2 flex items-center gap-1.5 text-sm text-muted"><MapPin size={13} />{job.location || "Location to be discussed"}</p></div><ArrowUpRight size={20} className="text-brand" /></Link></li>)}</ul>}</div>;
}
