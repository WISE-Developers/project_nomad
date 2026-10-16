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

  it('every branch that renders the settings section also renders CWFIS', () => {
    // #440. CWFIS M3 is public and needs no API key — `useCwfisM3Layers`
    // returns `available: true` unconditionally, which is the whole point of
    // #299. But `CwfisSection` was rendered in only two of the three branches,
    // and the one it was missing from is the empty state reached when CFS is
    // UNAVAILABLE. So the branch that exists *because* there is no CFS key also
    // dropped the section that never depended on one, and a keyless user with
    // no layers could not reach the public layers at all until they added
    // something unrelated first.
    //
    // Same invariant as the ad-hoc assertion above, same yardstick: the
    // settings section is the one with no gate, so anything else ungated must
    // appear wherever it does.
    const missing = branches
      .map((chunk, index) => ({ index, chunk }))
      .filter(({ chunk }) => chunk.includes('{MapSettingsSection}'))
      .filter(({ chunk }) => !chunk.includes('{CwfisSection}'))
      .map(({ index }) => index);

    expect(missing).toEqual([]);
  });

  /**
   * THE PANEL MUST NOT CLIP WHAT IT CANNOT SHOW (#454).
   *
   * Reported with screenshots: adding ad-hoc layers pushed the CFS, CWFIS and
   * basemap sections off the bottom of the panel, and the layer controls above
   * them became unreachable too.
   *
   * Measured in the running app before fixing:
   *
   *   maxHeight    550px
   *   overflowY    hidden
   *   scrollHeight 659   clientHeight 550
   *
   * So 109px of the panel was clipped with NO WAY TO REACH IT. The
   * `overflowY: auto` already in the file sits on the layer LIST only, which
   * is why the list scrolled and everything below it simply vanished.
   *
   * Two invariants, asserted against the source for the same reason this file
   * exists at all: the previous fix in here landed in two of three branches,
   * and the branch it missed was the one this machine takes.
   */
  it('every branch puts its sections inside a scrollable body', () => {
    // A section that cannot be scrolled to is a section that is not there.
    const unscrollable = branches
      .map((chunk, index) => ({ index, chunk }))
      .filter(({ chunk }) => chunk.includes('{MapSettingsSection}'))
      .filter(({ chunk }) => !chunk.includes('style={bodyStyle}'))
      .map(({ index }) => index);

    expect(unscrollable).toEqual([]);
  });

  it('the panel height is budgeted from the viewport, not a fixed pixel count', () => {
    // 550px was a magic number chosen for one screen. On a 1154px-tall viewport
    // it left 600px of space unused while clipping content — the panel was
    // short AND overflowing at the same time.
    const source = readFileSync(PANEL, 'utf8');
    const containerBlock = source.slice(
      source.indexOf('const containerStyle'),
      source.indexOf('const cfsSectionStyle'),
    );
    expect(containerBlock).toContain('maxHeight');
    expect(containerBlock).toMatch(/maxHeight:[^,]*100vh/);
    expect(containerBlock).not.toMatch(/maxHeight:[^,]*'550px'/);
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
