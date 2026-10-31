export type Priority = "none" | "low" | "medium" | "high" | "urgent";
export type StateGroup = "backlog" | "unstarted" | "started" | "completed" | "cancelled";

export interface User { id: number; email: string; name: string; avatar_color: string }
export interface Member { user: User; role: string; weekly_capacity: number }
export interface Workspace { id: number; name: string; slug: string }
export interface State { id: number; name: string; group: StateGroup; color: string; position: number; wip_limit: number | null }
export interface Label { id: number; name: string; color: string }
export interface Project { id: number; workspace_id: number; name: string; key: string; description: string; color: string; states: State[]; labels: Label[] }
export interface Sprint { id: number; name: string; goal: string; start_date: string; end_date: string; status: "planned" | "active" | "closed" }
export interface Task {
  id: number; key: string; number: number; project_id: number; title: string; description: string;
  state_id: number; priority: Priority; assignee_id: number | null; reporter_id: number | null;
  sprint_id: number | null; parent_id: number | null; estimate: number | null;
  start_date: string | null; due_date: string | null; rank: number; completed_at: string | null;
  archived: boolean; created_at: string; updated_at: string; labels: Label[]; blocked_by: number[]; blocks: number[];
}
export interface Comment { id: number; body: string; created_at: string; author: User }
export interface Activity { id: number; task_id: number; verb: string; field: string | null; old_value: string | null; new_value: string | null; created_at: string; actor: User | null }
export interface Dependency { id: number; blocker_id: number; blocked_id: number }
