import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { Express } from 'express';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Project Nomad API',
      version: '1.0.0',
      description: 'Fire Modeling Backend API for Project Nomad',
      contact: {
        name: 'WISE Developers',
        url: 'https://github.com/WISE-Developers/project_nomad',
      },
    },
    servers: [
      {
        url: '/api/v1',
        description: 'API v1',
      },
    ],
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Error code for programmatic handling' },
                message: { type: 'string', description: 'Human-readable error message' },
                correlationId: { type: 'string', format: 'uuid', description: 'Request correlation ID' },
                details: { type: 'object', description: 'Additional error details' },
              },
              required: ['code', 'message', 'correlationId'],
            },
          },
        },
        Health: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
            timestamp: { type: 'string', format: 'date-time' },
            uptime: { type: 'number', description: 'Uptime in seconds' },
            checks: {
              type: 'object',
              properties: {
                database: {
                  type: 'object',
                  properties: {
                    status: { type: 'string' },
                    latency: { type: 'number' },
                  },
                },
                engines: {
                  type: 'object',
                  additionalProperties: {
                    type: 'object',
                    properties: {
                      available: { type: 'boolean' },
                      version: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        Info: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            version: { type: 'string' },
            environment: { type: 'string' },
            deploymentMode: { type: 'string', enum: ['SAN', 'ACN'] },
            capabilities: {
              type: 'object',
              properties: {
                engines: { type: 'array', items: { type: 'string' } },
                maxJobDuration: { type: 'number', description: 'Max job duration in minutes' },
              },
            },
          },
        },
        Job: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            modelId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed', 'cancelled'] },
            progress: { type: 'number', minimum: 0, maximum: 100 },
            createdAt: { type: 'string', format: 'date-time' },
            startedAt: { type: 'string', format: 'date-time' },
            completedAt: { type: 'string', format: 'date-time' },
            error: { type: 'string' },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Invalid request',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        InternalError: {
          description: 'Internal server error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
  },
  apis: ['./src/api/routes/**/*.ts'],
};

const swaggerSpec = swaggerJsdoc(options);

/**
 * Sets up Swagger UI documentation at /api/docs
 */
export function setupSwagger(app: Express): void {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Project Nomad API Docs',
  }));

  // Also serve raw OpenAPI spec
  app.get('/api/openapi.json', (_req, res) => {
    res.json(swaggerSpec);
  });
}

export { swaggerSpec };
