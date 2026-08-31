# Releasing MaTE

How to cut a release. Everything is built by GitHub Actions
([`.github/workflows/release.yml`](.github/workflows/release.yml)) — you never upload
files by hand.

Each release publishes three assets:

| Asset | What it is |
| ----- | ---------- |
| `table-editor.js` | The single file you paste into BookStack's Custom HTML Head (see [README](README.md#installation)). |
| `MaTE_<version>_x64_en-US.msi` | Windows installer, MSI. Best for deploying via Group Policy / Intune. |
| `MaTE_<version>_x64-setup.exe` | Windows installer, NSIS. The one to hand to a person. |

> **You need no local tooling for this.** The tag is the only thing you push; the build
> runs on GitHub's machines. A Rust toolchain is only needed to build the desktop app
> locally.

---

## 1. Bump the version

Three files carry a version. The two under `tauri/src-tauri/` are baked into the
installer filenames and Windows' "Programs and Features" entry, so the workflow
**fails fast** if they disagree with the tag.

| File | Field |
| ---- | ----- |
| `tauri/src-tauri/tauri.conf.json` | `"version"` |
| `tauri/src-tauri/Cargo.toml` | `version` under `[package]` |
| `package.json` | `"version"` — not shipped in any artifact, but keep it in step |

Use a plain `MAJOR.MINOR.PATCH` number with no `v` (the `v` belongs on the tag only).
Bumping `Cargo.toml` also updates `Cargo.lock`, so commit that too:

```bash
git add -A && git commit -m "Release 1.0.0" && git push
```

Let CI go green on that commit before tagging.

## 2. Tag and push

The tag is what starts a release. It must be the version prefixed with `v`:

```bash
git tag -a v1.0.0 -m "MaTE 1.0.0" && git push origin v1.0.0
```

`-a` makes it an *annotated* tag (it records who tagged it and when) — the convention
for releases. A tag that does not start with `v` triggers nothing.

## 3. Wait for the build

Watch it under the repository's **Actions** tab → **Release**. Four jobs run:

1. **verify-version** — checks the tag against the version files. Seconds.
2. **BookStack bundle** — typechecks and builds `dist/table-editor.js`. ~1 minute.
3. **Windows installers** — builds the Tauri app on a Windows runner. **10–15 minutes
   the first time**, faster afterwards (the Rust build and the Tauri CLI are cached).
4. **Draft GitHub release** — collects all three assets and creates the release.

If a job fails, nothing is published. Fix the problem and see
[Re-running](#re-running-a-release) below.

## 4. Publish the draft

The release is created as a **draft**, so it is visible only to you and nothing is
announced until you say so. To publish:

1. Go to the repository's **Releases** page (right-hand sidebar of the repo home page,
   or `https://github.com/Kungsbacka/MaTE/releases`).
2. The draft is at the top, marked `Draft`. Click it, then **Edit** (pencil icon).
3. Check the three assets are attached at the bottom.
4. The release notes were generated from the commits since the last tag. Edit them
   freely — this is the changelog people read, so it is worth a few minutes. A short
   "what changed for users" paragraph above the generated list goes a long way.
5. Leave **Set as the latest release** ticked.
6. Click **Publish release**.

That is it — the assets now have stable public download URLs, and
`.../releases/latest` points at this release.

## 5. Check it

Download the `.exe` and install it on a Windows machine, and paste `table-editor.js`
into a test BookStack instance. There are no automated tests yet (see
[`test/TESTING.md`](test/TESTING.md)), so this manual pass is the only thing standing
between a tag and your users.

---

## Heads-up: the installers are unsigned

MaTE is not code-signed, so Windows SmartScreen will warn the first person who runs
the installer — "Windows protected your PC", with the real button hidden behind
**More info → Run anyway**. This is expected, not a broken build. The warning fades as
more people download the same file, or goes away entirely with a code-signing
certificate (see Tauri's
[Windows code signing guide](https://v2.tauri.app/distribute/sign/windows/)).

Tell people to expect it, or they will assume the download is broken.

## Re-running a release

The workflow is safe to re-run on the same tag: it refreshes the assets on the
existing draft instead of failing. Actions tab → the failed run → **Re-run failed
jobs**.

If you need to change the *code* for a version you have already tagged but **not yet
published**, move the tag:

```bash
git tag -d v1.0.0 && git push origin :refs/tags/v1.0.0   # delete locally and on GitHub
# ...commit the fix...
git tag -a v1.0.0 -m "MaTE 1.0.0" && git push origin v1.0.0
```

Then delete the stale draft release on the Releases page, since the old one is not
replaced automatically.

**Never move a tag that has already been published.** People may have downloaded it,
and the tag is the only record of what they got. Ship `v1.0.1` instead.

## Building without releasing

To confirm both builds still work without creating anything public: Actions tab →
**Release** → **Run workflow**. Run from a branch and it builds both artifacts, skips
the version check, and creates no release. The results are downloadable at the bottom
of the run summary, under **Artifacts** — handy for testing an installer before you
commit to a version number.
