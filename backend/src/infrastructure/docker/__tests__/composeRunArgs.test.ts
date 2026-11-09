/**
 * The argument vector handed to the engine image (#520).
 *
 * `FireSTARREngine.buildCommand` returns `[binaryPath, ...arguments]` — command[0]
 * is the binary by convention. `NativeBinaryExecutor` honours that convention
 * explicitly (`const [binary, ...args] = options.command`) and spawns the binary with
 * the rest.
 *
 * Docker mode must honour the same convention, because FireSTARR images declare the
 * binary as their ENTRYPOINT (`ENTRYPOINT=["/appl/firestarr/firestarr"]`, CMD null).
 * Passing command[0] through as well makes the binary path arrive as the FIRST
 * POSITIONAL ARGUMENT, shifts every real argument by one, and the engine aborts with
 * `std::invalid_argument: stoi` and exit 133 — no usage message, nothing naming the
 * command we built.
 *
 * This was invisible until #520 because the compose file wrapped the entrypoint in
 * `/bin/sh -c "... exec \"$@\""`, and the shell silently absorbed the duplicate.
 */
import { describe, it, expect } from 'vitest';
import { buildComposeRunArgs } from '../DockerExecutor.js';

const BINARY = '/appl/firestarr/firestarr';
const SIM_DIR = '/appl/data/sims/3ac0770f-a7fd-4d67-9594-fc6729f6fe5e';

/** The real shape of a FireSTARR run, as FireSTARREngine.buildCommand emits it. */
function engineCommand(): string[] {
  return [
    BINARY,
    SIM_DIR,
    '2023-06-19',
    '60.82195581654469',
    '-115.70618034667032',
    '13:00',
    '--tz', '-6',
    '--wx', `${SIM_DIR}/weather.csv`,
    '--ffmc', '83.5',
    '--deterministic',
  ];
}

describe('buildComposeRunArgs', () => {
  it('does not pass the binary path, because the image entrypoint already is the binary', () => {
    const args = buildComposeRunArgs({ service: 'firestarr-app', command: engineCommand() });

    expect(args).not.toContain(BINARY);
  });

  it('puts the simulation directory immediately after the service name', () => {
    const args = buildComposeRunArgs({ service: 'firestarr-app', command: engineCommand() });

    // Whatever follows the service name is argv[1] for the image entrypoint. For
    // FireSTARR that must be the output directory, not a path to itself.
    const serviceIndex = args.indexOf('firestarr-app');
    expect(serviceIndex).toBeGreaterThan(-1);
    expect(args[serviceIndex + 1]).toBe(SIM_DIR);
  });

  it('keeps every real argument, in order, after dropping command[0]', () => {
    const args = buildComposeRunArgs({ service: 'firestarr-app', command: engineCommand() });

    // The positive half: dropping the binary must not drop anything else. A fix that
    // truncated the vector would satisfy the two assertions above.
    expect(args.slice(args.indexOf('firestarr-app') + 1)).toEqual(engineCommand().slice(1));
  });

  it('still emits volumes, env and working directory before the service name', () => {
    const args = buildComposeRunArgs({
      service: 'firestarr-app',
      command: engineCommand(),
      volumes: [{ hostPath: '/data', containerPath: '/appl/data' }],
      env: { PROJ_DATA: '/usr/share/proj' },
      workingDir: '/appl/firestarr',
    });

    const serviceIndex = args.indexOf('firestarr-app');
    const before = args.slice(0, serviceIndex);
    expect(before).toEqual([
      'run', '--rm',
      '-v', '/data:/appl/data',
      '-e', 'PROJ_DATA=/usr/share/proj',
      '-w', '/appl/firestarr',
    ]);
  });

  it('is unchanged for a command that carries no binary path convention', () => {
    // `docker compose run firestarr-app --version` style probes pass a bare flag
    // list. Dropping command[0] blindly would eat the flag, so the drop must be
    // tied to the FireSTARR binary path rather than applied to any first element.
    const args = buildComposeRunArgs({ service: 'firestarr-app', command: ['--version'] });

    const serviceIndex = args.indexOf('firestarr-app');
    expect(args[serviceIndex + 1]).toBe('--version');
  });
});
