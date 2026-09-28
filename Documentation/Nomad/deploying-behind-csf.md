# Deploying behind CSF: the vanishing Docker chains

**Applies to any host running ConfigServer Firewall (CSF) with Docker.** The CIFFC demo
(`nomad.ciffc.ca`, CanSpace) is one. If we have others, they have this problem today.

This is written up because the failure is **silent for days and then takes the site down
during an unrelated deploy**, which is the worst shape a defect can have.

---

## What happens

CSF restarts periodically — on upgrade, on config change, on `csf -r`. Every time it does,
it restores its own saved ruleset, and its journal shows this:

    csf: Flushing chain `DOCKER'
    csf: Deleting chain `DOCKER'
    csf: Deleting chain `DOCKER-USER'
    csf: Deleting chain `DOCKER-INTERNAL'

Docker's chains are created by the **Docker daemon at its own startup**. They are not part of
CSF's saved ruleset, so CSF's restore does not bring them back. After a CSF restart they are
simply gone.

## Why nobody notices

**Running containers keep working.** A container published on `127.0.0.1:<port>` is served by
`docker-proxy` in userspace; that traffic never traverses the `DOCKER` chain. On the CIFFC demo,
cloudflared → `127.0.0.1:53000` → container kept serving perfectly for **days** with the chains
absent.

The failure only appears the next time a container is **started**, because Docker then tries to
insert a rule into a chain that no longer exists:

    Error response from daemon: failed to set up container networking:
    driver failed programming external connectivity on endpoint nomad
    Unable to enable OPEN PORT rule: iptables failed:
      iptables --wait -t filter -I DOCKER ! -i br-… -o br-… -p tcp -d 172.18.0.2 --dport 3001 -j ACCEPT
      iptables: No chain/target/match by that name.

## What it cost us

| When | What |
|---|---|
| 2026-09-24 04:52 | CSF restarted, `(restoring iptables)`, chains deleted. Site kept serving. |
| 2026-09-25 | Deploy of v0.19.0 recreated the container. It could not start. **nomad.ciffc.ca down.** |

The host had been up since July 9. The deploy did not cause this; it was the first thing to
**start a container** since CSF had removed the chains. A reboot would have done the same.

Note the implication: **you cannot roll back out of this.** The old image will not start either.

---

## The fix: three layers, because there are two separate trigger paths

There is no single fix. CSF wipes the chains by **two different routes**, and they need
different answers. Both were confirmed by direct test, in both directions.

### Layer 1 — `DOCKER = "1"` (covers the frequent path)

In `/etc/csf/csf.conf`:

```ini
DOCKER          = "1"
DOCKER_NETWORK4 = "172.16.0.0/12"
```

Then `csf -r`.

`DOCKER = "1"` makes CSF **create** Docker's rules as part of its own ruleset instead of
deleting them. You can see it in the reload output:

    MASQUERADE  all -- !docker0  172.16.0.0/12 -> 0.0.0.0/0
    ACCEPT      all -- docker0 ...

Use `172.16.0.0/12`, **not** the shipped default of `172.17.0.0/16`. The default covers only
`docker0`; compose creates bridges on `172.18.0.x` and upward. `172.16.0.0/12` spans Docker's
whole default pool (172.17–172.31), so bridges created later are covered too.

**This is the path that matters most**, because it is the one that fires constantly — see
"How lfd makes it recur" below.

### Layer 2 — a systemd drop-in (covers a full unit restart)

`/etc/systemd/system/csf.service.d/restart-docker.conf`

```ini
[Service]
ExecStartPost=-/usr/bin/systemctl --no-block restart docker
```

Then `systemctl daemon-reload`.

**Layer 1 does not cover this path.** With `DOCKER = "1"` set, `systemctl restart csf` *still*
deletes the chains — verified 2026-09-27 09:24. Docker restarting behind it recreates them.

- `-` so a failure here can never block CSF from starting
- `--no-block` so a slow Docker restart can never hang CSF

**Cost:** containers blink whenever `csf.service` restarts. Measured: **19 seconds**, self-healed.

**Revert:** delete the file and `systemctl daemon-reload`.

### Layer 3 — the deploy guard (covers both failing)

`scripts/deploy.sh` probes for the chain **before it tears anything down** and refuses to deploy
if it is definitely absent. See `probe_docker_chain` / `docker_chain_verdict`. This is what turns
a site outage into an error message.

### Verified, in both directions

| Trigger | Chain after | Container start |
|---|---|---|
| `csf -r` (the lfd path) | **EXISTS** — fixed by layer 1 | OK |
| `systemctl restart csf` | deleted, then recreated by layer 2 | OK |
| 14-minute soak, sampled every minute | EXISTS at every sample | — |
| Real `docker run -p 127.0.0.1:…` | — | **OK** |

The last row is the one that counts. Chain existence is a proxy; starting a container with a
published port is the operation that actually fails in this mode.

## How lfd makes it recur — and why one measurement is not enough

`lfd` watches the ruleset and re-applies CSF **on its own, outside systemd**:

    lfd: iptables appears to have been flushed - running *csf startup*...
    lfd: csf startup completed

Restarting Docker inserts Docker's rules, lfd reads that as a flush, and re-runs CSF — which
(before layer 1) deleted the chains again. Roughly three minutes after a Docker restart.

This is how the first attempt at this fix was wrongly declared successful: the chain was checked
19 seconds after a Docker restart, found present, and called fixed. lfd undid it at T+3m.

**So verify across at least two lfd sweeps — 10 minutes minimum — never a single sample.**

## What does NOT fix it on its own

**`/etc/csf/csfpost.sh`** — the CIFFC demo already has one, ACCEPTing `docker0`, `br-+` and
`172.18.0.0/16` on FORWARD/OUTPUT/INPUT. That governs traffic **flow**, which was never the
broken part. It solves the half that was already working.

**The systemd drop-in alone** — it hooks `csf.service` restarts, and lfd's `csf startup` is not
one. That is layer 1's job.

**`DOCKER = "1"` alone** — does not survive a full `systemctl restart csf`. That is layer 2's job.

---

## Operational notes learned alongside this

**A container left in `Created` state before a Docker restart starts with an empty port map.**
After recovering the daemon, `docker compose up -d` will happily *start* that stale container and
report success, with `ports: map[]` and nothing listening. Use:

```bash
docker compose up -d --force-recreate <service>
```

**Check before you deploy.** On any CSF host, this is a two-second pre-flight that would have
avoided the whole outage:

```bash
sudo iptables-nft -t filter -L DOCKER -n >/dev/null 2>&1 && echo OK || echo "CHAIN MISSING — a deploy will fail"
```

**`.env` is gitignored**, so `git pull` cannot touch it. Back it up anyway; the demo host's
convention is `.env.bak-<date>-pre-<version>`.

**Backgrounding over SSH:** `nohup`/`setsid` launched through `ssh host 'bash -s'` dies with the
session. For anything that must survive a firewall reload, use
`systemd-run --collect --unit=<name> /usr/local/sbin/<script>`. Note `systemd-run` cannot execute
from `/tmp`.

## See also

- `scripts/deploy.sh` — the supported deploy path; refuses to run as root and repairs ownership drift
- `Documentation/Nomad/ARCHITECTURE.md` — deployment modes
