# Dependency security

Use Node.js 22 and pnpm 12.6.0, pinned in `package.json`. CI reads the same pnpm pin.

## Install policy

`pnpm-workspace.yaml` applies the [pnpm supply-chain mitigations](https://pnpm.io/supply-chain-security) to local and CI installs. Releases must be at least one week old; missing publication dates or a range with no eligible release fail installation. Transitive Git/tarball dependencies are blocked, and `trustPolicy: no-downgrade` rejects a release whose publishing trust is lower than an earlier release. Frozen installs keep these checks enabled. Three existing releases without provenance have exact-version trust exceptions recorded in the configuration; their registry integrity hashes match the committed lockfile. Review these exceptions when updating the affected dependencies.

## Install scripts

During ordinary local installs, dependency install scripts run only for the reviewed `esbuild@0.28.2` and `unrs-resolver@1.12.2` versions that prepare native tooling. `@parcel/watcher` and `@swc/core` scripts remain denied. An unreviewed script fails an ordinary local install. Both CI jobs install with `--ignore-scripts` to skip all install scripts; CI does not enforce the unreviewed-script failure check.

When updating an approved package, inspect its install script and any helpers it invokes before changing its version in `allowBuilds`. Keep optional dependencies enabled so the tooling can use the native binaries recorded in the lockfile.

## Changing dependencies

Commit `pnpm-lock.yaml` with dependency changes and review its integrity and source changes alongside `package.json` and the build policy. Use `pnpm install --frozen-lockfile` for ordinary installs; use `pnpm add` or `pnpm update` for intentional dependency changes. If a security update is blocked, review the upstream release and use a narrowly scoped, version-specific exception only when needed, documenting the reason in the configuration.

## Audits

Run `pnpm audit` before releases; these policies complement known-vulnerability checks.

pnpm 12 records its own dependencies in the first document of a two-document lockfile. Any vulnerability scanner or SBOM tool must read both documents to include application dependencies.
