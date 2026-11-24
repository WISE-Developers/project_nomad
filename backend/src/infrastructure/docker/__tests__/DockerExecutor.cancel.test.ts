/**
 * DockerExecutor.cancel stops the FireSTARR CONTAINER, and says so only when it has
 * confirmed it (finding F1 of verification/job-lifecycle).
 *
 * The run is `docker compose run --rm ...`, a CLI process in front of a container.
 * Signalling the CLI is not the same as stopping the container: the container is the
 * daemon's, and it keeps going unless someone kills it by name. So the executor names
 * each run's container, kills it by that name, stops the CLI, and then asks the daemon
 * whether anything by that name is left. It rejects when it cannot confirm that.
 *
 * A fake `docker` on PATH stands for the daemon and holds that one property: the
 * container (a state file) outlives a signal to the CLI, and only `docker kill` /
 * `docker rm -f` on its name removes it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, readdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DockerExecutor } from '../DockerExecutor.js';

const FAKE_DOCKER = `#!/bin/bash
# A container is a file "container-<name>" holding its compose project.
d="$FAKE_DOCKER_DIR"
echo "$*" >> "$d/log"
if [ "$1" = compose ]; then
  name=""; project=""
  args=("$@")
  for ((i=0; i<\${#args[@]}; i++)); do
    [ "\${args[$i]}" = "--name" ] && name="\${args[$((i+1))]}"
    [ "\${args[$i]}" = "-p" ] && project="\${args[$((i+1))]}"
  done
  [ -z "$name" ] && name="anonymous-$$"
  echo "$project" > "$d/container-$name"
  trap 'exit 143' TERM
  while [ -f "$d/container-$name" ]; do sleep 0.05; done
  exit 137
fi
case "$1" in
  kill)
    [ -n "$FAKE_DOCKER_KILL_IGNORED" ] && exit 0
    if [ -f "$d/container-$2" ]; then rm -f "$d/container-$2"; echo "$2"; exit 0; fi
    echo "Error response from daemon: No such container: $2" >&2; exit 1 ;;
  ps)
    [ -n "$FAKE_DOCKER_PS_FAILS" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
    exact=""; prefix=""; label=""; names=""
    for a in "$@"; do
      case "$a" in
        name=*) n="\${a#name=^/}"; case "$n" in *\\$) exact="\${n%\\$}";; *) prefix="$n";; esac ;;
        label=com.docker.compose.project=*) label="\${a#label=com.docker.compose.project=}" ;;
        *Names*) names=1 ;;
      esac
    done
    for f in "$d"/container-*; do
      [ -f "$f" ] || continue
      c="\${f##*/container-}"
      [ -n "$exact" ] && [ "$c" != "$exact" ] && continue
      [ -n "$prefix" ] && case "$c" in "$prefix"*) ;; *) continue;; esac
      [ -n "$label" ] && [ "$(cat "$f")" != "$label" ] && continue
      if [ -n "$names" ]; then echo "$c"; else echo "0123456789ab"; fi
    done
    exit 0 ;;
  rm)
    [ -n "$FAKE_DOCKER_KILL_IGNORED" ] && { echo "removal refused" >&2; exit 1; }
    shift 2
    for c in "$@"; do rm -f "$d/container-$c"; done
    exit 0 ;;
