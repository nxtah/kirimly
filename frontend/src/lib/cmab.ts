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
  base_delivered: number;
  base_read: number;
  base_replied: number;
}

export interface CmabContextDim {
  index: number;
  group: "day_of_week" | "hour_bucket" | "audience" | "bias";
  label: string;
  encoding: string;
}

export interface CmabContextSchema {
  dimension: number;
  groups: Record<string, number>;
  dims: CmabContextDim[];
}

export interface CmabRewardFormula {
  production: string;
  simulation: string;
  weights: { delivered: number; read: number; replied: number };
}

export interface CmabEvaluationConfig {
  context_schema: CmabContextSchema;
  arms: CmabSyntheticArm[];
  reward_formula: CmabRewardFormula;
  baseline_definition: string;
  regret_formula: string;
  default_alpha: number;
  bounds: { min_contexts: number; max_contexts: number; min_trials: number; max_trials: number };
}

export interface CmabEvaluationTrial {
  trial_index: number;
  seed: number;
  linucb_total: number;
  baseline_total: number;
  regret: number;
}

export interface CmabStrategyStats {
  mean_total: number;
  std_total: number;
  ci95: [number, number];
  cumulative_avg_curve: number[];
}

export interface CmabEvaluationResult {
  id: number;
  created_at?: string;
  config: { alpha: number; n_contexts: number; n_trials: number; seed: number };
  arms: CmabSyntheticArm[];
  context_schema: CmabContextSchema;
  reward_formula: CmabRewardFormula;
  baseline_definition: string;
  regret_formula: string;
  linucb: CmabStrategyStats;
  baseline: CmabStrategyStats;
  improvement_pct: number | null;
  avg_regret: number;
  std_regret: number;
  trials: CmabEvaluationTrial[];
}

/** Bentuk yang dikembalikan `GET /evaluations` & `/evaluations/:id` — sama seperti hasil run, minus dokumentasi statis (schema/formula/definisi) yang sudah tersedia lewat `GET /evaluation-config`. */
export type CmabEvaluationSummary = Omit<CmabEvaluationResult, "context_schema" | "reward_formula" | "baseline_definition" | "regret_formula">;

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
