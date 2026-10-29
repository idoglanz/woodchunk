"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { OverviewView } from "@/components/admin/overview";
import { PeopleView } from "@/components/admin/people";
import { PersonSheet } from "@/components/admin/person-sheet";
import { Page } from "@/components/shell/app-shell";
import { Card, EmptyState, PageTitle, Skeleton } from "@/components/ui/misc";
import { Segmented } from "@/components/ui/segmented";
import type { Person } from "@/lib/admin";
import { api, unwrap, type Schemas } from "@/lib/api/client";
import { useMe } from "@/lib/queries";

type Tab = "overview" | "people";
type Range = "30" | "90" | "180";

export function AdminPage() {
  const me = useMe();
  const admin = me.data?.role === "admin";
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState<Range>("30");
  const [open, setOpen] = useState<string | null>(null);
  const days = Number(range);
  const overview = useQuery({
    queryKey: ["admin", "overview", days], enabled: admin, placeholderData: (prev) => prev,
    queryFn: () => unwrap<Schemas["Overview"]>(api.GET("/api/admin/overview", { params: { query: { days } } })),
  });
  const people = useQuery({ queryKey: ["admin", "users"], enabled: admin, queryFn: () => unwrap<Person[]>(api.GET("/api/admin/users")) });

  if (me.data && !admin) return <Page><EmptyState title="Admins only" text="Ask an admin if you need access." /></Page>;
  const failed = overview.error ?? people.error;

  return (
    <Page>
      <div className="flex flex-col gap-6">
        <PageTitle title="Admin" subtitle="How much people use Woodchunk. What they build stays private."
          actions={<Segmented label="Time range" size="sm" value={range} onChange={setRange}
            options={[{ value: "30", label: "30 days" }, { value: "90", label: "90 days" }, { value: "180", label: "180 days" }]} />} />
        <Segmented label="Admin sections" value={tab} onChange={setTab} className="self-start"
          options={[{ value: "overview", label: "Overview" }, { value: "people", label: people.data ? `People · ${people.data.length}` : "People" }]} />
        {failed ? <Card className="p-5 text-[15px] text-kerf">{failed instanceof Error ? failed.message : "Couldn't load the admin data."}</Card> : null}
        {tab === "overview" ? (
          overview.data ? <div className={overview.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}><OverviewView o={overview.data} /></div> : (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24 rounded-[16px]" />)}</div>
              <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-60 rounded-[16px]" />)}</div>
            </div>
          )
        ) : people.data ? <PeopleView people={people.data} onOpen={setOpen} /> : <Skeleton className="h-96 rounded-[16px]" />}
      </div>
      <PersonSheet userId={open} days={days} meId={me.data?.id} onClose={() => setOpen(null)} />
    </Page>
  );
}
