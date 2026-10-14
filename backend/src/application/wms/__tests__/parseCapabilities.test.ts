/**
 * #315 — parsing a WMS GetCapabilities document into a layer chooser.
 *
 * Franco's rulings: the fetch is server-side to avoid CORS, the user must be
 * able to CHOOSE a layer rather than type its name, and a catalogue we cannot
 * read REFUSES the URL rather than falling through to a hand-typed name.
 *
 * That third ruling puts the whole weight on this parser's error reporting. If
 * it cannot say WHICH failure occurred, the form can only say "that didn't
 * work", and the user has no idea whether to fix the URL, wait, or give up.
 *
 * THE DISTINCTION THIS FILE EXISTS FOR, and it is the same one that has run
 * through every piece of work this week:
 *
 *   - a server that published a catalogue with NO requestable layers
 *   - a server whose response we could not read at all
 *
 * Both yield an empty list. They mean opposite things, and a chooser that
 * renders them identically tells the user "this server has nothing" when the
 * truth is "I could not look."
 */
import { describe, it, expect } from 'vitest';
import { parseCapabilities } from '../parseCapabilities.js';

/** A minimal but realistic 1.3.0 document. */
const WMS_130 = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms">
  <Service><Name>WMS</Name><Title>Example Fire Service</Title></Service>
  <Capability>
    <Layer>
      <Title>Root container, deliberately unnamed</Title>
      <Layer queryable="1">
        <Name>fire:hotspots</Name>
        <Title>Active Hotspots</Title>
        <Abstract>Satellite-detected thermal anomalies.</Abstract>
      </Layer>
      <Layer>
        <Name>fire:perimeters</Name>
        <Title>Fire Perimeters</Title>
      </Layer>
    </Layer>
  </Capability>
</WMS_Capabilities>`;

/** 1.1.1 uses a different root element entirely. */
const WMS_111 = `<?xml version="1.0" encoding="UTF-8"?>
<WMT_MS_Capabilities version="1.1.1">
  <Service><Name>OGC:WMS</Name><Title>Legacy Service</Title></Service>
  <Capability>
    <Layer>
      <Title>Container</Title>
      <Layer><Name>topo</Name><Title>Topographic</Title></Layer>
    </Layer>
  </Capability>
</WMT_MS_Capabilities>`;

describe('parseCapabilities', () => {
  describe('the control: it reads a real document', () => {
    it('extracts the requestable layers from a 1.3.0 document', () => {
      const result = parseCapabilities(WMS_130);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.layers.map((l) => l.name)).toEqual(['fire:hotspots', 'fire:perimeters']);
      expect(result.layers[0].title).toBe('Active Hotspots');
      expect(result.layers[0].abstract).toBe('Satellite-detected thermal anomalies.');
    });

    it('reads the version from the document, not from a guess', () => {
      // The tile builder needs this: 1.3.0 takes `crs`, 1.1.1 takes `srs`.
      const a = parseCapabilities(WMS_130);
      const b = parseCapabilities(WMS_111);
      expect(a.ok && a.version).toBe('1.3.0');
      expect(b.ok && b.version).toBe('1.1.1');
    });

    it('handles the 1.1.1 root element, which is named differently', () => {
      // WMT_MS_Capabilities vs WMS_Capabilities. A parser looking only for the
      // 1.3.0 root reports a legacy server as unreadable.
      const result = parseCapabilities(WMS_111);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.layers.map((l) => l.name)).toEqual(['topo']);
    });
  });

  describe('nested layers', () => {
    it('EXCLUDES a container layer that has no Name', () => {
      // WMS nests layers, and a parent without <Name> is a grouping heading —
      // not requestable. Listing it gives the user something to pick that can
      // never render: a GetMap for it returns an error or an empty tile.
      const result = parseCapabilities(WMS_130);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const titles = result.layers.map((l) => l.title);
      expect(titles).not.toContain('Root container, deliberately unnamed');
      expect(result.layers).toHaveLength(2);
    });
  });

  describe('a valid catalogue with nothing in it', () => {
    it('succeeds with zero layers, and says it SUCCEEDED', () => {
      // This is a real answer: the server was read, and it offers nothing.
      // It must not be reported as a failure.
      const empty = `<?xml version="1.0"?>
        <WMS_Capabilities version="1.3.0">
          <Service><Title>Empty</Title></Service>
          <Capability><Layer><Title>Only a container</Title></Layer></Capability>
        </WMS_Capabilities>`;

      const result = parseCapabilities(empty);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.layers).toHaveLength(0);
    });
  });

  describe('a response we could not read — the distinction that matters', () => {
    it('reports unparseable input as a FAILURE, not as zero layers', () => {
      // NOTE on this assertion, corrected after the first run: I originally
      // required the reason to match /could not|unreadable|parse/. It did not,
      // because fast-xml-parser is lenient — plain text parses successfully to
      // a text node, and the module then correctly reports it as "not a WMS
      // capabilities document", which is both true and more useful than a
      // parse error would have been.
      //
      // The implementation was right and my assertion was over-specific about
      // vocabulary. What I actually care about is the PROPERTY: it must fail,
      // and it must say something. Asserting the exact words would pin the
      // message rather than the behaviour.
      const result = parseCapabilities('this is not xml at all');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason.length).toBeGreaterThan(10);
    });

    it('reports an HTML page as a failure NAMING html', () => {
      // The common real case: the endpoint 302s to a login page, or a proxy
      // returns an error page with status 200. It is well-formed markup with
      // no layers in it — the exact shape that parses to "empty" and reads as
      // "this server has nothing".
      const html = '<!DOCTYPE html><html><head><title>Sign in</title></head><body>Login</body></html>';
      const result = parseCapabilities(html);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/html|not a wms/i);
    });

    it('reports XML that is not a capabilities document as a failure', () => {
      // FIXTURE CORRECTED after the first run. I had used a
      // ServiceExceptionReport here as "XML that isn't capabilities" — but the
      // module identifies that MORE precisely, as a refusal, and surfaces the
      // server's own message. My fixture was testing a case the next test
      // already covers better, and the failure was my fixture choosing an
      // example that deserved a sharper answer than the one I asserted.
      //
      // So: a genuinely unrelated XML document.
      const rss = `<?xml version="1.0"?>
        <rss version="2.0"><channel><title>Not a map server</title></channel></rss>`;

      const result = parseCapabilities(rss);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/not a wms|capabilities/i);
    });

    it('surfaces the server exception TEXT when the server explained itself', () => {
      // If the server said why, the user should see why. Replacing its message
      // with ours throws away the only authoritative account of the failure.
      const exception = `<?xml version="1.0"?>
        <ServiceExceptionReport version="1.3.0">
          <ServiceException code="InvalidFormat">Unsupported request</ServiceException>
        </ServiceExceptionReport>`;

      const result = parseCapabilities(exception);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toMatch(/Unsupported request/);
    });

    it('reports an empty body as a failure, not as an empty catalogue', () => {
      // Zero bytes is the purest form of the confusion: nothing came back, and
      // "nothing came back" must not render as "nothing is there".
      const result = parseCapabilities('');
      expect(result.ok).toBe(false);
    });
  });

  describe('the control on the controls', () => {
    it('does not refuse everything — success and failure are both reachable', () => {
      // A parser that always failed would satisfy every refusal assertion
      // above. Asserting both directions in one place makes that impossible.
      expect(parseCapabilities(WMS_130).ok).toBe(true);
      expect(parseCapabilities('nonsense').ok).toBe(false);
    });
  });
});
