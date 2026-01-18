/**
 * Native Binary Infrastructure
 *
 * Direct binary execution services for fire modeling engines.
 * Alternative to Docker when engines are installed natively.
 */

export { NativeBinaryExecutor } from './NativeBinaryExecutor.js';
export {
  getNativeBinaryExecutor,
  resetNativeBinaryExecutor,
} from './getNativeBinaryExecutor.js';