esac
exit 0
`;

let binDir: string;
let stateDir: string;
const originalPath = process.env.PATH;

beforeAll(() => {
  binDir = mkdtempSync(join(tmpdir(), 'fake-docker-bin-'));
  writeFileSync(join(binDir, 'docker'), FAKE_DOCKER);
  chmodSync(join(binDir, 'docker'), 0o755);
  process.env.PATH = `${binDir}:${originalPath}`;
});

const originalProject = process.env.COMPOSE_PROJECT_NAME;

afterAll(() => {
  process.env.PATH = originalPath;
  if (originalProject === undefined) delete process.env.COMPOSE_PROJECT_NAME;
  else process.env.COMPOSE_PROJECT_NAME = originalProject;
  rmSync(binDir, { recursive: true, force: true });
});

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'fake-docker-state-'));
  process.env.FAKE_DOCKER_DIR = stateDir;
  delete process.env.FAKE_DOCKER_KILL_IGNORED;
  delete process.env.FAKE_DOCKER_PS_FAILS;
  process.env.COMPOSE_PROJECT_NAME = 'project_nomad';
});

afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

const containers = () => readdirSync(stateDir).filter((f) => f.startsWith('container-'));
const log = () => (existsSync(join(stateDir, 'log')) ? readFileSync(join(stateDir, 'log'), 'utf8') : '');

function start(executor: DockerExecutor, jobId: string, signal?: AbortSignal) {
  return executor.runStream(
    { service: 'firestarr-app', command: ['--version'], jobId, signal },
    () => {},
  );
}

async function untilContainer() {
  for (let i = 0; i < 100 && containers().length === 0; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  expect(containers()).toHaveLength(1);
}

describe('DockerExecutor.cancel', () => {
  it('kills the container by name, stops the CLI, and leaves nothing running', async () => {
    const executor = new DockerExecutor(stateDir);
    const run = start(executor, 'model-1');
    await untilContainer();

    await executor.cancel('model-1');

    expect(containers()).toEqual([]);
    expect(log()).toMatch(/^kill nomad-run-model-1$/m);
    const result = await run;
    expect(result.success).toBe(true);
    expect(result.success && result.value.exitCode).not.toBe(0);
  });

  it('confirms with the daemon even when nothing was running', async () => {
    const executor = new DockerExecutor(stateDir);
    await executor.cancel('model-idle');
    expect(log()).toMatch(/^ps .*name=\^\/nomad-run-model-idle\$/m);
  });

  it('rejects when the container is still there after the kill', async () => {
    process.env.FAKE_DOCKER_KILL_IGNORED = '1';
    const executor = new DockerExecutor(stateDir);
    const run = start(executor, 'model-2');
    await untilContainer();

    await expect(executor.cancel('model-2')).rejects.toThrow(/nomad-run-model-2/);

    delete process.env.FAKE_DOCKER_KILL_IGNORED;
    for (const c of containers()) rmSync(join(stateDir, c));
    await run;
  });

  it('rejects when the daemon cannot be asked', async () => {
    process.env.FAKE_DOCKER_PS_FAILS = '1';
    const executor = new DockerExecutor(stateDir);
    await expect(executor.cancel('model-3')).rejects.toThrow(/Cannot connect to the Docker daemon/);
  });
});

describe('DockerExecutor.runStream with an aborted signal', () => {
  it('never starts a container', async () => {
    const executor = new DockerExecutor(stateDir);
    const controller = new AbortController();
    controller.abort();

    const result = await start(executor, 'model-4', controller.signal);

    expect(result.success).toBe(false);
    expect(log()).not.toMatch(/compose/);
    expect(containers()).toEqual([]);
  });
});

/**
 * Startup sweep (verification/job-lifecycle, RestartLeavesNoEngine). A backend that died
 * leaves its containers running: signalling the compose CLI does not stop them, and nothing
 * else will. So at boot, before recovery, the executor removes every nomad-run-* container
 * of ITS compose project, and confirms none is left.
 */
describe('DockerExecutor.killLeftovers', () => {
  const PROJECT = 'project_nomad';
  const leftover = (name: string, project = PROJECT) =>
    writeFileSync(join(stateDir, `container-${name}`), `${project}\n`);

  it('removes every leftover nomad-run-* container of this project, and confirms it', async () => {
    leftover('nomad-run-model-a');
    leftover('nomad-run-model-b');

    const removed = await new DockerExecutor(stateDir).killLeftovers();

    expect(removed).toEqual(['nomad-run-model-a', 'nomad-run-model-b']);
    expect(containers()).toEqual([]);
    expect(log()).toMatch(/^rm -f nomad-run-model-a nomad-run-model-b$/m);
  });

  it("leaves other projects' containers and other names alone", async () => {
    leftover('nomad-run-model-a', 'some_other_deployment');
    leftover('postgres');

    expect(await new DockerExecutor(stateDir).killLeftovers()).toEqual([]);
    expect(containers().sort()).toEqual(['container-nomad-run-model-a', 'container-postgres']);
  });

  it('rejects when a leftover is still there after removal', async () => {
    leftover('nomad-run-model-a');
    process.env.FAKE_DOCKER_KILL_IGNORED = '1';

    await expect(new DockerExecutor(stateDir).killLeftovers()).rejects.toThrow(/nomad-run-model-a/);
  });

  it('rejects when the daemon cannot be asked', async () => {
    process.env.FAKE_DOCKER_PS_FAILS = '1';

    await expect(new DockerExecutor(stateDir).killLeftovers()).rejects.toThrow(/Cannot connect to the Docker daemon/);
  });
});

/**
 * No default project (verification/job-lifecycle, ComposeProject.tla). The compose project
 * label is the only thing keeping one deployment's startup sweep off another deployment's
 * runs on the same daemon. A default is a name two operators get without choosing it, so
 * the executor refuses to label or sweep without one.
 */
describe('DockerExecutor without COMPOSE_PROJECT_NAME', () => {
  beforeEach(() => {
    delete process.env.COMPOSE_PROJECT_NAME;
  });

  it('refuses to sweep, naming the key, rather than sweeping a guessed project', async () => {
    writeFileSync(join(stateDir, 'container-nomad-run-someone-else'), 'project_nomad\n');

    await expect(new DockerExecutor(stateDir).killLeftovers()).rejects.toThrow(/COMPOSE_PROJECT_NAME/);
    expect(containers()).toEqual(['container-nomad-run-someone-else']);
  });

  it('refuses to start a run under a guessed project', async () => {
    const result = await start(new DockerExecutor(stateDir), 'model-5');

    expect(result.success).toBe(false);
    expect(!result.success && result.error.message).toMatch(/COMPOSE_PROJECT_NAME/);
    expect(log()).not.toMatch(/compose/);
  });

  it('treats a blank value as unset', async () => {
    process.env.COMPOSE_PROJECT_NAME = '   ';
    await expect(new DockerExecutor(stateDir).killLeftovers()).rejects.toThrow(/COMPOSE_PROJECT_NAME/);
  });
});
