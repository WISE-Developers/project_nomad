# Backend Binary Execution Mode Plan

## Summary

Add support for `FIRESTARR_EXECUTION_MODE=binary` to allow running FireSTARR as a native binary instead of in Docker containers. This enables the hybrid installer configurations (Nomad Docker + FireSTARR Metal, All Metal).

## Current Architecture

```
API Request → FireSTARREngine → DockerExecutor → docker compose run firestarr-app
                    ↓
         FireSTARRInputGenerator (creates working dir, weather.csv, perimeter.tif)
                    ↓
         FireSTARROutputParser (converts outputs to results)
```

**Key Abstraction:** `IContainerExecutor` interface already exists, making this a clean extension.

## Implementation

### 1. Create NativeBinaryExecutor

**File:** `backend/src/infrastructure/nativebinary/NativeBinaryExecutor.ts`

Implements `IContainerExecutor` interface:
- `run()` - Execute binary and wait for completion
- `runStream()` - Execute with streaming output (for progress tracking)
- `isAvailable()` - Check if binary exists and is executable
- `isServiceAvailable()` - Always true (no service concept for native)

**Key differences from DockerExecutor:**
- Uses `child_process.spawn()` directly instead of `docker compose run`
- Binary path from `FIRESTARR_BINARY_PATH` env var
- Working directory paths are host paths (no `/appl/data` container mapping)
- No Docker socket required

### 2. Create Executor Factory

**File:** `backend/src/infrastructure/execution/getExecutor.ts`

```typescript
export function getFireSTARRExecutor(): IContainerExecutor {
  const mode = process.env.FIRESTARR_EXECUTION_MODE || 'docker';

  if (mode === 'binary') {
    return getNativeBinaryExecutor();
  }
  return getDockerExecutor();
}
```

### 3. Modify FireSTARREngine

**File:** `backend/src/infrastructure/firestarr/FireSTARREngine.ts`

Changes:
- Replace `this.dockerExecutor` with `this.executor`
- Use factory function instead of hardcoded `getDockerExecutor()`
- Conditional path handling: container paths vs host paths

```typescript
// Current (line 82):
this.dockerExecutor = dockerExecutor ?? getDockerExecutor();

// New:
this.executor = containerExecutor ?? getFireSTARRExecutor();
```

### 4. Update Path Handling

**In FireSTARREngine.buildCommand():**

Docker mode:
```typescript
const workingDir = `/appl/data/sims/${modelId}`;
const binary = '/appl/firestarr/firestarr';
```

Binary mode:
```typescript
const workingDir = `${FIRESTARR_DATASET_PATH}/sims/${modelId}`;
const binary = process.env.FIRESTARR_BINARY_PATH;
```

### 5. Add Environment Validation

**File:** `backend/src/core/config/EnvironmentService.ts`

Add validation method:
```typescript
getFireSTARRExecutionMode(): 'docker' | 'binary' {
  const mode = this.get('FIRESTARR_EXECUTION_MODE') || 'docker';

  if (mode === 'binary') {
    const binaryPath = this.get('FIRESTARR_BINARY_PATH');
    if (!binaryPath) {
      throw new Error('FIRESTARR_EXECUTION_MODE=binary requires FIRESTARR_BINARY_PATH');
    }
  }

  return mode as 'docker' | 'binary';
}
```

### 6. Export from Index

**File:** `backend/src/infrastructure/nativebinary/index.ts`

```typescript
export { NativeBinaryExecutor } from './NativeBinaryExecutor';
export { getNativeBinaryExecutor } from './getNativeBinaryExecutor';
```

## Files to Create

| File | Purpose |
|------|---------|
| `backend/src/infrastructure/nativebinary/NativeBinaryExecutor.ts` | Main executor class |
| `backend/src/infrastructure/nativebinary/getNativeBinaryExecutor.ts` | Singleton factory |
| `backend/src/infrastructure/nativebinary/index.ts` | Exports |
| `backend/src/infrastructure/execution/getExecutor.ts` | Mode-based factory |

## Files to Modify

| File | Changes |
|------|---------|
| `backend/src/infrastructure/firestarr/FireSTARREngine.ts` | Use factory, conditional paths |
| `backend/src/core/config/EnvironmentService.ts` | Add validation method |

## Files Unchanged

- `FireSTARRInputGenerator.ts` - Works with host paths already
- `FireSTARROutputParser.ts` - Parses files regardless of execution mode
- API routes - Engine abstraction handles it
- Frontend - No changes needed

## Testing

1. Unit tests for `NativeBinaryExecutor`
2. Integration test with mock binary
3. Manual test with actual FireSTARR binary (if available)

## Verification

1. Set `FIRESTARR_EXECUTION_MODE=docker` → verify Docker execution still works
2. Set `FIRESTARR_EXECUTION_MODE=binary` without `FIRESTARR_BINARY_PATH` → verify error
3. Set both env vars → verify native execution works
4. Run a model through the API → verify progress streaming works
5. Cancel a running model → verify process termination works
