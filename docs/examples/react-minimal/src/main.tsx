/**
 * React Minimal Integration Example
 *
 * This example demonstrates the minimal setup required to embed
 * the Nomad Dashboard in a React application.
 *
 * To run:
 * 1. npm install
 * 2. npm run dev
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
