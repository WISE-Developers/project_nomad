/**
 * COMPOSE_PROJECT_NAME, with NO default (verification/job-lifecycle, ComposeProject.tla).
 *
 * In Docker mode every FireSTARR container is started with `docker compose -p <name>`,
 * and at startup the backend removes leftover nomad-run-* containers carrying that label.
 * The label is the only thing that keeps one deployment's sweep off another deployment's
 * runs on the same Docker host. A default is a name two operators get without choosing
 * it - and then each one's restart kills the other's runs. So there is none: Docker mode
 * refuses to start without it.
 */

const WHY =
  'COMPOSE_PROJECT_NAME is not set. In Docker mode (FIRESTARR_EXECUTION_MODE=docker, the ' +
  'default) the backend labels every FireSTARR container with this compose project, and at ' +
  'startup removes leftover containers carrying that label. Without it, deployments on one ' +
  'Docker host would share a guessed name and remove each other\'s runs. Set it in .env to ' +
  'the compose project this deployment runs under (`docker compose ls` shows it), and give ' +
  'every deployment on a host its own.';

type Env = Readonly<Record<string, string | undefined>>;

/** The project name. Throws, explaining why, when it is unset or blank. */
export function composeProjectNameFrom(env: Env): string {
  const name = env.COMPOSE_PROJECT_NAME?.trim();
  if (!name) throw new Error(WHY);
  return name;
}

/**
 * Startup check. Docker mode needs the name; binary mode starts no containers and does not.
 * Throws (and startServer exits 1 with the message) when Docker mode lacks it.
 */
export function requireComposeProjectName(env: Env): string | undefined {
  if (env.FIRESTARR_EXECUTION_MODE?.toLowerCase() === 'binary') return undefined;
  return composeProjectNameFrom(env);
}
