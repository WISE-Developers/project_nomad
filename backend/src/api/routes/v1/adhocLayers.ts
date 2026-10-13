/**
 * Shared ad-hoc layers (#315).
 *
 * Papa's design: a **private checkbox** decides storage. Private layers persist
 * to `localStorage` and never reach the server, so everything this route
 * touches is shared with everyone on the deployment. There is no `scope`
 * parameter because arriving here IS the choice.
 *
 * **Deletion is creator-only.** Everyone can hide a shared layer from their own
 * map; only its author removes it for others — *"it disappeared and I do not
 * know why"* is worse during an incident than *"it is wrong and I have hidden
 * it."*
 *
 * A non-creator gets **403, naming the owner**, not 404. Existence is not
 * secret here: `GET` returns every shared layer to every caller, so a 404 would
 * hide nothing a user cannot read one request earlier, while costing them a
 * clear reason. Hiding existence is right when existence is secret; here it is
 * published.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { getAdhocLayerRepository } from '../../../infrastructure/database/repositories/KnexAdhocLayerRepository.js';
import { validateWmsUrl } from '../../../application/wms/validateWmsUrl.js';
import { resolveUserId } from '../../middleware/resolveUserId.js';
import { ValidationError, NotFoundError } from '../../../domain/errors/index.js';

const router = Router();

interface CreateBody {
  name?: unknown;
  serviceUrl?: unknown;
  layerName?: unknown;
  wmsVersion?: unknown;
  legendUrl?: unknown;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ValidationError(`${field} is required`, [{ field, message: 'required' }]);
  }
  return value.trim();
}

router.get('/adhoc-layers', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const layers = await getAdhocLayerRepository().list();
    res.json({
      layers: layers.map((row) => ({
        id: row.id,
        name: row.name,
        serviceUrl: row.service_url,
        layerName: row.layer_name,
        wmsVersion: row.wms_version,
        legendUrl: row.legend_url,
        createdBy: row.created_by,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/adhoc-layers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as CreateBody;

    const name = requireString(body.name, 'name');
    const serviceUrl = requireString(body.serviceUrl, 'serviceUrl');
    const layerName = requireString(body.layerName, 'layerName');

    // The SSRF guard is applied HERE as well as on the capabilities proxy. A
    // stored URL is fetched later by every browser that loads the layer, so a
    // row is a durable instruction to make a request — worth the same check as
    // the one-off fetch.
    const validation = validateWmsUrl(serviceUrl);
    if (!validation.ok) {
      throw new ValidationError(`serviceUrl is not permitted: ${validation.reason}`, [
        { field: 'serviceUrl', message: validation.reason },
      ]);
    }

    const row = {
      id: randomUUID(),
      name,
      service_url: serviceUrl,
      layer_name: layerName,
      wms_version: typeof body.wmsVersion === 'string' ? body.wmsVersion : '1.3.0',
      legend_url: typeof body.legendUrl === 'string' ? body.legendUrl : null,
      // null under NOMAD_AUTH_MODE=none. An unattributed row is honest there;
      // inventing an owner would be worse than admitting there isn't one.
      created_by: resolveUserId(req) ?? null,
      created_at: new Date().toISOString(),
    };

    const created = await getAdhocLayerRepository().create(row);
    res.status(201).json({
      layer: {
        id: created.id,
        name: created.name,
        serviceUrl: created.service_url,
        layerName: created.layer_name,
        wmsVersion: created.wms_version,
        legendUrl: created.legend_url,
        createdBy: created.created_by,
        createdAt: created.created_at,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/adhoc-layers/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const repository = getAdhocLayerRepository();

    const existing = await repository.findById(id);
    if (!existing) {
      // Distinct from the refusal below on purpose: "there is nothing here" and
      // "you may not" are different facts, and a user cannot tell a permissions
      // problem from a stale bookmark if they render the same.
      throw new NotFoundError('Ad-hoc layer', id);
    }

    const caller = resolveUserId(req) ?? null;
    if (existing.created_by !== caller) {
      const owner = existing.created_by ?? 'another user';
      res.status(403).json({
        error: {
          message:
            `This layer was added by ${owner} and only they can remove it. ` +
            `You can hide it from your own map instead.`,
          code: 'NOT_LAYER_OWNER',
        },
      });
      return;
    }

    await repository.deleteById(id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
