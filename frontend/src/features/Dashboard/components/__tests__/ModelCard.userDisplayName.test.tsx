import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ModelCard } from '../ModelCard.js';
import type { Model } from '../../../../openNomad/api.js';

const model: Model = {
  id: 'model-1',
  name: 'Test model',
  engine: 'firestarr',
  status: 'completed',
  userId: 'opaque-owner-id',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ModelCard owner display', () => {
  it('prefers the friendly value and falls back to the stable owner ID', () => {
    const { rerender } = render(
      <ModelCard model={{ ...model, userDisplayName: 'owner@example.test' }} />
    );

    expect(screen.getByText('owner@example.test')).toBeInTheDocument();
    expect(screen.queryByText('opaque-owner-id')).not.toBeInTheDocument();

    rerender(<ModelCard model={model} />);

    expect(screen.getByText('opaque-owner-id')).toBeInTheDocument();
  });
});
