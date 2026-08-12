# Upgrading Nomad

Notes for operators upgrading an existing Nomad deployment. Newest first.

Read the entry for every version between your current one and the target — a
required key added in one release still applies if you skip past it.

---

## Upgrading to the release containing the usage log (#332)

### BREAKING: `NOMAD_HOME_TIMEZONE` is required

**Symptom if you skip this step:** the backend refuses to start and logs

```
Failed to start server: Error: Required environment variable "NOMAD_HOME_TIMEZONE" is not set.
```

The process exits with status 1. Nothing is corrupted and no database work is
performed — the check runs before any side effect — but the service will not
come up until the key is present.

### What to do

Add one line to your `.env`:

```
NOMAD_HOME_TIMEZONE=America/Edmonton
```

Use the IANA zone name for wherever the deployment actually lives:

| Location | Value |
|---|---|
| Yellowknife, Edmonton, Calgary | `America/Edmonton` |
| Winnipeg, Regina‡ | `America/Winnipeg` |
| Toronto, Ottawa | `America/Toronto` |
| Vancouver, Victoria | `America/Vancouver` |
| Halifax | `America/Halifax` |

‡ Saskatchewan does not observe DST — use `America/Regina` for a deployment there.

Then restart as usual for your install type.

### Rules

- **It must be a zone NAME, not an offset.** `-06:00` is rejected: a fixed offset
  cannot observe DST, so it would freeze the deployment on the summer offset all
  winter.
- **A typo fails loudly.** `America/Yellowknive` produces
  `Invalid NOMAD_HOME_TIMEZONE: "America/Yellowknive" is not a valid IANA time zone name.`
  and the backend exits rather than starting with a wrong clock.
- **There is deliberately no default.** The container's own clock is UTC, so
  falling back would stamp every local timestamp six hours wrong while every
  health check stayed green. Crashing is the intended behaviour.

### Why the key exists

Usage log entries carry two timestamps: `ts_utc` for machines (sorting,
durations, comparing deployments) and `ts_local` for people — wall-clock time
where the box actually sits, so nobody on shift has to do arithmetic. This key
is the zone used for `ts_local`.

### Optional: the usage query endpoint

`GET /api/v1/usage` is **off by default and not registered at all** unless a
token is configured. There is no way to reach it by accident.

To turn it on, add to `.env`:

```
NOMAD_USAGE_API_TOKEN=<at least 32 characters>
```

Generate one with `openssl rand -hex 32`. A shorter value is rejected at
startup, and there is no default — a default token is a published password.

Call it with:

```
curl -H "Authorization: Bearer $NOMAD_USAGE_API_TOKEN" \
     "http://localhost:4901/api/v1/usage?limit=100&type=model.run.failed"
```

Notes:

- Responses are always bounded (default 100, maximum 1000) and report
  `truncated: true` rather than implying completeness.
- **Every read is itself logged**, including rejected ones. The presented token
  is never written to the log.
- The log holds identities, timestamps and activity patterns. Treat the token
  like any other credential, and note that enabling the endpoint makes a
  personnel-shaped record reachable over the network.

### Fresh installs

No action needed. All installers write the key:

- `install-nomad-san-metal.sh`, `install_nomad_setup.sh` and
  `install-nomad-san-metal.ps1` prompt for it, pre-filled from
  `NOMAD_HOME_TIMEZONE` if set, defaulting to `America/Edmonton`.
- `install-nomad-san-docker.sh`, `install-nomad-san-docker.ps1`,
  `install-nomad-demo.sh` and `install-nomad-headless.sh` are non-interactive
  and take the value from the environment, defaulting to `America/Edmonton`.

All of them validate the value before writing it, so a typo fails during install
rather than at first boot.
