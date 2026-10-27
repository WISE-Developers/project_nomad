/**
 * Connects the fire-size ensemble to the review panel (#419).
 *
 * Separate from FireSizeDistribution so the presentation stays a pure function
 * of its resolution and keeps testing without a provider or a fetch.
 */

import { useFireSizes } from '../hooks/useFireSizes';
import { FireSizeDistribution } from './FireSizeDistribution';

export function FireSizeDistributionSection({ modelId }: { modelId: string }) {
  const { resolution, isLoading, error } = useFireSizes(modelId);

  if (isLoading) {
    return (
      <section className="fire-size-distribution">
        <h3>Fire size across simulations</h3>
        <p>Loading fire sizes…</p>
      </section>
    );
  }

  // A failed request is not "no ensemble recorded". Saying so would report an
  // unknown as an answer.
  if (error) {
    return (
      <section className="fire-size-distribution">
        <h3>Fire size across simulations</h3>
        <p className="fire-size-distribution__warning" data-testid="fire-size-error">
          Fire sizes could not be loaded, so whether this run has an ensemble is unknown:{' '}
          {error}
        </p>
      </section>
    );
  }

  if (!resolution) return null;

  return <FireSizeDistribution resolution={resolution} />;
}
