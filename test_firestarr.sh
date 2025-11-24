#!/bin/bash
# FireSTARR Test Script

echo "Testing FireSTARR in test mode (synthetic fuel grid)..."
echo "This mode doesn't require fuel/DEM grids to be present."

# Test mode creates synthetic grids
docker compose run --rm firestarr /appl/firestarr/firestarr test \
  /appl/data/sims/test_fire \
  --hours 5 \
  --fuel C-2 \
  --ffmc 90 \
  --ws 20

echo ""
echo "Check output at: ./firestarr_data/sims/test_fire/"
echo ""
echo "Expected outputs:"
echo "  - probability_*.tif files"
echo "  - firestarr.log"
echo ""
echo "Success check:"
grep -q "Total simulation time was" ./firestarr_data/sims/test_fire/firestarr.log && \
  echo "✅ SUCCESS" || echo "❌ FAILED - check firestarr.log"
