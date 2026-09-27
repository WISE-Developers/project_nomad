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

## The fix

`/etc/systemd/system/csf.service.d/restart-docker.conf`

```ini
[Service]
ExecStartPost=-/usr/bin/systemctl --no-block restart docker
```

Then `systemctl daemon-reload`.

Whenever CSF restarts and rebuilds the ruleset, Docker restarts behind it and recreates its
chains. It changes **no firewall rules** — it is a service-ordering change.

- `-` so a failure here can never block CSF from starting
- `--no-block` so a slow Docker restart can never hang CSF

**Cost:** containers blink whenever CSF restarts. Measured on the CIFFC demo: **19 seconds**,
self-healed, no intervention.

**Revert:** delete the file and `systemctl daemon-reload`.

### Verified, not assumed

Applied 2026-09-27 and tested by deliberately restarting CSF:

    07:48:03  CSF restart issued
    07:48:05  csf: Deleting chain `DOCKER'          <- the cause, from CSF's own journal
    07:48:17  Starting Docker Application Container Engine...   <- ExecStartPost firing
    07:48:19  DOCKER chain: EXISTS                  <- recreated
    07:48:22  demo serving v0.19.0, container Up 4 seconds

## What does NOT fix it

**`DOCKER = "1"` in `/etc/csf/csf.conf`** — two reasons:

1. Its `DOCKER_NETWORK4` defaults to `172.17.0.0/16`, but compose-created bridges are on
   `172.18.0.x`. The failing rule above is `-d 172.18.0.2`.
2. More fundamentally, it does not recreate Docker's own chains. Only the daemon starting does.

**`/etc/csf/csfpost.sh`** — the CIFFC demo already has one, ACCEPTing `docker0`, `br-+` and
`172.18.0.0/16` on FORWARD/OUTPUT/INPUT. That governs traffic **flow**, which was never the
broken part. It solves the half that was already working.

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
