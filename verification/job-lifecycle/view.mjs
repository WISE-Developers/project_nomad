// View for the pstack /statechart skill: labels JobLifecycle states in the words
// an operator sees on the dashboard and in GET /api/v1/jobs/:id.
const jobWords = {
  none: "no job",
  pending: "job pending",
  running: "job running",
  completed: "job completed",
  failed: "job failed",
  cancelled: "job cancelled",
};
const modelWords = {
  draft: "model draft",
  queued: "model queued",
  running: "model running",
  completed: "model completed",
  failed: "model failed",
  cancelled: "model cancelled",
};

export const title = "One model run: job and model status";

export const state = (v) => {
  const server = !v.crashed ? "Server up" : v.recovered ? "After restart" : "Server down";
  const engine = v.container === "running" ? ", engine running" : "";
  return [server, `${jobWords[v.jobSt]}, ${modelWords[v.modelSt]}${engine}`];
};

export const group = (v) => {
  if (["pending", "running"].includes(v.jobSt) || ["queued", "running"].includes(v.modelSt)) return "active";
  if (v.jobSt === "completed" && v.modelSt === "completed") return "succeeded";
  if (v.jobSt === "cancelled") return "cancelled";
  return "ended";
};

export const colors = { active: "blue", succeeded: "teal", cancelled: "purple", ended: "tan" };

const steps = {
  SaveModelQueued: "the model is saved as queued",
  EnqueueJob: "a job is created",
  EngineInitOk: "the engine is prepared",
  EngineInitThrows: "the engine fails to prepare",
  MarkJobRunning: "the job is marked running",
  MarkModelRunning: "the model is marked running",
  StartEngine: "the engine starts",
  ContainerSucceeds: "the engine finishes",
  ContainerFails: "the engine fails",
  EngineReturns: "the run sees the engine end",
  Settle: "the run checks for a cancel",
  CompleteJob: "the job is completed",
  MarkModelCompleted: "the model is completed",
  FailJob: "the job is failed",
  MarkModelFailed: "the model is failed",
  CancelAccepted: "a user asks to cancel",
  CancelRejected: "the cancel is refused",
  CancelStartsKill: "the cancel stops new engine starts",
  ContainerKilled: "the engine is killed",
  KillConfirmed: "the kill is confirmed",
  KillFails: "the kill cannot be confirmed (500)",
  CancelJobWrite: "the job is saved cancelled",
  CancelModelWrite: "the model is saved cancelled",
  ServerCrashes: "the server stops",
  StartupSweep: "the server starts and kills leftover containers",
  StartupSweepFails: "the server cannot clear leftover containers and exits",
  StartupRecovery: "the server recovers its jobs and models",
  Finished: null,
};

export const step = (action) => (action in steps ? steps[action] : action);
