--------------------------- MODULE ComposeProject ---------------------------
(***************************************************************************)
(* Two Nomad deployments on ONE Docker daemon. Each labels its FireSTARR   *)
(* containers with its compose project (`docker compose -p <project>`), and *)
(* at boot sweeps away leftover nomad-run-* containers carrying ITS label  *)
(* (DockerExecutor.killLeftovers). The label is the only thing that keeps  *)
(* one deployment's sweep off the other's runs.                            *)
(*                                                                         *)
(* COMPOSE_PROJECT_NAME is either set to the deployment's own name or     *)
(* unset; TLC tries every combination. Startup refuses to run in Docker   *)
(* mode when it is unset (requireComposeProjectName, called from           *)
(* startServer in backend/src/index.ts, before anything touches Docker).   *)
(*                                                                         *)
(* Assumption: two deployments that SET a name set different ones. A name *)
(* is something an operator chose; a default is something two operators   *)
(* get without choosing, and that is what this model is about.            *)
(***************************************************************************)
Deployments == {"a", "b"}

VARIABLES
  cfg,            \* COMPOSE_PROJECT_NAME per deployment: "set" or "unset"
  up,             \* the deployment's backend is serving
  refused,        \* the deployment's backend refused to start (exit 1, reason logged)
  running,        \* the deployment has a FireSTARR container running (one at most)
  label,          \* the compose project label on that container
  killedForeign   \* history: some sweep removed another deployment's container

vars == <<cfg, up, refused, running, label, killedForeign>>

\* The project a deployment's backend would use. Only reached once startup accepted the
\* configuration, so an unset name never gets here.
Project(d) == d

Init ==
  /\ cfg \in [Deployments -> {"set", "unset"}]
  /\ up = [d \in Deployments |-> FALSE]
  /\ refused = [d \in Deployments |-> FALSE]
  /\ running = [d \in Deployments |-> FALSE]
  /\ label = [d \in Deployments |-> "none"]
  /\ killedForeign = FALSE

\* startServer: requireComposeProjectName() throws when COMPOSE_PROJECT_NAME is unset in
\* Docker mode; the catch logs it and exits 1. Nothing touches Docker first.
BootRefused(d) ==
  /\ ~up[d] /\ ~refused[d] /\ cfg[d] = "unset"
  /\ refused' = [refused EXCEPT ![d] = TRUE]
  /\ UNCHANGED <<cfg, up, running, label, killedForeign>>

\* recoverAfterRestart -> killLeftovers: remove every container labelled with this
\* deployment's project, whoever started it.
BootSweeps(d) ==
  /\ ~up[d] /\ ~refused[d] /\ cfg[d] = "set"
  /\ LET hit == {e \in Deployments : running[e] /\ label[e] = Project(d)}
     IN /\ running' = [e \in Deployments |-> running[e] /\ e \notin hit]
        /\ label' = [e \in Deployments |-> IF e \in hit THEN "none" ELSE label[e]]
        /\ killedForeign' = (killedForeign \/ \E e \in hit : e # d)
  /\ up' = [up EXCEPT ![d] = TRUE]
  /\ UNCHANGED <<cfg, refused>>

\* DockerExecutor.runStream: `docker compose -p <project> run --name nomad-run-...`.
StartRun(d) ==
  /\ up[d] /\ ~running[d]
  /\ running' = [running EXCEPT ![d] = TRUE]
  /\ label' = [label EXCEPT ![d] = Project(d)]
  /\ UNCHANGED <<cfg, up, refused, killedForeign>>

RunEnds(d) ==
  /\ running[d]
  /\ running' = [running EXCEPT ![d] = FALSE]
  /\ label' = [label EXCEPT ![d] = "none"]
  /\ UNCHANGED <<cfg, up, refused, killedForeign>>

\* The backend dies; its container, if any, keeps running.
Crash(d) ==
  /\ up[d]
  /\ up' = [up EXCEPT ![d] = FALSE]
  /\ UNCHANGED <<cfg, refused, running, label, killedForeign>>

Idle == UNCHANGED vars

Next == \E d \in Deployments :
          BootRefused(d) \/ BootSweeps(d) \/ StartRun(d) \/ RunEnds(d) \/ Crash(d) \/ Idle

Spec == Init /\ [][Next]_vars

(* ---------------- the rules ---------------- *)

\* A deployment's startup sweep never removes another deployment's container.
NoForeignKill == ~killedForeign

\* A deployment without COMPOSE_PROJECT_NAME never serves in Docker mode.
UnsetNeverServes == \A d \in Deployments : up[d] => cfg[d] = "set"

=============================================================================
