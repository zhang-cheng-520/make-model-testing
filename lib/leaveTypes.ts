// Fixed leave_type values (leave_periods.leave_type) for the LOA Management
// Portal. Not DB-managed — same pattern as lib/categories.ts.
export const LEAVE_TYPE_OPTIONS = ["LOA", "Annual Leave", "Medical Leave", "Other"] as const;

export type LeaveType = (typeof LEAVE_TYPE_OPTIONS)[number];

export function isValidLeaveType(value: string): value is LeaveType {
  return (LEAVE_TYPE_OPTIONS as readonly string[]).includes(value);
}
