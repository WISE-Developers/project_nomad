/**
 * A drift guard over LayerPanel's RETURN BRANCHES.
 *
 * WHY THIS EXISTS — a real bug, found by looking at the running app and by
 * nothing else (2026-10-14):
 *
 * `LayerPanel` returns from three places: an empty state when CFS is
 * unavailable, an empty state when it is, and the normal list. I added the
 * #315 ad-hoc section to two of them. The one I missed was the one this
 * machine actually takes — no CFS API key — so the feature was complete,
 * fully unit-tested, committed, pushed, and **invisible**.
 *
 * Every test of `AdhocLayerSection` passed, because the component was fine.
 * The wiring was conditional, and a component test cannot see its own
 * absence. This is the #435 lesson in another costume: a value computed and
 * never consumed is not a feature, and here it was a component rendered down
 * only two of three paths.
 *
 * So this asserts the invariant rather than the instance: **every branch that
 * renders the settings section must also render the ad-hoc section.**
 * `MapSettingsSection` is the right yardstick because it is the one section
 * with no gate at all — it appears in all three branches — so anything
 * unconditional must keep it company.
 *
 * It reads the SOURCE, like the migrations-directory guard that caught
 * migration 008 going unregistered. A hand-kept list of branches would drift
 * exactly the way the branches did.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const PANEL = join(__dirname, '..', 'LayerPanel.tsx');

/**
 * Split the file on `return (` so each chunk is one rendered branch.
 *
 * Crude on purpose. A JSX parser would be more precise and would also be a
 * second thing to maintain; what matters here is counting sections per
 * branch, which survives a rough split.
 */
function renderBranches(source: string): string[] {
  return source
    .split(/return \(/)
    .slice(1)
    .filter((chunk) => chunk.includes('layer-panel'));
}

describe('LayerPanel section wiring (convention)', () => {
  const source = readFileSync(PANEL, 'utf-8');
  const branches = renderBranches(source);

  it('the control: the guard can actually see the branches', () => {
    // If this ever reads 0 or 1, the split stopped working and every
    // assertion below would pass by vacuum — the failure mode this whole
    // file exists to prevent, reproduced inside the test.
    expect(branches.length).toBeGreaterThanOrEqual(3);
  });

  it('every branch that renders the settings section also renders the ad-hoc section', () => {
    const missing = branches
      .map((chunk, index) => ({ index, chunk }))
      .filter(({ chunk }) => chunk.includes('{MapSettingsSection}'))
      .filter(({ chunk }) => !chunk.includes('{AdhocSection}'))
      .map(({ index }) => index);

    expect(missing).toEqual([]);
  });

  it('the ad-hoc section is not gated behind the CFS API key', () => {
    // The bug was precisely this: present only where `cfs.available` was
    // true. Ad-hoc layers need no key, and a user with no layers still needs
    // the way in to add one.
    const gated = branches.filter(
      (chunk) => chunk.includes('{CFSSection}') && !chunk.includes('{AdhocSection}'),
    );
    expect(gated).toEqual([]);
  });
});
