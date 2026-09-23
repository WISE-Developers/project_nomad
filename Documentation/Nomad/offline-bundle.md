# Offline bundle — build, carry, install

For agencies whose laptops are air-gapped, Docker-blocked and admin-restricted.
You build once on a connected machine, copy the result to a USB stick, and run
it on as many field laptops as you like. Nothing on the target needs a network,
Docker, or an administrator.

Issue: [#318](https://github.com/WISE-Developers/project_nomad/issues/318).

---

## What you should know before you start

**It is not an installer. It is a folder.** Copy it, run the launcher inside
it, delete the folder to uninstall. No registry writes, no services, no PATH
edits, no WSL2.

**One build serves N laptops.** Every path inside the bundle is relative to the
bundle's own folder, and the launcher works out where it lives at run time. The
same folder works on `E:\` on one laptop and `C:\Users\someone\Desktop` on the
next. Do not "fix" anything into an absolute path; that is the one change that
breaks it everywhere except the machine you tested on.

**The dataset is about 3 GB per fuel year.** All four vintages is about 11 GB.
Some of our older documentation claims about 50 GB — that figure is wrong and
is being corrected separately.

---

## 1. Build (on a machine with a network)

You need Node, `git`, `gh` (authenticated), `curl`, `unzip` and `tar`. You do
**not** need a compiler, and you do not need to be on the platform you are
building for — a Mac can build the Windows bundle.

```bash
cd project_nomad
scripts/build-offline-bundle.sh \
  --platform windows-x64 \
  --years 2023 \
  --timezone America/Yellowknife
```

Output lands in `dist-offline/Nomad/`.

### Options

| Flag | Meaning |
|---|---|
| `--platform` | `windows-x64` (default), `linux-x64`, `macos-arm64` |
| `--timezone` | **Required.** IANA zone name for where the bundle will be USED |
| `--years` | Comma-separated fuel vintages, e.g. `2023` or `2024,2025` |
| `--no-data` | Build without any fuel dataset |
| `--out` | Output directory (default `dist-offline/`) |

### `--timezone` is required on purpose

There is no default and there will not be one. The zone belongs to **where the
bundle will be used**, which the machine building it cannot know. Nomad has
made this mistake once already
([#368](https://github.com/WISE-Developers/project_nomad/issues/368)): the
wizard filled a model's timezone from the operator's own browser, so someone in
Winnipeg supporting an NWT fire shifted every hour of the run and nothing said
so.

It must be a zone **name** (`America/Yellowknife`), not an offset (`-06:00`).
A fixed offset cannot observe DST and would freeze the deployment on one
season's clock. The builder rejects offsets.

### Either `--years` or `--no-data`

Also deliberate. Guessing which fuel vintage a practitioner needs is how you
produce a confidently wrong fire. Use the vintage matching the year being
modelled — a 2023 run wants the 2023 fuels.

### Every input is pinned and checksum-verified

Node, the FireSTARR binary, the native addons and each fuel year are all
downloaded at an exact version and verified against a published hash before
they are allowed into the bundle. `manifest.json` in the bundle records every
version and hash, so "what is actually on that thumb drive?" has an answer
months later.

---

## 2. Copy to a USB stick

**Format the stick exFAT or NTFS, not FAT32.** FAT32 cannot hold a single file
larger than 4 GB, and a bundle with a fuel year exceeds that. The copy fails
part-way, which is a bad thing to discover on the way to a fire.

Copy the whole `Nomad` folder. Not its contents — the folder.

Measured, not estimated:

| Bundle | Size |
|---|---|
| `--no-data` | 745 MB |
| one fuel year (2023) | 3.5 GB — of which `data/` is 2.6 GB |
| all four years | about 11 GB |

---

## 3. Install on each laptop

1. Copy the `Nomad` folder from the stick to the laptop — Desktop, or anywhere
   the user can write. It can also be run directly from the stick, though a
   local copy is faster.
2. Open the folder and run the launcher:
   - Windows: **`Nomad.cmd`** (double-click)
   - Linux/macOS: **`./nomad.sh`**
3. A browser opens at `http://localhost:4900` after a few seconds.

To stop Nomad, close the launcher window (Windows) or press Ctrl+C
(Linux/macOS). To uninstall, delete the folder.

Repeat for as many laptops as you have. The bundle is identical on each; there
is nothing per-machine to configure.

---

## What is in the bundle

```
Nomad/
├── Nomad.cmd  (or nomad.sh)   the only thing anyone runs
├── runtime/                   Node — extracted, not installed
├── engine/                    firestarr + proj.db + fuel.lut
├── app/
│   ├── backend/dist/          built server
│   ├── frontend/dist/         built UI
│   └── node_modules/          production dependencies only
├── data/                      fuel dataset, or empty with --no-data
├── db/                        SQLite database and usage log, created on first run
├── .env                       relative-path configuration
└── manifest.json              exact versions and hashes of every input
```

`db/` is the only directory written to at run time, and it lives inside the
bundle so everything travels together.

---

## Troubleshooting

**"This bundle is missing its Node runtime"** — the copy is incomplete. Copy
the whole folder again; this usually means the USB copy was interrupted or the
stick was FAT32.

**"This bundle is missing engine\proj.db"** — same cause. The launcher checks
for it deliberately: without `proj.db`, FireSTARR fails with an unreadable
Windows status code (`0xC0000409`) that looks like a broken laptop rather than
a missing file.

**The build failed part-way through a dataset download** — just run the same
command again. Large downloads resume rather than restarting, and the builder
retries on its own; this was seen twice on a single 2.8 GB fuel year. The
partial file is kept deliberately so a re-run picks up where it stopped, and
the checksum is still verified afterwards, so a bad resume fails loudly rather
than shipping corrupted fuels.

**A browser opens but the page does not load** — give it a few more seconds and
reload. The launcher waits briefly before opening the browser, and a slow
laptop can take longer than that to finish its first-run database migrations.

**Port 4900 already in use** — another copy of Nomad is probably already
running. Close its window first.

**No fuel dataset** — if the bundle was built with `--no-data`, `data/` is
empty and models cannot run. Rebuild with `--years`.

---

## What has been verified, and what has not

Being precise about this matters more than sounding finished.

**Verified by running it.** A `macos-arm64` bundle was built and launched with
a stripped environment (`env -i`, so nothing came from the surrounding shell).
It started, loaded its own bundled `better-sqlite3`, ran its database
migrations, served the UI, and reported `/api/v1/health` as healthy.

**Verified by construction and inspection, but NOT by running.** The
**`windows-x64` bundle has never been executed on Windows.** Its contents have
been checked — both native addons report as `PE32+ executable (DLL) x86-64, for
MS Windows`, the ABI matches the bundled Node, and no macOS binaries are
present — but no one has double-clicked `Nomad.cmd` on a real Windows machine.
There is currently no Windows machine available to do it on.

Treat the Windows bundle as untested until someone runs it. The first person to
try it should expect to find something.

**Not covered here at all.** Whether a fire actually *completes* offline is
[#381](https://github.com/WISE-Developers/project_nomad/issues/381), not this
document. This bundle launches; that it models is a separate claim with its own
acceptance test.

**Application allowlisting.** Avoiding administrator is not the same as
avoiding AppLocker or WDAC. If a fleet enforces code signing, an unsigned
portable bundle may be blocked outright regardless of everything above. That is
a policy question for the agency, not something this builder can solve.
