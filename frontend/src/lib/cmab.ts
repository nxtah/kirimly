// Tipe untuk fitur CMAB (LinUCB) — rekomendasi template WhatsApp berbasis context.

export interface CmabScore {
  template_id: number;
  ucb_score: number;
  mean_score: number;
  exploration_bonus: number;
}

export interface CmabContextLabel {
  day_of_week: number;
  hour: number;
  hour_bucket: string;
  audience_label: string;
}

export interface CmabRecommendation {
  decision_id: number;
  recommended_template_id: number;
  scores: CmabScore[];
  context: CmabContextLabel;
}

export interface CmabPerformanceRow {
  template_id: number;
  template_name: string;
  observation_count: number;
  cumulative_reward: number;
  avg_reward: number | null;
  total_contacts: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  recommended_count: number;
  override_count: number;
  override_rate: number | null;
}

export interface CmabDecision {
  id: number;
  context: CmabContextLabel & { run_id: number | null; cluster_no: number | null };
  recommended_template_id: number | null;
  recommended_template_name: string | null;
  selected_template_id: number | null;
  selected_template_name: string | null;
  manual_override: boolean | null;
  reward_status: "pending" | "computed";
  reward: number | null;
  decided_at: string;
  linked_at: string | null;
  reward_computed_at: string | null;
}

export interface CmabSummary {
  arms: number;
  decisions: number;
  observations: number;
  pending_rewards: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface CmabRewardPoint {
  decision_id: number;
  reward: number;
  reward_computed_at: string;
  template_name: string | null;
  cumulative_avg_reward: number;
}

export interface CmabSyntheticArm {
  id: number;
  name: string;
  preferred_hour_bucket: number;
  preferred_audience_bucket: number;
  base_rate: number;
}

export interface CmabEvaluationResult {
  id: number;
  created_at?: string;
  n_contexts: number;
  seed: number;
  arms: CmabSyntheticArm[];
  linucb_cumulative_reward: number[];
  baseline_cumulative_reward: number[];
  linucb_total: number;
  baseline_total: number;
  regret: number;
}

const HOUR_BUCKET_LABELS: Record<string, string> = {
  night: "Malam (00–05)",
  morning: "Pagi (06–11)",
  afternoon: "Siang (12–17)",
  evening: "Sore/Malam (18–23)",
};

const DAY_LABELS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function formatContext(ctx: CmabContextLabel): string {
  const day = DAY_LABELS[ctx.day_of_week] ?? `Hari ${ctx.day_of_week}`;
  const hourLabel = HOUR_BUCKET_LABELS[ctx.hour_bucket] ?? ctx.hour_bucket;
  const audience = ctx.audience_label === "general" ? "Umum" : ctx.audience_label;
  return `${day}, ${ctx.hour}:00 (${hourLabel}) · Audience: ${audience}`;
}
