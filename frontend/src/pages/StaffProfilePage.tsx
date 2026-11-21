import { useMutation, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Clock, LogIn, LogOut, Mail, Phone, Shield, UserCheck, UserPlus } from "lucide-react";
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { canManage, roleLabel, useAuth } from "../lib/auth";
import { useCurrentProperty } from "../lib/property";
import { hotelToday } from "../lib/reservations";
import { useStaffProfile } from "../lib/reports";
import { Link } from "react-router-dom";

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const formatClock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

export function StaffProfilePage() {
  const property = useCurrentProperty();
  const { user } = useAuth();
  const qc = useQueryClient();
  const today = hotelToday();

  const q = useStaffProfile(property.id);
  const data = q.data;

  const clockIn = useMutation({
    mutationFn: () =>
      api(`/properties/${property.id}/attendance`, {
        method: "POST",
        body: { status: "present" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-profile", property.id] });
      qc.invalidateQueries({ queryKey: ["attendance-report", property.id] });
    },
  });

  const clockOut = useMutation({
    mutationFn: (attId: string) =>
      api(`/properties/${property.id}/attendance/${attId}`, {
        method: "PUT",
        body: { action: "clock_out" },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-profile", property.id] });
      qc.invalidateQueries({ queryKey: ["attendance-report", property.id] });
    },
  });

  if (q.isLoading) return <Spinner label="Loading staff profile…" />;
  if (q.error || !data) return <ErrorNote message={q.error?.message ?? "Couldn't load profile."} onRetry={() => q.refetch()} />;

  const staff = data.staff;
  const history = data.history ?? [];
  const todayAtt = staff.attendanceToday;
  const isOnDuty = todayAtt && !todayAtt.clockOutAt;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Staff Profile & Attendance"
        description="Your staff account details, duty status, and verified attendance report."
        actions={
          canManage(user?.role) && (
            <Link to="/staff">
              <Button variant="secondary" icon={<UserPlus className="size-4" />}>
                Manage all staff
              </Button>
            </Link>
          )
        }
      />

      {/* Staff Card & Today's Duty Status */}
      <div className="grid gap-5 sm:grid-cols-3">
        {/* Profile Card */}
        <Card className="p-5 sm:col-span-2">
          <div className="flex items-start gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xl font-bold text-accent-700">
              {staff.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-xl font-bold text-ink">{staff.name}</h2>
                <span className="inline-flex items-center rounded-md bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 border border-brand-200">
                  {roleLabel[staff.role as keyof typeof roleLabel] ?? staff.role}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted">{property.name}</p>

              <div className="mt-4 flex flex-col gap-2 text-sm text-ink-soft">
                <div className="flex items-center gap-2">
                  <Mail className="size-4 text-muted shrink-0" />
                  <span>{staff.email}</span>
                </div>
                {staff.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="size-4 text-muted shrink-0" />
                    <span>{staff.phone}</span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Shield className="size-4 text-muted shrink-0" />
                  <span>Active staff member · {staff.daysPresent} days recorded present</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Today's Duty Status Card */}
        <Card className="flex flex-col justify-between p-5 border-brand-200 bg-sand/30">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted uppercase tracking-wider">Today's Duty</span>
              <span className="text-xs text-muted font-medium">{today}</span>
            </div>
            <div className="mt-3">
              {isOnDuty ? (
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ready-bg px-2.5 py-0.5 text-xs font-bold text-ready">
                    <span className="size-1.5 rounded-full bg-ready animate-pulse" />
                    On Duty
                  </span>
                  <p className="mt-2 text-xs text-muted">
                    Clocked in at <strong className="text-ink">{formatClock(todayAtt.clockInAt)}</strong>
                  </p>
                </div>
              ) : todayAtt?.clockOutAt ? (
                <div>
                  <span className="inline-flex items-center rounded-full bg-sand px-2.5 py-0.5 text-xs font-semibold text-ink-soft">
                    Completed shift
                  </span>
                  <p className="mt-2 text-xs text-muted">
                    Out at {formatClock(todayAtt.clockOutAt)}
                  </p>
                </div>
              ) : (
                <div>
                  <span className="inline-flex items-center rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-semibold text-accent-700">
                    Not clocked in yet
                  </span>
                  <p className="mt-2 text-xs text-muted">Clock in to record today's attendance.</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5">
            {!todayAtt ? (
              <Button
                className="w-full"
                icon={<LogIn className="size-4" />}
                loading={clockIn.isPending}
                onClick={() => clockIn.mutate()}
              >
                Clock In for Today
              </Button>
            ) : isOnDuty ? (
              <Button
                variant="secondary"
                className="w-full text-danger hover:bg-danger-bg hover:text-danger"
                icon={<LogOut className="size-4" />}
                loading={clockOut.isPending}
                onClick={() => clockOut.mutate(todayAtt.id)}
              >
                Clock Out
              </Button>
            ) : (
              <Button
                variant="secondary"
                className="w-full"
                loading={clockIn.isPending}
                onClick={() => clockIn.mutate()}
              >
                Clock In Again
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* Attendance History Report */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            <UserCheck className="size-5 text-brand-700" />
            <h3 className="font-semibold text-ink">Personal Attendance Report (Past 30 Days)</h3>
          </div>
          {user?.role !== "housekeeping" && (
            <Link to="/reports" className="text-xs font-semibold text-brand-700 hover:underline flex items-center gap-1">
              All staff reports <ArrowRight className="size-3" />
            </Link>
          )}
        </div>

        {history.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <EmptyState
              icon={<Clock className="size-6" />}
              title="No attendance records in the last 30 days"
              body="Attendance is recorded each day you clock in or work at the property."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-sand/40 text-xs font-semibold text-muted uppercase">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Clock In</th>
                  <th className="px-5 py-3">Clock Out</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-sand/30 transition-colors">
                    <td className="px-5 py-3 font-medium text-ink tabular">{dayLabel(`${h.date}T00:00:00+05:30`)}</td>
                    <td className="px-5 py-3 font-mono text-xs tabular text-ink-soft">{formatClock(h.clockInAt)}</td>
                    <td className="px-5 py-3 font-mono text-xs tabular text-ink-soft">
                      {h.clockOutAt ? formatClock(h.clockOutAt) : <span className="text-ready font-medium">On duty</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={clsx(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize",
                          h.status === "present" ? "bg-ready-bg text-ready" : "bg-accent-50 text-accent-700",
                        )}
                      >
                        {h.status.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted">{h.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
